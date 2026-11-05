// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IDepegSentinel {
    function isHalted(address token) external view returns (bool);
}
