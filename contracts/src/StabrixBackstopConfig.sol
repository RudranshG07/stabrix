// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Packed backstop config. Layout: n | tokens[n] (20B) | decimals[n] (1B) | startDiscount (2B)
/// | endDiscount (2B) | capPerToken (16B, USD 1e18 at face value) | oracle (20B)
library StabrixBackstopConfig {
    uint256 internal constant MAX_TOKENS = 9;
    uint256 internal constant MAX_DISCOUNT_BPS = 5000;
    uint256 internal constant FIXED_BYTES = 40;

    struct Config {
        address[] tokens;
        uint8[] decimals;
        uint16 startDiscountBps;
        uint16 endDiscountBps;
        uint128 capPerToken;
        address oracle;
    }

    error BadLength();
    error BadTokenCount();
    error BadDecimals();
    error BadDiscount();
    error BadCap();
    error BadOracle();
    error UnsortedTokens();

    function encode(Config memory c) internal pure returns (bytes memory out) {
        uint256 n = c.tokens.length;
        if (n < 2 || n > MAX_TOKENS || c.decimals.length != n) revert BadTokenCount();
        _check(c.startDiscountBps, c.endDiscountBps, c.capPerToken, c.oracle);
        out = abi.encodePacked(uint8(n));
        for (uint256 k; k < n; ++k) {
            if (k > 0 && c.tokens[k] <= c.tokens[k - 1]) revert UnsortedTokens();
            out = abi.encodePacked(out, c.tokens[k]);
        }
        for (uint256 k; k < n; ++k) {
            if (c.decimals[k] > 18) revert BadDecimals();
            out = abi.encodePacked(out, c.decimals[k]);
        }
        out = abi.encodePacked(out, c.startDiscountBps, c.endDiscountBps, c.capPerToken, c.oracle);
    }

    function decode(bytes calldata a) internal pure returns (Config memory c) {
        if (a.length == 0) revert BadLength();
        uint256 n = uint8(a[0]);
        if (n < 2 || n > MAX_TOKENS) revert BadTokenCount();
        if (a.length != 1 + 21 * n + FIXED_BYTES) revert BadLength();
        c.tokens = new address[](n);
        c.decimals = new uint8[](n);
        for (uint256 k; k < n; ++k) {
            c.tokens[k] = address(bytes20(a[1 + 20 * k:21 + 20 * k]));
            c.decimals[k] = uint8(a[1 + 20 * n + k]);
            if (c.decimals[k] > 18) revert BadDecimals();
        }
        uint256 o = 1 + 21 * n;
        c.startDiscountBps = uint16(bytes2(a[o:o + 2]));
        c.endDiscountBps = uint16(bytes2(a[o + 2:o + 4]));
        c.capPerToken = uint128(bytes16(a[o + 4:o + 20]));
        c.oracle = address(bytes20(a[o + 20:o + 40]));
        _check(c.startDiscountBps, c.endDiscountBps, c.capPerToken, c.oracle);
    }

    function _check(uint16 start, uint16 end, uint128 cap, address oracle) private pure {
        if (start > end || end > MAX_DISCOUNT_BPS) revert BadDiscount();
        if (cap == 0) revert BadCap();
        if (oracle == address(0)) revert BadOracle();
    }
}
