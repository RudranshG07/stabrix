// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

contract MockFeed is IAggregatorV3 {
    uint8 public immutable decimals;
    address public immutable owner;
    int256 public answer;
    uint256 public updatedAt;

    error NotOwner();

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        owner = msg.sender;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        if (msg.sender != owner) revert NotOwner();
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
