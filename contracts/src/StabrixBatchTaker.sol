// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "@1inch/swap-vm/src/libs/TakerTraits.sol";

contract StabrixBatchTaker {
    using SafeERC20 for IERC20;

    struct Leg {
        ISwapVM router;
        ISwapVM.Order order;
        uint256 amountIn;
    }

    error Expired();
    error NoLegs();
    error InsufficientOutput(uint256 out, uint256 minOut);

    event BatchSwapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 legs
    );

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        Leg[] calldata legs,
        uint256 minOut,
        address to,
        uint40 deadline
    ) external returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (legs.length == 0) revert NoLegs();

        uint256 total;
        for (uint256 k; k < legs.length; ++k) {
            total += legs[k].amountIn;
        }
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), total);

        bytes memory takerData = TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(this),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: to,
                deadline: deadline,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );

        for (uint256 k; k < legs.length; ++k) {
            Leg calldata leg = legs[k];
            IERC20(tokenIn).forceApprove(address(leg.router), leg.amountIn);
            (, uint256 out,) = leg.router.swap(leg.order, tokenIn, tokenOut, leg.amountIn, takerData);
            IERC20(tokenIn).forceApprove(address(leg.router), 0);
            amountOut += out;
        }
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        emit BatchSwapped(msg.sender, tokenIn, tokenOut, total, amountOut, legs.length);
    }
}
