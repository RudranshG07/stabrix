// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IDepegSentinel} from "./interfaces/IDepegSentinel.sol";

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice Chainlink CRE consumer. A workflow reports stablecoin prices; tokens off peg are halted.
/// Report: abi.encode(address[] tokens, int256[] pricesE8, bool[] halted, uint64 observedAt)
contract DepegSentinel is IDepegSentinel, IReceiver, Ownable {
    struct Status {
        bool halted;
        int192 priceE8;
        uint64 observedAt;
    }

    address public forwarder;
    address public workflowOwner;
    mapping(address token => Status) public status;

    event ForwarderSet(address forwarder);
    event WorkflowOwnerSet(address workflowOwner);
    event StatusUpdated(address indexed token, bool halted, int256 priceE8, uint64 observedAt);
    event GuardianOverride(address indexed token, bool halted);

    error UnauthorizedForwarder(address sender);
    error UnauthorizedWorkflowOwner(address owner);
    error MalformedReport();

    constructor(address forwarder_, address owner_) Ownable(owner_) {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
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

        (address[] memory tokens, int256[] memory prices, bool[] memory halted, uint64 observedAt) =
            abi.decode(report, (address[], int256[], bool[], uint64));
        if (tokens.length != prices.length || tokens.length != halted.length) revert MalformedReport();

        for (uint256 k; k < tokens.length; ++k) {
            Status storage s = status[tokens[k]];
            if (observedAt <= s.observedAt) continue;
            s.halted = halted[k];
            s.priceE8 = int192(prices[k]);
            s.observedAt = observedAt;
            emit StatusUpdated(tokens[k], halted[k], prices[k], observedAt);
        }
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function setWorkflowOwner(address workflowOwner_) external onlyOwner {
        workflowOwner = workflowOwner_;
        emit WorkflowOwnerSet(workflowOwner_);
    }

    function guardianSet(address token, bool halted) external onlyOwner {
        status[token].halted = halted;
        emit GuardianOverride(token, halted);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
