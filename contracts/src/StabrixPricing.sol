// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";

import {StabrixMath} from "./StabrixMath.sol";
import {StabrixConfig} from "./StabrixConfig.sol";
import {IStabrixOracle} from "./interfaces/IStabrixOracle.sol";

library StabrixPricing {
    error TokenNotInRange(address token);
    error StrategyMismatch(address token, uint8 tokensCount);
    error RecomputeDetected();
    error InsufficientLiquidity(address token, uint256 available);

    function price(IAqua aqua, address app, SwapQuery memory q, SwapRegisters memory s, bytes calldata args)
        internal
        view
        returns (SwapRegisters memory)
    {
        StabrixConfig.Decoded memory d = StabrixConfig.decode(args);
        uint256 n = d.tokens.length;
        (uint256[] memory real, uint256 i, uint256 j) = load(aqua, app, q, d.tokens);

        if (d.oracle != address(0)) {
            (uint256[] memory p, uint256 fxMask) = IStabrixOracle(d.oracle).prices(d.tokens, q.tokenIn);
            for (uint256 k; k < n; ++k) {
                d.rates[k] = d.rates[k] * p[k] / StabrixMath.WAD;
            }
            if (fxMask & ((1 << i) | (1 << j)) != 0) d.range.feeBps = d.fxFeeBps;
        }

        if (q.isExactIn) {
            if (s.amountOut != 0) revert RecomputeDetected();
            s.amountOut = StabrixMath.exactIn(real, d.rates, d.range, i, j, s.amountIn);
            checkWallet(aqua, q.maker, q.tokenOut, s.amountOut);
        } else {
            if (s.amountIn != 0) revert RecomputeDetected();
            checkWallet(aqua, q.maker, q.tokenOut, s.amountOut);
            s.amountIn = StabrixMath.exactOut(real, d.rates, d.range, i, j, s.amountOut);
        }
        return s;
    }

    function load(IAqua aqua, address app, SwapQuery memory q, address[] memory tokens)
        internal
        view
        returns (uint256[] memory real, uint256 i, uint256 j)
    {
        uint256 n = tokens.length;
        i = type(uint256).max;
        j = type(uint256).max;
        real = new uint256[](n);
        for (uint256 k; k < n; ++k) {
            (uint248 balance, uint8 count) = aqua.rawBalances(q.maker, app, q.orderHash, tokens[k]);
            if (count != n) revert StrategyMismatch(tokens[k], count);
            real[k] = balance;
            if (tokens[k] == q.tokenIn) i = k;
            else if (tokens[k] == q.tokenOut) j = k;
        }
        if (i == type(uint256).max) revert TokenNotInRange(q.tokenIn);
        if (j == type(uint256).max) revert TokenNotInRange(q.tokenOut);
    }

    function spendable(IAqua aqua, address maker, address token) internal view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(maker);
        uint256 allowance = IERC20(token).allowance(maker, address(aqua));
        return balance < allowance ? balance : allowance;
    }

    function checkWallet(IAqua aqua, address maker, address token, uint256 amountOut) internal view {
        uint256 available = spendable(aqua, maker, token);
        if (amountOut > available) revert InsufficientLiquidity(token, available);
    }
}
