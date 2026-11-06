// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import {StabrixFixture} from "./StabrixFixture.sol";
import {StabrixConfig} from "../../src/StabrixConfig.sol";
import {StabrixMath} from "../../src/StabrixMath.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockStablecoin} from "../../src/mocks/MockStablecoin.sol";

abstract contract FxFixture is StabrixFixture {
    uint32 internal constant FEED_AGE = 4500;
    uint64 internal constant NO_EDGE = type(uint64).max;

    MockFeed internal eurFeed;
    MockFeed internal brlFeed;
    MockFeed internal idrFeed;
    uint256 internal usdc;
    uint256 internal dai;
    uint256 internal usde;
    uint256 internal eurc;
    uint256 internal brz;
    uint256 internal idrx;

    function specs() internal pure override returns (string[] memory symbols, uint8[] memory decs) {
        symbols = new string[](8);
        decs = new uint8[](8);
        (symbols[0], symbols[1], symbols[2], symbols[3]) = ("USDC", "USDT", "DAI", "USDS");
        (symbols[4], symbols[5], symbols[6], symbols[7]) = ("USDe", "EURC", "BRZ", "IDRX");
        (decs[0], decs[1], decs[2], decs[3], decs[4], decs[5], decs[6], decs[7]) = (6, 6, 18, 18, 18, 6, 18, 2);
    }

    function setUp() public virtual override {
        super.setUp();
        usdc = idx("USDC");
        dai = idx("DAI");
        usde = idx("USDe");
        eurc = idx("EURC");
        brz = idx("BRZ");
        idrx = idx("IDRX");
        eurFeed = new MockFeed(8, 1.12e8);
        brlFeed = new MockFeed(8, 0.18e8);
        idrFeed = new MockFeed(8, 5530);
        oracle.setFeed(tokens[eurc], address(eurFeed), FEED_AGE);
        oracle.setFeed(tokens[brz], address(brlFeed), FEED_AGE);
        oracle.setFeed(tokens[idrx], address(idrFeed), FEED_AGE);
    }

    function idx(string memory symbol) internal view returns (uint256) {
        for (uint256 k; k < N; ++k) {
            if (keccak256(bytes(MockStablecoin(tokens[k]).symbol())) == keccak256(bytes(symbol))) return k;
        }
        revert("symbol");
    }

    function fxConfig(uint16 fee, uint16 fxFee, uint16 maxShare, uint64 cap)
        internal
        view
        returns (StabrixConfig.Config memory c)
    {
        c = config(fee, maxShare, true);
        c.fxFeeBps = fxFee;
        c.sumCapRatio = cap;
    }

    function deep(uint16 fee, uint16 fxFee) internal view returns (StabrixConfig.Config memory c) {
        c = fxConfig(fee, fxFee, 10_000, NO_EDGE);
        c.floor = uint128(90_000 * W);
    }

    function price(uint256 k) internal view returns (uint256 p) {
        (p,,) = oracle.priceOf(tokens[k]);
    }

    function amountFor(uint256 k, uint256 usd) internal view returns (uint256) {
        return usd * unit(k) * W / price(k);
    }

    function usdOf(uint256 k, uint256 amount) internal view returns (uint256) {
        return amount * price(k) / unit(k);
    }

    function shipUsd(address maker, StabrixConfig.Config memory c, uint256 usd, uint64 salt)
        internal
        returns (ISwapVM.Order memory order, bytes32 h)
    {
        order = lens.buildOrder(address(router), maker, c, salt);
        uint256[] memory amounts = new uint256[](c.tokens.length);
        for (uint256 k; k < c.tokens.length; ++k) {
            uint256 t = _indexOf(c.tokens[k]);
            amounts[k] = amountFor(t, usd);
            MockStablecoin(c.tokens[k]).mint(maker, amounts[k]);
            vm.prank(maker);
            MockStablecoin(c.tokens[k]).approve(address(aqua), type(uint256).max);
        }
        vm.prank(maker);
        h = aqua.ship(address(router), abi.encode(order), c.tokens, amounts);
    }

    function _indexOf(address token) internal view returns (uint256) {
        for (uint256 k; k < N; ++k) {
            if (tokens[k] == token) return k;
        }
        revert("token");
    }

    function _report(address token, uint256 priceE18, bool halted, uint64 observedAt) internal {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        bool[] memory hlt = new bool[](1);
        (t[0], p[0], hlt[0]) = (token, priceE18, halted);
        vm.prank(forwarder);
        oracle.onReport("", abi.encode(t, p, hlt, observedAt));
    }

    function _radius(bytes32 h, address maker, uint256 floor) internal view returns (uint256) {
        uint256[] memory real = new uint256[](N);
        uint256[] memory rates = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            real[k] = aquaBalance(maker, h, k);
            rates[k] = 10 ** (36 - decimals[k]) * price(k) / W;
        }
        return StabrixMath.radius(StabrixMath.virtualBalances(real, rates, floor));
    }
}
