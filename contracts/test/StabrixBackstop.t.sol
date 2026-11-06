// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {AquaSwapVMRouter} from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

import {FxFixture} from "./utils/FxFixture.sol";
import {StabrixBackstopConfig} from "../src/StabrixBackstopConfig.sol";
import {StabrixBackstopPricing} from "../src/StabrixBackstopPricing.sol";
import {StabrixOracle} from "../src/StabrixOracle.sol";
import {StabrixPricing} from "../src/StabrixPricing.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";

contract StabrixBackstopTest is FxFixture {
    uint32 internal constant MARKET_AGE = 90_000;

    MockFeed internal usdeMarket;
    MockFeed internal eurcMarket;

    function setUp() public override {
        super.setUp();
        usdeMarket = new MockFeed(8, 1e8);
        eurcMarket = new MockFeed(8, 1.12e8);
        oracle.setMarketFeed(tokens[usde], address(usdeMarket), MARKET_AGE);
        oracle.setMarketFeed(tokens[eurc], address(eurcMarket), MARKET_AGE);
    }

    function bsConfig(uint16 start, uint16 end, uint256 capUsd)
        internal
        view
        returns (StabrixBackstopConfig.Config memory c)
    {
        c.tokens = tokens;
        c.decimals = decimals;
        c.startDiscountBps = start;
        c.endDiscountBps = end;
        c.capPerToken = uint128(capUsd * W);
        c.oracle = address(oracle);
    }

    function shipBackstop(address maker, StabrixBackstopConfig.Config memory c, uint256 pledgeUsd, uint64 salt)
        internal
        returns (ISwapVM.Order memory order, bytes32 h)
    {
        order = lens.buildBackstopOrder(address(router), maker, c, salt);
        uint256[] memory amounts = new uint256[](N);
        amounts[usdc] = amountFor(usdc, pledgeUsd);
        amounts[dai] = amountFor(dai, pledgeUsd);
        for (uint256 k; k < N; ++k) {
            if (MockStablecoin(tokens[k]).balanceOf(maker) < amounts[k]) {
                MockStablecoin(tokens[k]).mint(maker, amounts[k] - MockStablecoin(tokens[k]).balanceOf(maker));
            }
            vm.prank(maker);
            MockStablecoin(tokens[k]).approve(address(aqua), type(uint256).max);
        }
        vm.prank(maker);
        h = aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    function depeg(uint256 k, uint256 marketE18) internal {
        _report(tokens[k], marketE18, true, uint64(block.timestamp));
    }

    function expected(uint256 amountIn, uint256 marketE18, uint256 absorbedUsd, uint256 start, uint256 end, uint256 cap)
        internal
        pure
        returns (uint256)
    {
        uint256 inUsd = amountIn;
        uint256 avgBps1e18 = start * 1e18 + (end - start) * 1e18 * (2 * absorbedUsd + inUsd) / (2 * cap);
        return inUsd * marketE18 / 1e18 * (1e22 - avgBps1e18) / 1e22;
    }

    function test_DormantUntilDepeg() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        fund(trader, usde, 100 * W, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.NotDepegged.selector, tokens[usde]));
        router.swap(order, tokens[usde], tokens[usdc], 100 * W, takerData(true, trader));
    }

    function test_BuysDepeggedCoinAtDiscount() public {
        (ISwapVM.Order memory order, bytes32 h) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        depeg(usde, 0.93e18);
        uint256 out = swapIn(order, usde, usdc, 100 * W);
        uint256 want = expected(100 * W, 0.93e18, 0, 200, 1000, 10_000 * W) / 1e12;
        assertApproxEqAbs(out, want, 2);
        assertEq(aquaBalance(lp, h, usde), 100 * W, "absorbed coin lands in the maker wallet");
        assertEq(MockStablecoin(tokens[usde]).balanceOf(lp), 100 * W);
    }

    function test_DiscountGrowsWithSize() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        depeg(usde, 0.93e18);
        uint256 first = swapIn(order, usde, usdc, 100 * W);
        swapIn(order, usde, usdc, 5000 * W);
        uint256 later = swapIn(order, usde, usdc, 100 * W);
        assertLt(later, first);
        assertApproxEqAbs(later, expected(100 * W, 0.93e18, 5100 * W, 200, 1000, 10_000 * W) / 1e12, 2);
    }

    function test_CapStopsBuying() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 1000), 10_000, 1);
        depeg(usde, 0.93e18);
        swapIn(order, usde, usdc, 900 * W);
        fund(trader, usde, 200 * W, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixBackstopPricing.BackstopFull.selector, tokens[usde], 100 * W));
        router.swap(order, tokens[usde], tokens[usdc], 200 * W, takerData(true, trader));
    }

    function test_RefusesHaltedPayout() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        depeg(usde, 0.93e18);
        oracle.guardianSet(tokens[dai], true);
        fund(trader, usde, 100 * W, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixBackstopPricing.PayoutHalted.selector, tokens[dai]));
        router.swap(order, tokens[usde], tokens[dai], 100 * W, takerData(true, trader));
    }

    function test_ExactOutUnsupported() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        depeg(usde, 0.93e18);
        fund(trader, usde, 200 * W, address(router));
        vm.prank(trader);
        vm.expectRevert(StabrixBackstopPricing.ExactInOnly.selector);
        router.swap(order, tokens[usde], tokens[usdc], 50 * unit(usdc), takerData(false, trader));
    }

    function test_ResumeMakesItDormantAgain() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        depeg(usde, 0.93e18);
        swapIn(order, usde, usdc, 100 * W);
        oracle.guardianSet(tokens[usde], false);
        fund(trader, usde, 100 * W, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.NotDepegged.selector, tokens[usde]));
        router.swap(order, tokens[usde], tokens[usdc], 100 * W, takerData(true, trader));
    }

    function test_UsesLowerOfCreAndMarketFeed() public {
        depeg(usde, 0.95e18);
        usdeMarket.set(0.9e8, block.timestamp);
        assertEq(oracle.depegPrice(tokens[usde]), 0.9e18);
        usdeMarket.set(0.97e8, block.timestamp);
        assertEq(oracle.depegPrice(tokens[usde]), 0.95e18);
    }

    function test_GuardianHaltUsesMarketFeed() public {
        usdeMarket.set(0.91e8, block.timestamp);
        oracle.guardianSet(tokens[usde], true);
        assertEq(oracle.depegPrice(tokens[usde]), 0.91e18);
    }

    function test_NoFreshPriceRefuses() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        oracle.guardianSet(tokens[brz], true);
        uint256 amountIn = amountFor(brz, 10);
        fund(trader, brz, amountIn, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.StaleRate.selector, tokens[brz]));
        router.swap(order, tokens[brz], tokens[usdc], amountIn, takerData(true, trader));
    }

    function test_FxCoinDepegPricesAtMarketNotFxRate() public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        eurcMarket.set(1.05e8, block.timestamp);
        depeg(eurc, 1.05e18);
        assertEq(price(eurc), 1.12e18, "face value stays at the EUR rate");
        uint256 amountIn = 100 * unit(eurc);
        uint256 out = swapIn(order, eurc, usdc, amountIn);
        uint256 faceUsd = 112 * W;
        uint256 want = 100 * W * 1.05e18 / 1e18;
        uint256 avg = 200 * 1e18 + 800 * 1e18 * faceUsd / (2 * 10_000 * W);
        want = want * (1e22 - avg) / 1e22 / 1e12;
        assertApproxEqAbs(out, want, 2);
    }

    function test_SameBalanceBacksFxRangeAndBackstop() public {
        (ISwapVM.Order memory fx,) = shipUsd(lp, deep(1, 5), 10_000, 1);
        (ISwapVM.Order memory bs,) = shipBackstop(lp, bsConfig(200, 1000, 20_000), 10_000, 2);
        uint256 walletUsdc = MockStablecoin(tokens[usdc]).balanceOf(lp);
        assertEq(walletUsdc, amountFor(usdc, 10_000), "one USDC balance pledged to both strategies");

        depeg(usde, 0.93e18);
        fund(trader, usde, 100 * W, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.Halted.selector, tokens[usde]));
        router.swap(fx, tokens[usde], tokens[usdc], 100 * W, takerData(true, trader));

        uint256 paid = swapIn(bs, usde, usdc, 8000 * W);
        assertEq(MockStablecoin(tokens[usdc]).balanceOf(lp), walletUsdc - paid);

        uint256 left = MockStablecoin(tokens[usdc]).balanceOf(lp);
        uint256 amountIn = amountFor(dai, 3000);
        fund(trader, dai, amountIn, address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixPricing.InsufficientLiquidity.selector, tokens[usdc], left));
        router.swap(fx, tokens[dai], tokens[usdc], amountIn, takerData(true, trader));

        assertGt(swapIn(fx, dai, eurc, amountFor(dai, 100)), 0, "healthy pairs keep trading");
    }

    function test_BackstopOnOfficialRouterMatchesNative() public {
        AquaSwapVMRouter official =
            new AquaSwapVMRouter(address(aqua), address(0), address(this), "1inch SwapVM v1.0", "1.0.2");
        StabrixBackstopConfig.Config memory c = bsConfig(200, 1000, 10_000);
        (ISwapVM.Order memory native,) = shipBackstop(lp, c, 10_000, 1);

        ISwapVM.Order memory viaExt = lens.buildBackstopExtructionOrder(address(backstop), lp2, c, 1);
        uint256[] memory amounts = new uint256[](N);
        amounts[usdc] = amountFor(usdc, 10_000);
        MockStablecoin(tokens[usdc]).mint(lp2, amounts[usdc]);
        vm.prank(lp2);
        MockStablecoin(tokens[usdc]).approve(address(aqua), type(uint256).max);
        vm.prank(lp2);
        aqua.ship(address(official), abi.encode(viaExt), tokens, amounts);

        depeg(usde, 0.93e18);
        uint256 a = swapIn(native, usde, usdc, 250 * W);
        fund(trader, usde, 250 * W, address(official));
        vm.prank(trader);
        (, uint256 b,) = official.swap(viaExt, tokens[usde], tokens[usdc], 250 * W, takerData(true, trader));
        assertEq(a, b);
    }

    function testFuzz_SplitNeverBeatsWhole(uint256 amount, uint256 cut, uint16 marketBps) public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(100, 1500, 10_000), 10_000, 1);
        depeg(usde, uint256(bound(marketBps, 5000, 9900)) * 1e14);
        amount = bound(amount, 2 * W, 5000 * W);
        cut = bound(cut, W, amount - W);
        uint256 snap = vm.snapshotState();
        uint256 whole = swapIn(order, usde, usdc, amount);
        vm.revertToState(snap);
        uint256 split = swapIn(order, usde, usdc, cut) + swapIn(order, usde, usdc, amount - cut);
        assertLe(split, whole);
    }

    function testFuzz_NeverPaysAboveDiscountedMarket(uint256 amount, uint16 marketBps, uint8 payout) public {
        (ISwapVM.Order memory order,) = shipBackstop(lp, bsConfig(200, 1000, 10_000), 10_000, 1);
        uint256 market = uint256(bound(marketBps, 3000, 9900)) * 1e14;
        depeg(usde, market);
        amount = bound(amount, W, 9000 * W);
        uint256 j = payout % 2 == 0 ? usdc : dai;
        uint256 out = swapIn(order, usde, j, amount);
        assertLe(usdOf(j, out), amount * market / W * 9800 / 10_000);
    }
}
