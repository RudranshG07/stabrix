// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Orbital sphere pricing for one concentrated range over n stablecoins.
/// v_k = real_k * rate_k / 1e18 + floor, invariant sum_k (r - v_k)^2 = r^2, r re-derived from balances.
library StabrixMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ROUNDING_BUFFER = 1;

    struct Range {
        uint256 floor;
        uint256 sumCapRatio;
        uint16 feeBps;
        uint16 maxShareBps;
    }

    error SameToken();
    error ZeroAmount();
    error OffSurface();
    error OutOfRange();
    error InsufficientReserve();
    error RangeEdge();
    error ExposureCap();
    error ValueDecreased(uint256 rBefore, uint256 rAfter);

    function virtualBalances(uint256[] memory real, uint256[] memory rates, uint256 floor)
        internal
        pure
        returns (uint256[] memory v)
    {
        v = new uint256[](real.length);
        for (uint256 k; k < real.length; ++k) {
            v[k] = real[k] * rates[k] / WAD + floor;
        }
    }

    function radius(uint256[] memory v) internal pure returns (uint256) {
        uint256 n = v.length;
        uint256 s;
        uint256 q;
        for (uint256 k; k < n; ++k) {
            s += v[k];
            q += v[k] * v[k];
        }
        uint256 ss = s * s;
        uint256 nq = (n - 1) * q;
        if (ss < nq) revert OffSurface();
        return (s + sqrt(ss - nq)) / (n - 1);
    }

    function spotPrice(uint256[] memory real, uint256[] memory rates, Range memory p, uint256 i, uint256 j)
        internal
        pure
        returns (uint256)
    {
        uint256[] memory v = virtualBalances(real, rates, p.floor);
        uint256 r = radius(v);
        return (r - v[i]) * WAD / (r - v[j]) * rates[i] / rates[j];
    }

    function exactIn(
        uint256[] memory real,
        uint256[] memory rates,
        Range memory p,
        uint256 i,
        uint256 j,
        uint256 amountIn
    ) internal pure returns (uint256 amountOut) {
        if (i == j) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
        uint256[] memory v = virtualBalances(real, rates, p.floor);
        uint256 r = radius(v);

        uint256 vi = v[i] + amountIn * (BPS - p.feeBps) / BPS * rates[i] / WAD;
        if (vi > r) revert OutOfRange();

        uint256 rr = r * r;
        uint256 t = _sumSqExcept(v, r, i, j) + (r - vi) * (r - vi);
        if (t > rr) revert OutOfRange();

        uint256 vj = r - sqrt(rr - t);
        if (vj >= v[j]) revert ZeroAmount();
        amountOut = (v[j] - vj) * WAD / rates[j];
        // r is derived from balances on every swap, so rounding slack from one swap would otherwise
        // improve the next one; the buffer keeps split trades from beating a single trade.
        if (amountOut <= ROUNDING_BUFFER) revert ZeroAmount();
        amountOut -= ROUNDING_BUFFER;

        verify(real, rates, p, i, j, amountIn, amountOut, r);
    }

    function exactOut(
        uint256[] memory real,
        uint256[] memory rates,
        Range memory p,
        uint256 i,
        uint256 j,
        uint256 amountOut
    ) internal pure returns (uint256 amountIn) {
        if (i == j) revert SameToken();
        if (amountOut == 0) revert ZeroAmount();
        if (amountOut > real[j]) revert InsufficientReserve();
        uint256[] memory v = virtualBalances(real, rates, p.floor);
        uint256 r = radius(v);

        uint256 outNorm = _ceilDiv(amountOut * rates[j], WAD);
        if (outNorm > v[j]) revert InsufficientReserve();
        uint256 vj = v[j] - outNorm;

        uint256 rr = r * r;
        uint256 t = _sumSqExcept(v, r, i, j) + (r - vj) * (r - vj);
        if (t > rr) revert OutOfRange();

        uint256 vi = r - sqrt(rr - t);
        uint256 netNorm = vi > v[i] ? vi - v[i] : 0;
        uint256 netIn = _ceilDiv(netNorm * WAD, rates[i]);
        amountIn = _ceilDiv(netIn * BPS, BPS - p.feeBps) + ROUNDING_BUFFER;

        verify(real, rates, p, i, j, amountIn, amountOut, r);
    }

    function verify(
        uint256[] memory real,
        uint256[] memory rates,
        Range memory p,
        uint256 i,
        uint256 j,
        uint256 amountIn,
        uint256 amountOut,
        uint256 rBefore
    ) internal pure {
        if (amountOut > real[j]) revert InsufficientReserve();
        uint256 n = real.length;
        uint256[] memory next = new uint256[](n);
        for (uint256 k; k < n; ++k) {
            next[k] = real[k];
        }
        next[i] += amountIn;
        next[j] -= amountOut;

        uint256[] memory v = virtualBalances(next, rates, p.floor);
        uint256 sumV;
        uint256 total;
        uint256 heaviest;
        for (uint256 k; k < n; ++k) {
            sumV += v[k];
            total += v[k] - p.floor;
            if (v[k] > heaviest) heaviest = v[k];
        }
        if (sumV * WAD > p.sumCapRatio * rBefore && v[i] == heaviest) revert RangeEdge();
        if (p.maxShareBps < BPS && (v[i] - p.floor) * BPS > uint256(p.maxShareBps) * total) revert ExposureCap();

        uint256 rAfter = radius(v);
        if (rAfter < rBefore) revert ValueDecreased(rBefore, rAfter);
    }

    function sqrt(uint256 a) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 x = 1 << (_log2(a) >> 1);
        x = (x + a / x) >> 1;
        x = (x + a / x) >> 1;
        x = (x + a / x) >> 1;
        x = (x + a / x) >> 1;
        x = (x + a / x) >> 1;
        x = (x + a / x) >> 1;
        x = (x + a / x) >> 1;
        uint256 y = a / x;
        return x < y ? x : y;
    }

    function _sumSqExcept(uint256[] memory v, uint256 r, uint256 i, uint256 j) private pure returns (uint256 s) {
        for (uint256 k; k < v.length; ++k) {
            if (k == i || k == j) continue;
            if (v[k] > r) revert OutOfRange();
            uint256 d = r - v[k];
            s += d * d;
        }
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function _log2(uint256 x) private pure returns (uint256 r) {
        if (x >> 128 > 0) {
            x >>= 128;
            r += 128;
        }
        if (x >> 64 > 0) {
            x >>= 64;
            r += 64;
        }
        if (x >> 32 > 0) {
            x >>= 32;
            r += 32;
        }
        if (x >> 16 > 0) {
            x >>= 16;
            r += 16;
        }
        if (x >> 8 > 0) {
            x >>= 8;
            r += 8;
        }
        if (x >> 4 > 0) {
            x >>= 4;
            r += 4;
        }
        if (x >> 2 > 0) {
            x >>= 2;
            r += 2;
        }
        if (x >> 1 > 0) r += 1;
    }
}
