// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IStabrixOracle {
    function prices(address[] calldata tokens, address tokenIn)
        external
        view
        returns (uint256[] memory pricesE18, uint256 fxMask);
}
