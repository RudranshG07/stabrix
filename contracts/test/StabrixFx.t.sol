// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import {StabrixFixture} from "./utils/StabrixFixture.sol";
import {StabrixConfig} from "../src/StabrixConfig.sol";
import {StabrixMath} from "../src/StabrixMath.sol";
import {StabrixOracle} from "../src/StabrixOracle.sol";
import {StabrixPricing} from "../src/StabrixPricing.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";

contract StabrixFxTest is StabrixFixture {
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

    function setUp() public override {
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

    function test_FxSwapPricesAtFeedRate() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 1), 10_000, 1);
        uint256 amountIn = amountFor(usdc, 1);
        uint256 out = swapIn(order, usdc, eurc, amountIn);
        assertLe(usdOf(eurc, out), usdOf(usdc, amountIn));
        assertGt(usdOf(eurc, out), usdOf(usdc, amountIn) * 9990 / 10_000);

        amountIn = amountFor(brz, 1);
        out = swapIn(order, brz, idrx, amountIn);
        assertLe(usdOf(idrx, out), usdOf(brz, amountIn));
        assertGt(usdOf(idrx, out), usdOf(brz, amountIn) * 9990 / 10_000);
    }

    function test_EveryPairInFxRange() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 5), 10_000, 1);
        for (uint256 i; i < N; ++i) {
            for (uint256 j; j < N; ++j) {
                if (i == j) continue;
                uint256 snap = vm.snapshotState();
                uint256 amountIn = amountFor(i, 1);
                uint256 out = swapIn(order, i, j, amountIn);
                assertLe(usdOf(j, out), usdOf(i, amountIn));
                assertGt(usdOf(j, out), usdOf(i, amountIn) * 9980 / 10_000);
                vm.revertToState(snap);
            }
        }
    }

    function test_FxFeeAppliesOnlyToFxPairs() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 50), 10_000, 1);
        uint256 amountIn = amountFor(usdc, 1);
        uint256 usdOut = quoteIn(order, usdc, dai, amountIn);
        uint256 fxOut = quoteIn(order, usdc, eurc, amountIn);
        assertGt(usdOf(dai, usdOut), usdOf(usdc, amountIn) * 9995 / 10_000);
        assertLt(usdOf(eurc, fxOut), usdOf(usdc, amountIn) * 9951 / 10_000);
        assertGt(usdOf(eurc, fxOut), usdOf(usdc, amountIn) * 9940 / 10_000);
    }

    function test_SmallRateMoveIsNotArbitrable() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 5), 10_000, 1);
        eurFeed.set(1.12112e8, block.timestamp);
        uint256 amountIn = amountFor(usdc, 100);
        uint256 out = quoteIn(order, usdc, eurc, amountIn);
        assertLe(usdOf(eurc, out), usdOf(usdc, amountIn));
        amountIn = amountFor(eurc, 100);
        out = quoteIn(order, eurc, usdc, amountIn);
        assertLe(usdOf(usdc, out), usdOf(eurc, amountIn));
    }

    function test_LargeRateJumpMispricingIsBounded() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 5), 10_000, 1);
        uint256 amountIn = amountFor(usdc, 100);
        uint256 before = quoteIn(order, usdc, eurc, amountIn);
        eurFeed.set(1.15e8, block.timestamp);
        uint256 out = quoteIn(order, usdc, eurc, amountIn);
        assertLt(out, before, "pool follows the oracle");
        uint256 jumpBps = 268;
        uint256 edgeBps = (usdOf(eurc, out) * 10_000 / usdOf(usdc, amountIn)) - 10_000;
        assertLt(edgeBps, jumpBps * 2 / 10, "mispricing under 20% of the jump at 9x");
    }

    function test_CreRateUsedWithinBound() public {
        _report(tokens[eurc], 1.1205e18, false, uint64(block.timestamp));
        assertEq(price(eurc), 1.1205e18);
    }

    function test_CreRateOutsideBoundFallsBackToFeed() public {
        _report(tokens[eurc], 1.13e18, false, uint64(block.timestamp));
        assertEq(price(eurc), 1.12e18);
    }

    function test_StaleCreRateFallsBackToFeed() public {
        _report(tokens[eurc], 1.1205e18, false, uint64(block.timestamp));
        vm.warp(block.timestamp + 901);
        eurFeed.set(1.12e8, block.timestamp);
        assertEq(price(eurc), 1.12e18);
    }

    function test_FutureReportRejected() public {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        bool[] memory hlt = new bool[](1);
        t[0] = tokens[eurc];
        uint64 future = uint64(block.timestamp + 301);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.FutureReport.selector, future));
        oracle.onReport("", abi.encode(t, p, hlt, future));
    }

    function test_StaleFeedRefusesFxRangeButNotUsdRange() public {
        (ISwapVM.Order memory fx,) = shipUsd(lp, fxConfig(1, 5, 10_000, NO_EDGE), 100, 1);

        StabrixConfig.Config memory c = fxConfig(1, 5, 10_000, NO_EDGE);
        uint256 m;
        for (uint256 k; k < N; ++k) {
            if (k != eurc && k != brz && k != idrx) ++m;
        }
        c.tokens = new address[](m);
        c.decimals = new uint8[](m);
        m = 0;
        for (uint256 k; k < N; ++k) {
            if (k == eurc || k == brz || k == idrx) continue;
            (c.tokens[m], c.decimals[m]) = (tokens[k], decimals[k]);
            ++m;
        }
        c.sumCapRatio = NO_EDGE;
        (ISwapVM.Order memory usdOnly,) = shipUsd(lp2, c, 100, 2);

        vm.warp(block.timestamp + FEED_AGE + 1);
        uint256 firstFx = eurc < brz ? (eurc < idrx ? eurc : idrx) : (brz < idrx ? brz : idrx);
        fund(trader, usdc, unit(usdc), address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.StaleRate.selector, tokens[firstFx]));
        router.swap(fx, tokens[usdc], tokens[dai], unit(usdc), takerData(true, trader));

        assertGt(swapIn(usdOnly, usdc, dai, unit(usdc)), 0);
    }

    function test_HaltedFxCoinRefusedAsInputOnly() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, fxConfig(1, 5, 10_000, NO_EDGE), 100, 1);
        oracle.guardianSet(tokens[brz], true);
        uint256 amountIn = amountFor(brz, 1);
        fund(trader, brz, amountIn, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.Halted.selector, tokens[brz]));
        router.swap(order, tokens[brz], tokens[usdc], amountIn, takerData(true, trader));
        assertGt(swapIn(order, usdc, brz, unit(usdc)), 0);
    }

    function test_LpSpendsFromWallet_FillsUpToWallet() public {
        (ISwapVM.Order memory order, bytes32 h) = shipUsd(lp, fxConfig(1, 5, 10_000, NO_EDGE), 100, 1);
        uint256 keep = amountFor(eurc, 3);
        uint256 spend = MockStablecoin(tokens[eurc]).balanceOf(lp) - keep;
        vm.prank(lp);
        MockStablecoin(tokens[eurc]).transfer(makeAddr("shop"), spend);
        assertGt(aquaBalance(lp, h, eurc), keep);

        assertEq(lens.spendable(lp, _one(tokens[eurc]))[0], keep);
        assertGt(swapIn(order, usdc, eurc, amountFor(usdc, 1)), 0);

        uint256 left = MockStablecoin(tokens[eurc]).balanceOf(lp);
        uint256 amountIn = amountFor(usdc, 5);
        fund(trader, usdc, amountIn, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixPricing.InsufficientLiquidity.selector, tokens[eurc], left));
        router.swap(order, tokens[usdc], tokens[eurc], amountIn, takerData(true, trader));
    }

    function test_RevokedAllowanceRefuses() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, fxConfig(1, 5, 10_000, NO_EDGE), 100, 1);
        vm.prank(lp);
        MockStablecoin(tokens[dai]).approve(address(aqua), 0);
        fund(trader, usdc, unit(usdc), address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixPricing.InsufficientLiquidity.selector, tokens[dai], 0));
        router.swap(order, tokens[usdc], tokens[dai], unit(usdc), takerData(true, trader));
    }

    function test_ExactOutFx() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 5), 10_000, 1);
        uint256 want = 10 * unit(eurc);
        fund(trader, usdc, 20 * unit(usdc), address(router));
        vm.prank(trader);
        (uint256 paid, uint256 got,) = router.swap(order, tokens[usdc], tokens[eurc], want, takerData(false, trader));
        assertEq(got, want);
        assertGe(usdOf(usdc, paid), usdOf(eurc, got));
        assertLt(usdOf(usdc, paid), usdOf(eurc, got) * 10_020 / 10_000);
    }

    function test_IdrxTwoDecimals() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, deep(1, 5), 10_000, 1);
        uint256 amountIn = 10 * unit(usdc);
        uint256 out = swapIn(order, usdc, idrx, amountIn);
        assertGt(out, 18_000_000);
        assertLt(out, 18_100_000);
        assertLe(usdOf(idrx, out), usdOf(usdc, amountIn));

        uint256 back = swapIn(order, idrx, usdc, 10_000);
        assertLe(usdOf(usdc, back), usdOf(idrx, 10_000));
        assertGt(usdOf(usdc, back), usdOf(idrx, 10_000) * 99 / 100);
    }

    function test_EdgeRefusesFloodedFxCoin() public {
        (ISwapVM.Order memory order,) = shipUsd(lp, fxConfig(1, 5, 10_000, 5.2e18), 100, 1);
        uint256 chunk = amountFor(brz, 2);
        bool refused;
        for (uint256 k; k < 400 && !refused; ++k) {
            uint256 j = k % 2 == 0 ? usdc : dai;
            fund(trader, brz, chunk, address(router));
            vm.prank(trader);
            try router.swap(order, tokens[brz], tokens[j], chunk, takerData(true, trader)) {}
            catch (bytes memory err) {
                refused = bytes4(err) == StabrixMath.RangeEdge.selector;
            }
        }
        assertTrue(refused, "flooded coin hits the edge");
        assertGt(swapIn(order, usdc, eurc, amountFor(usdc, 1)), 0, "other pairs keep trading");
    }

    function test_ExposureCapFx() public {
        (ISwapVM.Order memory order, bytes32 h) = shipUsd(lp, fxConfig(1, 5, 2000, NO_EDGE), 100, 1);
        uint256 chunk = amountFor(idrx, 2);
        for (uint256 k; k < 400; ++k) {
            fund(trader, idrx, chunk, address(router));
            vm.prank(trader);
            try router.swap(order, tokens[idrx], tokens[usdc], chunk, takerData(true, trader)) {}
            catch {
                break;
            }
        }
        uint256 total;
        for (uint256 k; k < N; ++k) {
            total += usdOf(k, aquaBalance(lp, h, k));
        }
        assertLe(usdOf(idrx, aquaBalance(lp, h, idrx)) * 10_000, 2000 * total);
    }

    function testFuzz_SwapNeverShrinksRadiusAcrossRateMoves(uint256 seed) public {
        (ISwapVM.Order memory order, bytes32 h) = shipUsd(lp, fxConfig(1, 5, 10_000, NO_EDGE), 100, 1);
        MockFeed[3] memory feeds = [eurFeed, brlFeed, idrFeed];
        for (uint256 t; t < 8; ++t) {
            seed = uint256(keccak256(abi.encode(seed, t)));
            MockFeed f = feeds[seed % 3];
            int256 move = int256(bound(seed >> 4, 0, 400)) - 200;
            f.set(f.answer() * (10_000 + move) / 10_000, block.timestamp);

            uint256 i = (seed >> 20) % N;
            uint256 j = (i + 1 + (seed >> 28) % (N - 1)) % N;
            uint256 amt = amountFor(i, bound(seed >> 36, 1, 40));
            uint256 r0 = _radius(h, lp, 900 * W);
            fund(trader, i, amt, address(router));
            vm.prank(trader);
            try router.swap(order, tokens[i], tokens[j], amt, takerData(true, trader)) {} catch {}
            assertGe(_radius(h, lp, 900 * W), r0);
        }
    }

    function testFuzz_RoundTripNeverProfitsFx(uint256 usd, uint8 a, uint8 b, uint16 eurMove) public {
        (ISwapVM.Order memory order,) = shipUsd(lp, fxConfig(1, 5, 10_000, NO_EDGE), 100, 1);
        eurFeed.set(int256(1.12e8) * int256(uint256(bound(eurMove, 9_500, 10_500))) / 10_000, block.timestamp);
        uint256 i = a % N;
        uint256 j = (i + 1 + b % (N - 1)) % N;
        uint256 amountIn = amountFor(i, bound(usd, 1, 30));
        uint256 out = swapIn(order, i, j, amountIn);
        uint256 back = swapIn(order, j, i, out);
        assertLe(back, amountIn);
    }

    function _one(address t) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = t;
    }
}
