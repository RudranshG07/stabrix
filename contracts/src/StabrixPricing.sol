// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";

import {StabrixMath} from "./StabrixMath.sol";
import {StabrixConfig} from "./StabrixConfig.sol";
import {IDepegSentinel} from "./interfaces/IDepegSentinel.sol";

library StabrixPricing {
    error TokenNotInRange(address token);
    error StrategyMismatch(address token, uint8 tokensCount);
    error Halted(address token);
    error RecomputeDetected();

    function price(IAqua aqua, address app, SwapQuery memory q, SwapRegisters memory s, bytes calldata args)
        internal
        view
        returns (SwapRegisters memory)
    {
        (address[] memory tokens, uint256[] memory rates, StabrixMath.Range memory range, address sentinel) =
            StabrixConfig.decode(args);
        if (sentinel != address(0) && IDepegSentinel(sentinel).isHalted(q.tokenIn)) revert Halted(q.tokenIn);

        uint256 n = tokens.length;
        uint256 i = type(uint256).max;
        uint256 j = type(uint256).max;
        uint256[] memory real = new uint256[](n);
        for (uint256 k; k < n; ++k) {
            (uint248 balance, uint8 count) = aqua.rawBalances(q.maker, app, q.orderHash, tokens[k]);
            if (count != n) revert StrategyMismatch(tokens[k], count);
            real[k] = balance;
            if (tokens[k] == q.tokenIn) i = k;
            else if (tokens[k] == q.tokenOut) j = k;
        }
        if (i == type(uint256).max) revert TokenNotInRange(q.tokenIn);
        if (j == type(uint256).max) revert TokenNotInRange(q.tokenOut);

        if (q.isExactIn) {
            if (s.amountOut != 0) revert RecomputeDetected();
            s.amountOut = StabrixMath.exactIn(real, rates, range, i, j, s.amountIn);
        } else {
            if (s.amountIn != 0) revert RecomputeDetected();
            s.amountIn = StabrixMath.exactOut(real, rates, range, i, j, s.amountOut);
        }
        return s;
    }
}
