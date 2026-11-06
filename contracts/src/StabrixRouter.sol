// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Simulator} from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import {SwapVM} from "@1inch/swap-vm/src/SwapVM.sol";
import {AquaOpcodes} from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import {Context, SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";

interface IStabrixPricer {
    function price(SwapQuery calldata query, SwapRegisters calldata swap, bytes calldata args)
        external
        view
        returns (SwapRegisters memory);
}

contract StabrixRouter is Simulator, SwapVM, AquaOpcodes {
    IStabrixPricer public immutable PRICER;

    constructor(address aqua, address weth, address owner, address pricer)
        SwapVM(aqua, weth, owner, "Stabrix", "1")
        AquaOpcodes(aqua)
    {
        PRICER = IStabrixPricer(pricer);
    }

    function stabrixOpcode() external pure returns (uint8) {
        return uint8(_opcodes().length);
    }

    function saltOpcode() external pure returns (uint8) {
        return 20;
    }

    function _instructions()
        internal
        pure
        override
        returns (function(Context memory, bytes calldata) internal[] memory all)
    {
        function(Context memory, bytes calldata) internal[] memory base = _opcodes();
        all = new function(Context memory, bytes calldata) internal[](base.length + 1);
        for (uint256 k; k < base.length; ++k) {
            all[k] = base[k];
        }
        all[base.length] = _stabrixTick;
    }

    function _stabrixTick(Context memory ctx, bytes calldata args) internal view {
        ctx.swap = PRICER.price(ctx.query, ctx.swap, args);
    }
}
