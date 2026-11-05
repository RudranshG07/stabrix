// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {StabrixMath} from "./StabrixMath.sol";

/// @notice Packed range config. SwapVM caps instruction args at 255 bytes, so n <= 9.
/// Layout: n | tokens[n] (20B) | decimals[n] (1B) | floor (16B) | sumCapRatio (8B) | fee (2B) | maxShare (2B) | sentinel (20B)
library StabrixConfig {
    uint256 internal constant MAX_TOKENS = 9;
    uint256 internal constant MAX_FEE_BPS = 1000;

    struct Config {
        address[] tokens;
        uint8[] decimals;
        uint128 floor;
        uint64 sumCapRatio;
        uint16 feeBps;
        uint16 maxShareBps;
        address sentinel;
    }

    error BadLength();
    error BadTokenCount();
    error BadDecimals();
    error BadFee();
    error BadMaxShare();
    error UnsortedTokens();

    function encode(Config memory c) internal pure returns (bytes memory out) {
        uint256 n = c.tokens.length;
        if (n < 2 || n > MAX_TOKENS || c.decimals.length != n) revert BadTokenCount();
        if (c.feeBps > MAX_FEE_BPS) revert BadFee();
        if (c.maxShareBps == 0 || c.maxShareBps > StabrixMath.BPS) revert BadMaxShare();
        out = abi.encodePacked(uint8(n));
        for (uint256 k; k < n; ++k) {
            if (k > 0 && c.tokens[k] <= c.tokens[k - 1]) revert UnsortedTokens();
            out = abi.encodePacked(out, c.tokens[k]);
        }
        for (uint256 k; k < n; ++k) {
            if (c.decimals[k] > 18) revert BadDecimals();
            out = abi.encodePacked(out, c.decimals[k]);
        }
        out = abi.encodePacked(out, c.floor, c.sumCapRatio, c.feeBps, c.maxShareBps, c.sentinel);
    }

    function decode(bytes calldata a)
        internal
        pure
        returns (address[] memory tokens, uint256[] memory rates, StabrixMath.Range memory range, address sentinel)
    {
        if (a.length == 0) {
            revert BadLength();
        }
        uint256 n = uint8(a[0]);
        if (n < 2 || n > MAX_TOKENS) revert BadTokenCount();
        if (a.length != 1 + 21 * n + 48) revert BadLength();

        tokens = new address[](n);
        rates = new uint256[](n);
        for (uint256 k; k < n; ++k) {
            tokens[k] = address(bytes20(a[1 + 20 * k:21 + 20 * k]));
            uint256 dec = uint8(a[1 + 20 * n + k]);
            if (dec > 18) revert BadDecimals();
            rates[k] = 10 ** (36 - dec);
        }

        uint256 o = 1 + 21 * n;
        range.floor = uint128(bytes16(a[o:o + 16]));
        range.sumCapRatio = uint64(bytes8(a[o + 16:o + 24]));
        range.feeBps = uint16(bytes2(a[o + 24:o + 26]));
        range.maxShareBps = uint16(bytes2(a[o + 26:o + 28]));
        sentinel = address(bytes20(a[o + 28:o + 48]));
        if (range.feeBps > MAX_FEE_BPS) revert BadFee();
        if (range.maxShareBps == 0 || range.maxShareBps > StabrixMath.BPS) revert BadMaxShare();
    }
}
