// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @notice FX rate for testnets that have no Chainlink FX feeds. Always current; the deployer syncs the rate
/// from Base mainnet Chainlink with ops `sync-feeds`.
contract TestnetFeed is IAggregatorV3 {
    uint8 public constant decimals = 8;
    address public immutable owner;
    int256 public answer;

    error NotOwner();

    constructor(int256 answer_) {
        owner = msg.sender;
        answer = answer_;
    }

    function set(int256 answer_) external {
        if (msg.sender != owner) revert NotOwner();
        answer = answer_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
