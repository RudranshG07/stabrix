// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";

import {StabrixPricing} from "./StabrixPricing.sol";
import {StabrixBackstopConfig} from "./StabrixBackstopConfig.sol";
import {IStabrixOracle} from "./interfaces/IStabrixOracle.sol";

/// @notice Standby liquidity for depegs. Buys a token only while the oracle marks it depegged, pays only in
/// healthy tokens, at the depeg market price (never above face value) minus a discount that grows linearly from
/// start to end as the per-token cap fills. The maker's absorbed amount is its Aqua balance of that token.
library StabrixBackstopPricing {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS_TO_WAD = 1e14;

    error ExactInOnly();
    error RecomputeDetected();
    error PayoutHalted(address token);
    error BackstopFull(address token, uint256 roomE18);
    error ZeroAmount();
    error InsufficientReserve();

    function price(IAqua aqua, address app, SwapQuery memory q, SwapRegisters memory s, bytes calldata args)
        internal
        view
        returns (SwapRegisters memory)
    {
        if (!q.isExactIn) revert ExactInOnly();
        if (s.amountOut != 0) revert RecomputeDetected();
        StabrixBackstopConfig.Config memory c = StabrixBackstopConfig.decode(args);
        (uint256[] memory real, uint256 i, uint256 j) = StabrixPricing.load(aqua, app, q, c.tokens);

        IStabrixOracle oracle = IStabrixOracle(c.oracle);
        uint256 marketIn = oracle.depegPrice(q.tokenIn);
        (uint256 faceIn,,) = oracle.priceOf(q.tokenIn);
        (uint256 priceOut,, bool outHalted) = oracle.priceOf(q.tokenOut);
        if (outHalted) revert PayoutHalted(q.tokenOut);

        uint256 out = quote(
            Quote({
                token: q.tokenIn,
                amountIn: s.amountIn,
                absorbedIn: real[i],
                faceIn: faceIn,
                marketIn: marketIn,
                priceOut: priceOut,
                decimalsIn: c.decimals[i],
                decimalsOut: c.decimals[j],
                startBps: c.startDiscountBps,
                endBps: c.endDiscountBps,
                cap: c.capPerToken
            })
        );
        if (out > real[j]) revert InsufficientReserve();
        StabrixPricing.checkWallet(aqua, q.maker, q.tokenOut, out);
        s.amountOut = out;
        return s;
    }

    struct Quote {
        address token;
        uint256 amountIn;
        uint256 absorbedIn;
        uint256 faceIn;
        uint256 marketIn;
        uint256 priceOut;
        uint8 decimalsIn;
        uint8 decimalsOut;
        uint16 startBps;
        uint16 endBps;
        uint128 cap;
    }

    function quote(Quote memory x) internal pure returns (uint256 out) {
        uint256 unitIn = 10 ** x.decimalsIn;
        uint256 absorbed = x.absorbedIn * x.faceIn / unitIn;
        uint256 incoming = x.amountIn * x.faceIn / unitIn;
        if (absorbed + incoming > x.cap) revert BackstopFull(x.token, x.cap > absorbed ? x.cap - absorbed : 0);

        uint256 span = uint256(x.endBps - x.startBps);
        uint256 twoCap = 2 * uint256(x.cap);
        uint256 discount =
            _ceilDiv((uint256(x.startBps) * twoCap + span * (2 * absorbed + incoming)) * BPS_TO_WAD, twoCap);

        uint256 market = x.marketIn < x.faceIn ? x.marketIn : x.faceIn;
        uint256 valueOut = x.amountIn * market * (WAD - discount) / (unitIn * WAD);
        out = valueOut * 10 ** x.decimalsOut / x.priceOut;
        if (out <= 1) revert ZeroAmount();
        out -= 1;
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
