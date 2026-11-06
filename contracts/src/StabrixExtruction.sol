// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";

import {StabrixPricing} from "./StabrixPricing.sol";

/// @notice Stabrix pricing for both venues. The official router reaches it through Extruction,
/// StabrixRouter through price(). The caller is the Aqua app.
contract StabrixExtruction {
    IAqua public immutable AQUA;

    constructor(address aqua) {
        AQUA = IAqua(aqua);
    }

    function extruction(
        bool,
        uint256 nextPC,
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata
    ) external view returns (uint256, uint256, SwapRegisters memory) {
        return (nextPC, 0, StabrixPricing.price(AQUA, msg.sender, query, swap, args));
    }

    function price(SwapQuery calldata query, SwapRegisters calldata swap, bytes calldata args)
        external
        view
        returns (SwapRegisters memory)
    {
        return StabrixPricing.price(AQUA, msg.sender, query, swap, args);
    }
}
