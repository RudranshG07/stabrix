// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch/swap-vm/src/libs/MakerTraits.sol";

import {StabrixConfig} from "./StabrixConfig.sol";
import {StabrixBackstopConfig} from "./StabrixBackstopConfig.sol";
import {StabrixPricing} from "./StabrixPricing.sol";

interface IStabrixRouter {
    function stabrixOpcode() external pure returns (uint8);
    function backstopOpcode() external pure returns (uint8);
    function saltOpcode() external pure returns (uint8);
    function hash(ISwapVM.Order calldata order) external view returns (bytes32);
}

contract StabrixLens {
    uint8 public constant OFFICIAL_EXTRUCTION_OPCODE = 32;
    uint8 public constant OFFICIAL_SALT_OPCODE = 20;

    IAqua public immutable AQUA;

    error ArgsTooLong(uint256 length);

    constructor(address aqua) {
        AQUA = IAqua(aqua);
    }

    function encodeConfig(StabrixConfig.Config calldata c) public pure returns (bytes memory) {
        return StabrixConfig.encode(c);
    }

    function buildOrder(address router, address maker, StabrixConfig.Config calldata c, uint64 salt)
        external
        view
        returns (ISwapVM.Order memory)
    {
        bytes memory args = StabrixConfig.encode(c);
        bytes memory program = bytes.concat(
            _instruction(IStabrixRouter(router).stabrixOpcode(), args),
            _instruction(IStabrixRouter(router).saltOpcode(), abi.encodePacked(salt))
        );
        return _order(maker, program);
    }

    function buildExtructionOrder(address extruction, address maker, StabrixConfig.Config calldata c, uint64 salt)
        external
        pure
        returns (ISwapVM.Order memory)
    {
        bytes memory args = abi.encodePacked(extruction, StabrixConfig.encode(c));
        bytes memory program = bytes.concat(
            _instruction(OFFICIAL_EXTRUCTION_OPCODE, args), _instruction(OFFICIAL_SALT_OPCODE, abi.encodePacked(salt))
        );
        return _order(maker, program);
    }

    function encodeBackstopConfig(StabrixBackstopConfig.Config calldata c) public pure returns (bytes memory) {
        return StabrixBackstopConfig.encode(c);
    }

    function buildBackstopOrder(address router, address maker, StabrixBackstopConfig.Config calldata c, uint64 salt)
        external
        view
        returns (ISwapVM.Order memory)
    {
        bytes memory program = bytes.concat(
            _instruction(IStabrixRouter(router).backstopOpcode(), StabrixBackstopConfig.encode(c)),
            _instruction(IStabrixRouter(router).saltOpcode(), abi.encodePacked(salt))
        );
        return _order(maker, program);
    }

    function buildBackstopExtructionOrder(
        address backstop,
        address maker,
        StabrixBackstopConfig.Config calldata c,
        uint64 salt
    ) external pure returns (ISwapVM.Order memory) {
        bytes memory args = abi.encodePacked(backstop, StabrixBackstopConfig.encode(c));
        bytes memory program = bytes.concat(
            _instruction(OFFICIAL_EXTRUCTION_OPCODE, args), _instruction(OFFICIAL_SALT_OPCODE, abi.encodePacked(salt))
        );
        return _order(maker, program);
    }

    function balances(address router, ISwapVM.Order calldata order, address[] calldata tokens)
        external
        view
        returns (bytes32 strategyHash, uint256[] memory amounts, bool active)
    {
        strategyHash = IStabrixRouter(router).hash(order);
        amounts = new uint256[](tokens.length);
        active = true;
        for (uint256 k; k < tokens.length; ++k) {
            (uint248 b, uint8 count) = AQUA.rawBalances(order.maker, router, strategyHash, tokens[k]);
            amounts[k] = b;
            if (count != tokens.length) active = false;
        }
    }

    function spendable(address maker, address[] calldata tokens) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](tokens.length);
        for (uint256 k; k < tokens.length; ++k) {
            amounts[k] = StabrixPricing.spendable(AQUA, maker, tokens[k]);
        }
    }

    function _instruction(uint8 opcode, bytes memory args) private pure returns (bytes memory) {
        if (args.length > type(uint8).max) revert ArgsTooLong(args.length);
        return abi.encodePacked(opcode, uint8(args.length), args);
    }

    function _order(address maker, bytes memory program) private pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                receiver: address(0),
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );
    }
}
