// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IStabrixOracle} from "./interfaces/IStabrixOracle.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice USD prices for Stabrix. Tokens without a feed are pegged at $1. FX tokens use the CRE market price
/// when it is fresh and within maxDeviationBps of their Chainlink feed, otherwise the feed; a stale feed refuses.
/// A halted token has a depeg price for backstops: the lower of the fresh CRE price and its Chainlink market feed.
/// Report: abi.encode(address[] tokens, uint256[] marketPricesE18, bool[] halted, uint64 observedAt)
contract StabrixOracle is IStabrixOracle, IReceiver, Ownable {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_FUTURE = 300;

    struct Status {
        bool halted;
        uint64 observedAt;
        uint128 priceE18;
    }

    struct Feed {
        IAggregatorV3 feed;
        uint32 maxAge;
        uint8 decimals;
    }

    address public forwarder;
    address public workflowOwner;
    uint32 public reportMaxAge;
    uint16 public maxDeviationBps;
    mapping(address token => Status) public status;
    mapping(address token => Feed) public feeds;
    mapping(address token => Feed) public marketFeeds;

    event ForwarderSet(address forwarder);
    event WorkflowOwnerSet(address workflowOwner);
    event LimitsSet(uint32 reportMaxAge, uint16 maxDeviationBps);
    event FeedSet(address indexed token, address feed, uint32 maxAge);
    event MarketFeedSet(address indexed token, address feed, uint32 maxAge);
    event StatusUpdated(address indexed token, bool halted, uint256 priceE18, uint64 observedAt);
    event GuardianOverride(address indexed token, bool halted);

    error UnauthorizedForwarder(address sender);
    error UnauthorizedWorkflowOwner(address owner);
    error MalformedReport();
    error FutureReport(uint64 observedAt);
    error Halted(address token);
    error NotDepegged(address token);
    error StaleRate(address token);
    error BadFeed(address feed);
    error BadLimits();

    constructor(address forwarder_, address owner_, uint32 reportMaxAge_, uint16 maxDeviationBps_) Ownable(owner_) {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
        _setLimits(reportMaxAge_, maxDeviationBps_);
    }

    function prices(address[] calldata tokens, address tokenIn)
        external
        view
        returns (uint256[] memory pricesE18, uint256 fxMask)
    {
        pricesE18 = new uint256[](tokens.length);
        for (uint256 k; k < tokens.length; ++k) {
            address t = tokens[k];
            Status memory s = status[t];
            if (t == tokenIn && s.halted) revert Halted(t);
            Feed memory f = feeds[t];
            if (address(f.feed) == address(0)) {
                pricesE18[k] = WAD;
                continue;
            }
            fxMask |= 1 << k;
            pricesE18[k] = _fxPrice(t, f, s);
        }
    }

    function priceOf(address token) external view returns (uint256 priceE18, bool fx, bool halted) {
        Status memory s = status[token];
        Feed memory f = feeds[token];
        fx = address(f.feed) != address(0);
        priceE18 = fx ? _fxPrice(token, f, s) : WAD;
        halted = s.halted;
    }

    function depegPrice(address token) external view returns (uint256 priceE18) {
        Status memory s = status[token];
        if (!s.halted) revert NotDepegged(token);
        priceE18 = type(uint256).max;
        if (s.priceE18 != 0 && block.timestamp <= uint256(s.observedAt) + reportMaxAge) priceE18 = s.priceE18;
        Feed memory f = marketFeeds[token];
        if (address(f.feed) != address(0)) {
            (bool ok, uint256 feedPrice) = _read(f);
            if (ok && feedPrice < priceE18) priceE18 = feedPrice;
        }
        if (priceE18 == type(uint256).max) revert StaleRate(token);
    }

    function isHalted(address token) external view returns (bool) {
        return status[token].halted;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        if (workflowOwner != address(0)) {
            if (metadata.length < 62) revert MalformedReport();
            address reporter = address(bytes20(metadata[42:62]));
            if (reporter != workflowOwner) revert UnauthorizedWorkflowOwner(reporter);
        }

        (address[] memory tokens, uint256[] memory pricesE18, bool[] memory halted, uint64 observedAt) =
            abi.decode(report, (address[], uint256[], bool[], uint64));
        if (tokens.length != pricesE18.length || tokens.length != halted.length) revert MalformedReport();
        if (observedAt > block.timestamp + MAX_FUTURE) revert FutureReport(observedAt);

        for (uint256 k; k < tokens.length; ++k) {
            Status storage s = status[tokens[k]];
            if (observedAt <= s.observedAt) continue;
            if (pricesE18[k] > type(uint128).max) revert MalformedReport();
            s.halted = halted[k];
            s.priceE18 = uint128(pricesE18[k]);
            s.observedAt = observedAt;
            emit StatusUpdated(tokens[k], halted[k], pricesE18[k], observedAt);
        }
    }

    function setFeed(address token, address feed, uint32 maxAge) external onlyOwner {
        feeds[token] = _feed(feed, maxAge);
        emit FeedSet(token, feed, maxAge);
    }

    function setMarketFeed(address token, address feed, uint32 maxAge) external onlyOwner {
        marketFeeds[token] = _feed(feed, maxAge);
        emit MarketFeedSet(token, feed, maxAge);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function setWorkflowOwner(address workflowOwner_) external onlyOwner {
        workflowOwner = workflowOwner_;
        emit WorkflowOwnerSet(workflowOwner_);
    }

    function setLimits(uint32 reportMaxAge_, uint16 maxDeviationBps_) external onlyOwner {
        _setLimits(reportMaxAge_, maxDeviationBps_);
    }

    function guardianSet(address token, bool halted) external onlyOwner {
        status[token].halted = halted;
        emit GuardianOverride(token, halted);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _setLimits(uint32 reportMaxAge_, uint16 maxDeviationBps_) internal {
        if (reportMaxAge_ == 0 || maxDeviationBps_ == 0 || maxDeviationBps_ > 1000) revert BadLimits();
        reportMaxAge = reportMaxAge_;
        maxDeviationBps = maxDeviationBps_;
        emit LimitsSet(reportMaxAge_, maxDeviationBps_);
    }

    function _feed(address feed, uint32 maxAge) internal view returns (Feed memory f) {
        if (feed == address(0)) return f;
        uint8 dec = IAggregatorV3(feed).decimals();
        if (dec > 18 || maxAge == 0) revert BadFeed(feed);
        f = Feed(IAggregatorV3(feed), maxAge, dec);
    }

    function _read(Feed memory f) internal view returns (bool ok, uint256 priceE18) {
        (, int256 answer,, uint256 updatedAt,) = f.feed.latestRoundData();
        ok = answer > 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= f.maxAge;
        if (ok) priceE18 = uint256(answer) * 10 ** (18 - f.decimals);
    }

    function _fxPrice(address token, Feed memory f, Status memory s) internal view returns (uint256) {
        (bool ok, uint256 ref) = _read(f);
        if (!ok) revert StaleRate(token);
        if (s.priceE18 == 0 || block.timestamp > uint256(s.observedAt) + reportMaxAge) return ref;
        uint256 diff = s.priceE18 > ref ? s.priceE18 - ref : ref - s.priceE18;
        return diff * BPS > ref * maxDeviationBps ? ref : s.priceE18;
    }
}
