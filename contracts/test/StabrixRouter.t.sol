// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {AquaSwapVMRouter} from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

import {StabrixFixture} from "./utils/StabrixFixture.sol";
import {StabrixPricing} from "../src/StabrixPricing.sol";
import {StabrixExtruction} from "../src/StabrixExtruction.sol";
import {StabrixBatchTaker} from "../src/StabrixBatchTaker.sol";
import {StabrixMath} from "../src/StabrixMath.sol";
import {StabrixOracle} from "../src/StabrixOracle.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";

contract StabrixRouterTest is StabrixFixture {
    function test_LpFundsStayInWallet() public {
        (, bytes32 h) = ship(lp, config(1, 10_000, false), 100, 1);
        for (uint256 k; k < N; ++k) {
            assertEq(MockStablecoin(tokens[k]).balanceOf(lp), 100 * unit(k));
            assertEq(MockStablecoin(tokens[k]).balanceOf(address(aqua)), 0);
            assertEq(aquaBalance(lp, h, k), 100 * unit(k));
        }
    }

    function test_SwapEveryPair() public {
        (ISwapVM.Order memory order, bytes32 h) = ship(lp, config(1, 10_000, false), 100, 1);
        for (uint256 i; i < N; ++i) {
            for (uint256 j; j < N; ++j) {
                if (i == j) continue;
                uint256 snap = vm.snapshotState();
                uint256 before = MockStablecoin(tokens[j]).balanceOf(trader);
                uint256 lpBefore = MockStablecoin(tokens[j]).balanceOf(lp);
                uint256 out = swapIn(order, i, j, unit(i));
                assertGt(out, unit(j) * 99 / 100);
                assertLt(out, unit(j));
                assertEq(MockStablecoin(tokens[j]).balanceOf(trader) - before, out);
                assertEq(lpBefore - MockStablecoin(tokens[j]).balanceOf(lp), out);
                assertEq(aquaBalance(lp, h, j), MockStablecoin(tokens[j]).balanceOf(lp));
                assertEq(aquaBalance(lp, h, i), MockStablecoin(tokens[i]).balanceOf(lp));
                vm.revertToState(snap);
            }
        }
    }

    function test_QuoteEqualsSwap() public {
        (ISwapVM.Order memory order,) = ship(lp, config(5, 10_000, false), 100, 1);
        uint256 q = quoteIn(order, 0, 3, 7 * unit(0));
        uint256 s = swapIn(order, 0, 3, 7 * unit(0));
        assertEq(q, s);
    }

    function test_ExactOut() public {
        (ISwapVM.Order memory order,) = ship(lp, config(5, 10_000, false), 100, 1);
        uint256 want = 5 * unit(2);
        fund(trader, 1, 10 * unit(1), address(router));
        vm.prank(trader);
        (uint256 paid, uint256 got,) = router.swap(order, tokens[1], tokens[2], want, takerData(false, trader));
        assertEq(got, want);
        assertGt(paid, 5 * unit(1));
        assertLt(paid, 5 * unit(1) * 101 / 100);
    }

    function test_RevertWhenTokenNotInRange() public {
        (ISwapVM.Order memory order,) = ship(lp, config(1, 10_000, false), 100, 1);
        MockStablecoin stray = new MockStablecoin("X", "X", 18);
        stray.mint(trader, W);
        vm.prank(trader);
        stray.approve(address(router), W);
        vm.prank(trader);
        vm.expectRevert();
        router.swap(order, address(stray), tokens[0], W, takerData(true, trader));
    }

    function test_DockedRangeStopsTrading() public {
        (ISwapVM.Order memory order, bytes32 h) = ship(lp, config(1, 10_000, false), 100, 1);
        vm.prank(lp);
        aqua.dock(address(router), h, tokens);
        fund(trader, 0, unit(0), address(router));
        vm.prank(trader);
        vm.expectRevert();
        router.swap(order, tokens[0], tokens[1], unit(0), takerData(true, trader));
    }

    function test_OracleHaltBlocksInflowOnly() public {
        (ISwapVM.Order memory order,) = ship(lp, config(1, 10_000, true), 100, 1);
        oracle.guardianSet(tokens[4], true);

        fund(trader, 4, unit(4), address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.Halted.selector, tokens[4]));
        router.swap(order, tokens[4], tokens[0], unit(4), takerData(true, trader));

        uint256 out = swapIn(order, 0, 4, unit(0));
        assertGt(out, 0);
    }

    function test_OracleReportFromForwarder() public {
        (ISwapVM.Order memory order,) = ship(lp, config(1, 10_000, true), 100, 1);
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        bool[] memory hlt = new bool[](1);
        t[0] = tokens[2];
        p[0] = 0.91e18;
        hlt[0] = true;
        bytes memory report = abi.encode(t, p, hlt, uint64(block.timestamp));

        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.UnauthorizedForwarder.selector, address(this)));
        oracle.onReport("", report);

        vm.prank(forwarder);
        oracle.onReport("", report);
        assertTrue(oracle.isHalted(tokens[2]));

        hlt[0] = false;
        vm.prank(forwarder);
        oracle.onReport("", abi.encode(t, p, hlt, uint64(block.timestamp)));
        assertTrue(oracle.isHalted(tokens[2]), "stale report ignored");

        fund(trader, 2, unit(2), address(router));
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.Halted.selector, tokens[2]));
        router.swap(order, tokens[2], tokens[0], unit(2), takerData(true, trader));
    }

    function test_OracleWorkflowOwnerCheck() public {
        address owner_ = makeAddr("workflowOwner");
        oracle.setWorkflowOwner(owner_);
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        bool[] memory hlt = new bool[](1);
        t[0] = tokens[0];
        p[0] = 1e18;
        bytes memory report = abi.encode(t, p, hlt, uint64(1));

        bytes memory wrong = abi.encodePacked(bytes32(0), bytes10(0), makeAddr("intruder"));
        vm.prank(forwarder);
        vm.expectRevert();
        oracle.onReport(wrong, report);

        vm.prank(forwarder);
        oracle.onReport(abi.encodePacked(bytes32(0), bytes10(0), owner_), report);
        (,, uint128 price) = oracle.status(tokens[0]);
        assertEq(price, 1e18);
    }

    function test_SupportsReceiverInterface() public view {
        assertTrue(oracle.supportsInterface(0x805f2132));
        assertTrue(oracle.supportsInterface(0x01ffc9a7));
    }

    function test_BatchAcrossRangesBeatsSingleRange() public {
        (ISwapVM.Order memory a,) = ship(lp, config(1, 10_000, false), 100, 1);
        (ISwapVM.Order memory b,) = ship(lp2, config(1, 10_000, false), 100, 2);
        uint256 amount = 40 * unit(0);
        uint256 single = quoteIn(a, 0, 1, amount);

        StabrixBatchTaker.Leg[] memory legs = new StabrixBatchTaker.Leg[](2);
        legs[0] = StabrixBatchTaker.Leg(ISwapVM(address(router)), a, amount / 2);
        legs[1] = StabrixBatchTaker.Leg(ISwapVM(address(router)), b, amount - amount / 2);
        fund(trader, 0, amount, address(batch));
        vm.prank(trader);
        uint256 out = batch.swapExactIn(tokens[0], tokens[1], legs, single, trader, uint40(block.timestamp));
        assertGt(out, single);
        assertEq(MockStablecoin(tokens[1]).balanceOf(trader), out);
        assertEq(MockStablecoin(tokens[0]).balanceOf(address(batch)), 0);
    }

    function test_BatchMinOutProtects() public {
        (ISwapVM.Order memory a,) = ship(lp, config(1, 10_000, false), 100, 1);
        StabrixBatchTaker.Leg[] memory legs = new StabrixBatchTaker.Leg[](1);
        legs[0] = StabrixBatchTaker.Leg(ISwapVM(address(router)), a, unit(0));
        fund(trader, 0, unit(0), address(batch));
        vm.prank(trader);
        vm.expectRevert();
        batch.swapExactIn(tokens[0], tokens[1], legs, unit(1), trader, uint40(block.timestamp));
    }

    function test_DepegTightRangeCapsLoss() public {
        (ISwapVM.Order memory order,) = ship(lp, config(1, 10_000, false), 100, 1);
        uint256 dumped;
        while (dumped < 1000) {
            fund(trader, 4, 2 * unit(4), address(router));
            vm.prank(trader);
            try router.swap(order, tokens[4], tokens[0], 2 * unit(4), takerData(true, trader)) {
                dumped += 2;
            } catch {
                break;
            }
        }
        assertLt(dumped, 200);
        for (uint256 k = 1; k < 4; ++k) {
            assertEq(MockStablecoin(tokens[k]).balanceOf(lp), 100 * unit(k));
        }
    }

    function test_HealthyPairsTradeAfterDepegHitsEdge() public {
        (ISwapVM.Order memory order,) = ship(lp, config(1, 10_000, false), 100, 1);
        uint256 refusals;
        for (uint256 k; refusals < 4 && k < 400; ++k) {
            uint256 j = k % 4;
            fund(trader, 4, unit(4), address(router));
            vm.prank(trader);
            try router.swap(order, tokens[4], tokens[j], unit(4), takerData(true, trader)) {
                refusals = 0;
            } catch {
                ++refusals;
            }
        }
        assertEq(refusals, 4, "every outlet refuses the depegged coin");

        uint256 out = swapIn(order, 1, 2, 5 * unit(1));
        assertGt(out, 0, "healthy pair keeps trading at the edge");

        fund(trader, 4, unit(4), address(router));
        vm.prank(trader);
        vm.expectRevert(StabrixMath.RangeEdge.selector);
        router.swap(order, tokens[4], tokens[2], unit(4), takerData(true, trader));
    }

    function test_ExposureCapStopsDump() public {
        (ISwapVM.Order memory order,) = ship(lp, config(1, 3000, false), 100, 1);
        while (true) {
            fund(trader, 4, 2 * unit(4), address(router));
            vm.prank(trader);
            try router.swap(order, tokens[4], tokens[0], 2 * unit(4), takerData(true, trader)) {}
            catch {
                break;
            }
        }
        uint256 total;
        for (uint256 k; k < N; ++k) {
            total += MockStablecoin(tokens[k]).balanceOf(lp) * W / unit(k);
        }
        assertLe(MockStablecoin(tokens[4]).balanceOf(lp) * W / unit(4) * 10_000, 3000 * total);
    }

    function test_ExtructionOnOfficialRouterMatchesNative() public {
        AquaSwapVMRouter official =
            new AquaSwapVMRouter(address(aqua), address(0), address(this), "1inch SwapVM v1.0", "1.0.2");
        StabrixExtruction ext = new StabrixExtruction(address(aqua));

        (ISwapVM.Order memory native,) = ship(lp, config(5, 10_000, false), 100, 1);

        ISwapVM.Order memory viaExt = lens.buildExtructionOrder(address(ext), lp2, config(5, 10_000, false), 1);
        uint256[] memory amounts = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            amounts[k] = 100 * unit(k);
            MockStablecoin(tokens[k]).mint(lp2, amounts[k]);
            vm.prank(lp2);
            MockStablecoin(tokens[k]).approve(address(aqua), type(uint256).max);
        }
        vm.prank(lp2);
        aqua.ship(address(official), abi.encode(viaExt), tokens, amounts);

        uint256 nativeOut = swapIn(native, 2, 0, 9 * unit(2));
        fund(trader, 2, 9 * unit(2), address(official));
        vm.prank(trader);
        (, uint256 extOut,) = official.swap(viaExt, tokens[2], tokens[0], 9 * unit(2), takerData(true, trader));
        assertEq(extOut, nativeOut);
    }

    function test_BatchAcrossBothVenuesInOneTx() public {
        AquaSwapVMRouter official =
            new AquaSwapVMRouter(address(aqua), address(0), address(this), "1inch SwapVM v1.0", "1.0.2");
        StabrixExtruction ext = new StabrixExtruction(address(aqua));
        (ISwapVM.Order memory native,) = ship(lp, config(1, 10_000, false), 100, 1);

        ISwapVM.Order memory viaExt = lens.buildExtructionOrder(address(ext), lp2, config(1, 10_000, false), 1);
        uint256[] memory amounts = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            amounts[k] = 100 * unit(k);
            MockStablecoin(tokens[k]).mint(lp2, amounts[k]);
            vm.prank(lp2);
            MockStablecoin(tokens[k]).approve(address(aqua), type(uint256).max);
        }
        vm.prank(lp2);
        aqua.ship(address(official), abi.encode(viaExt), tokens, amounts);

        StabrixBatchTaker.Leg[] memory legs = new StabrixBatchTaker.Leg[](2);
        legs[0] = StabrixBatchTaker.Leg(ISwapVM(address(router)), native, 20 * unit(3));
        legs[1] = StabrixBatchTaker.Leg(ISwapVM(address(official)), viaExt, 20 * unit(3));
        fund(trader, 3, 40 * unit(3), address(batch));
        vm.prank(trader);
        uint256 out = batch.swapExactIn(tokens[3], tokens[1], legs, 39 * unit(1), trader, uint40(block.timestamp));
        assertEq(MockStablecoin(tokens[1]).balanceOf(trader), out);
        assertEq(MockStablecoin(tokens[3]).allowance(address(batch), address(router)), 0);
        assertEq(MockStablecoin(tokens[3]).allowance(address(batch), address(official)), 0);
    }

    function testFuzz_RouterNeverDrainsLp(uint256 seed) public {
        (ISwapVM.Order memory order, bytes32 h) = ship(lp, config(3, 10_000, false), 100, 1);
        uint256 r0 = _radius(h);
        for (uint256 t; t < 6; ++t) {
            seed = uint256(keccak256(abi.encode(seed, t)));
            uint256 i = seed % N;
            uint256 j = (i + 1 + (seed >> 8) % (N - 1)) % N;
            uint256 amt = bound(seed >> 16, unit(i) / 1000, 40 * unit(i));
            fund(trader, i, amt, address(router));
            vm.prank(trader);
            try router.swap(order, tokens[i], tokens[j], amt, takerData(true, trader)) {} catch {}
            uint256 r = _radius(h);
            assertGe(r, r0);
            r0 = r;
        }
    }

    function _radius(bytes32 h) internal view returns (uint256) {
        uint256[] memory real = new uint256[](N);
        uint256[] memory rates = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            real[k] = aquaBalance(lp, h, k);
            rates[k] = 10 ** (36 - decimals[k]);
        }
        return StabrixMath.radius(StabrixMath.virtualBalances(real, rates, 900 * W));
    }
}
