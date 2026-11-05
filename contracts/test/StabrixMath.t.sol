// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StabrixMath} from "../src/StabrixMath.sol";

contract RangeHarness {
    uint256[] public real;
    uint256[] public rates;
    StabrixMath.Range public range;

    constructor(uint256[] memory real_, uint256[] memory rates_, StabrixMath.Range memory range_) {
        real = real_;
        rates = rates_;
        range = range_;
    }

    function state() public view returns (uint256[] memory, uint256[] memory, StabrixMath.Range memory) {
        return (real, rates, range);
    }

    function swapIn(uint256 i, uint256 j, uint256 amountIn) external returns (uint256 out) {
        (uint256[] memory r, uint256[] memory q, StabrixMath.Range memory p) = state();
        out = StabrixMath.exactIn(r, q, p, i, j, amountIn);
        real[i] += amountIn;
        real[j] -= out;
    }

    function swapOut(uint256 i, uint256 j, uint256 amountOut) external returns (uint256 inAmt) {
        (uint256[] memory r, uint256[] memory q, StabrixMath.Range memory p) = state();
        inAmt = StabrixMath.exactOut(r, q, p, i, j, amountOut);
        real[i] += inAmt;
        real[j] -= amountOut;
    }

    function quoteIn(uint256 i, uint256 j, uint256 amountIn) external view returns (uint256) {
        (uint256[] memory r, uint256[] memory q, StabrixMath.Range memory p) = state();
        return StabrixMath.exactIn(r, q, p, i, j, amountIn);
    }

    function quoteOut(uint256 i, uint256 j, uint256 amountOut) external view returns (uint256) {
        (uint256[] memory r, uint256[] memory q, StabrixMath.Range memory p) = state();
        return StabrixMath.exactOut(r, q, p, i, j, amountOut);
    }

    function radiusNow() external view returns (uint256) {
        return StabrixMath.radius(StabrixMath.virtualBalances(real, rates, range.floor));
    }

    function balance(uint256 k) external view returns (uint256) {
        return real[k];
    }
}

contract StabrixMathTest is Test {
    uint256 constant W = 1e18;
    uint256 constant N = 5;

    // n=5, 1000 virtual per coin at the equal-price point; floor 900 => 100 real per coin
    function _range(uint16 fee, uint16 maxShare, uint256 capRatio, uint256 floor_) internal returns (RangeHarness) {
        uint256[] memory real = new uint256[](N);
        uint256[] memory rates = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            real[k] = 1000 * W - floor_;
            rates[k] = W;
        }
        return new RangeHarness(real, rates, StabrixMath.Range(floor_, capRatio, fee, maxShare));
    }

    function _default() internal returns (RangeHarness) {
        return _range(1, 10_000, 2.79e18, 900 * W);
    }

    function test_Radius_MatchesReference() public {
        assertEq(_default().radiusNow(), 1809016994374947424102);
    }

    function test_ExactIn_MatchesReference() public {
        assertEq(_default().quoteIn(0, 2, 10 * W), 9876917581896904370);
    }

    function test_ExactOut_IsInverseOfExactIn() public {
        RangeHarness h = _default();
        uint256 out = h.quoteIn(0, 2, 10 * W);
        assertApproxEqAbs(h.quoteOut(0, 2, out), 10 * W, 2); // SwapVM symmetry tolerance: 2 wei
    }

    function test_NearPegSlippageIsSmall() public {
        uint256 out = _default().quoteIn(1, 3, 1 * W); // 0.2% of TVL
        assertGt(out, 0.998e18);
        assertLt(out, 1e18);
    }

    function test_FeesCompoundIntoRadius() public {
        RangeHarness h = _range(30, 10_000, 2.79e18, 900 * W);
        uint256 r0 = h.radiusNow();
        for (uint256 t; t < 20; ++t) {
            h.swapIn(t % N, (t + 1) % N, 2 * W);
            h.swapIn((t + 1) % N, t % N, 2 * W);
        }
        assertGt(h.radiusNow(), r0, "LP position grew from fees");
    }

    function test_RangeEdgeStopsDump() public {
        RangeHarness h = _default();
        uint256 absorbed;
        while (true) {
            try h.swapIn(4, 0, 2 * W) {
                absorbed += 2;
            } catch {
                break;
            }
        }
        assertGt(absorbed, 0);
        assertLt(absorbed, 200, "range stops before the pool fills with the bad coin");
        assertGt(h.balance(1), 99 * W, "untouched coins stay untouched");
    }

    function test_ExposureCapStopsDump() public {
        RangeHarness h = _range(1, 3000, 2.79e18, 900 * W); // max 30% in any coin
        while (true) {
            try h.swapIn(4, 0, 2 * W) {}
            catch (bytes memory err) {
                bytes4 sel = bytes4(err);
                assertTrue(sel == StabrixMath.ExposureCap.selector || sel == StabrixMath.RangeEdge.selector);
                break;
            }
        }
        uint256 total;
        for (uint256 k; k < N; ++k) {
            total += h.balance(k);
        }
        assertLe(h.balance(4) * 10_000, 3000 * total);
    }

    function test_MixedDecimals_SamePrice() public {
        uint256[] memory real = new uint256[](N);
        uint256[] memory rates = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            real[k] = 100 * W;
            rates[k] = W;
        }
        real[2] = 100e6; // 6-decimal stablecoin
        rates[2] = 1e30; // scale 1e6 -> 1e18
        RangeHarness mixed = new RangeHarness(real, rates, StabrixMath.Range(900 * W, 2.79e18, 1, 10_000));
        uint256 outMixed = mixed.quoteIn(0, 2, 10 * W);
        uint256 outRef = _default().quoteIn(0, 2, 10 * W);
        assertEq(outMixed, (outRef + 1) / 1e12 - 1, "6-dec output equals 18-dec output scaled down");
    }

    function test_RevertsOnSameToken() public {
        RangeHarness h = _default();
        vm.expectRevert(StabrixMath.SameToken.selector);
        h.quoteIn(1, 1, W);
    }

    function testFuzz_LPNeverLosesValue(uint256 seed, uint16 fee, uint8 floorPct) public {
        fee = uint16(bound(fee, 0, 100));
        uint256 floor_ = 10 * W * bound(floorPct, 0, 97);
        RangeHarness h = _range(fee, 10_000, 2.9e18, floor_);
        uint256 rPrev = h.radiusNow();
        for (uint256 t; t < 8; ++t) {
            seed = uint256(keccak256(abi.encode(seed, t)));
            uint256 i = seed % N;
            uint256 j = (i + 1 + (seed >> 8) % (N - 1)) % N;
            uint256 amt = bound(seed >> 16, 1, 60 * W);
            if ((seed >> 200) & 1 == 0) {
                try h.swapIn(i, j, amt) {} catch {}
            } else {
                try h.swapOut(i, j, amt) {} catch {}
            }
            uint256 rNow = h.radiusNow();
            assertGe(rNow, rPrev, "radius decreased");
            rPrev = rNow;
        }
    }

    function testFuzz_RoundTripNeverProfits(uint256 amt, uint8 a, uint8 b) public {
        RangeHarness h = _default();
        uint256 i = a % N;
        uint256 j = b % N;
        vm.assume(i != j);
        amt = bound(amt, 1e6, 50 * W);
        uint256 out;
        try h.swapIn(i, j, amt) returns (uint256 o) {
            out = o;
        } catch {
            return;
        }
        try h.swapIn(j, i, out) returns (uint256 back) {
            assertLe(back, amt);
        } catch {}
    }

    function testFuzz_SplitNeverBeatsWhole(uint256 amt, uint256 cut, uint8 a, uint8 b, uint16 fee) public {
        uint256 i = a % N;
        uint256 j = b % N;
        vm.assume(i != j);
        fee = uint16(bound(fee, 0, 100));
        amt = bound(amt, 2e6, 80 * W);
        cut = bound(cut, 1e6, amt - 1e6);
        RangeHarness whole = _range(fee, 10_000, 2.79e18, 900 * W);
        RangeHarness split = _range(fee, 10_000, 2.79e18, 900 * W);
        uint256 w;
        try whole.swapIn(i, j, amt) returns (uint256 o) {
            w = o;
        } catch {
            return;
        }
        uint256 s1;
        uint256 s2;
        try split.swapIn(i, j, cut) returns (uint256 o) {
            s1 = o;
        } catch {
            return;
        }
        try split.swapIn(i, j, amt - cut) returns (uint256 o) {
            s2 = o;
        } catch {
            return;
        }
        assertLe(s1 + s2, w + (fee > 0 ? 2 : 0));
    }

    function testFuzz_SplitNeverBeatsWhole_NoFee(uint256 amt, uint256 cut, uint8 a, uint8 b) public {
        uint256 i = a % N;
        uint256 j = b % N;
        vm.assume(i != j);
        amt = bound(amt, 2e6, 80 * W);
        cut = bound(cut, 1e6, amt - 1e6);
        RangeHarness whole = _range(0, 10_000, 2.79e18, 900 * W);
        RangeHarness split = _range(0, 10_000, 2.79e18, 900 * W);
        uint256 w;
        try whole.swapIn(i, j, amt) returns (uint256 o) {
            w = o;
        } catch {
            return;
        }
        uint256 s1;
        uint256 s2;
        try split.swapIn(i, j, cut) returns (uint256 o) {
            s1 = o;
        } catch {
            return;
        }
        try split.swapIn(i, j, amt - cut) returns (uint256 o) {
            s2 = o;
        } catch {
            return;
        }
        assertLe(s1 + s2, w);
    }

    function testFuzz_SplitNeverBeatsWhole_MixedDecimals(uint256 amt, uint256 cut) public {
        amt = bound(amt, 2e6, 80 * W);
        cut = bound(cut, 1e6, amt - 1e6);
        RangeHarness whole = _mixed();
        RangeHarness split = _mixed();
        uint256 w;
        try whole.swapIn(0, 2, amt) returns (uint256 o) {
            w = o;
        } catch {
            return;
        }
        uint256 s1;
        uint256 s2;
        try split.swapIn(0, 2, cut) returns (uint256 o) {
            s1 = o;
        } catch {
            return;
        }
        try split.swapIn(0, 2, amt - cut) returns (uint256 o) {
            s2 = o;
        } catch {
            return;
        }
        assertLe(s1 + s2, w);
    }

    function _mixed() internal returns (RangeHarness) {
        uint256[] memory real = new uint256[](N);
        uint256[] memory rates = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            real[k] = 100 * W;
            rates[k] = W;
        }
        real[2] = 100e6;
        rates[2] = 1e30;
        return new RangeHarness(real, rates, StabrixMath.Range(900 * W, 2.79e18, 1, 10_000));
    }

    function testFuzz_ExactOutMatchesExactIn(uint256 amt, uint8 a, uint8 b) public {
        RangeHarness h = _default();
        uint256 i = a % N;
        uint256 j = b % N;
        vm.assume(i != j);
        amt = bound(amt, 1e9, 50 * W);
        uint256 out;
        try h.quoteIn(i, j, amt) returns (uint256 o) {
            out = o;
        } catch {
            return;
        }
        uint256 needed = h.quoteOut(i, j, out);
        assertApproxEqAbs(needed, amt, amt / 1e12 + 2, "exact-out inverts exact-in");
    }
}
