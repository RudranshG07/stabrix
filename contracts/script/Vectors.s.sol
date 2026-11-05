// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraits} from "@1inch/swap-vm/src/libs/MakerTraits.sol";

import {StabrixRouter} from "../src/StabrixRouter.sol";
import {StabrixLens} from "../src/StabrixLens.sol";
import {StabrixConfig} from "../src/StabrixConfig.sol";
import {StabrixMath} from "../src/StabrixMath.sol";

contract MathHarness {
    function exactIn(
        uint256[] memory real,
        uint256[] memory rates,
        StabrixMath.Range memory p,
        uint256 i,
        uint256 j,
        uint256 a
    ) external pure returns (uint256) {
        return StabrixMath.exactIn(real, rates, p, i, j, a);
    }

    function exactOut(
        uint256[] memory real,
        uint256[] memory rates,
        StabrixMath.Range memory p,
        uint256 i,
        uint256 j,
        uint256 a
    ) external pure returns (uint256) {
        return StabrixMath.exactOut(real, rates, p, i, j, a);
    }

    function radius(uint256[] memory real, uint256[] memory rates, uint256 floor) external pure returns (uint256) {
        return StabrixMath.radius(StabrixMath.virtualBalances(real, rates, floor));
    }
}

contract Vectors is Script {
    function run() external {
        StabrixRouter router = new StabrixRouter(address(1), address(0), address(0xBEEF));
        StabrixLens lens = new StabrixLens(address(1));
        MathHarness h = new MathHarness();

        StabrixConfig.Config memory c;
        c.tokens = new address[](5);
        c.decimals = new uint8[](5);
        uint8[5] memory decs = [6, 6, 18, 6, 18];
        for (uint256 k; k < 5; ++k) {
            c.tokens[k] = address(uint160(0x1111111111111111111111111111111111111111) * uint160(k + 1));
            c.decimals[k] = decs[k];
        }
        c.floor = 900e18;
        c.sumCapRatio = 2.79e18;
        c.feeBps = 4;
        c.maxShareBps = 3000;
        c.sentinel = address(0x9999999999999999999999999999999999999999);

        address maker = address(0xA11CE);
        address ext = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        ISwapVM.Order memory nativeOrder = lens.buildOrder(address(router), maker, c, 7);
        ISwapVM.Order memory officialOrder = lens.buildExtructionOrder(ext, maker, c, 7);

        string memory json = string.concat(
            "{\"config\":\"",
            vm.toString(lens.encodeConfig(c)),
            "\",\"nativeData\":\"",
            vm.toString(nativeOrder.data),
            "\",\"nativeTraits\":\"",
            vm.toString(MakerTraits.unwrap(nativeOrder.traits)),
            "\",\"nativeHash\":\"",
            vm.toString(keccak256(abi.encode(nativeOrder))),
            "\",\"officialData\":\"",
            vm.toString(officialOrder.data),
            "\",\"officialHash\":\"",
            vm.toString(keccak256(abi.encode(officialOrder))),
            "\",\"stabrixOpcode\":",
            vm.toString(router.stabrixOpcode()),
            ",\"cases\":[",
            _cases(h),
            "]}"
        );
        vm.writeFile("../sdk/test/vectors.json", json);
    }

    function _cases(MathHarness h) internal view returns (string memory out) {
        uint8[5] memory decs = [6, 6, 18, 6, 18];
        for (uint256 t; t < 40; ++t) {
            uint256 seed = uint256(keccak256(abi.encode(t)));
            uint256[] memory real = new uint256[](5);
            uint256[] memory rates = new uint256[](5);
            for (uint256 k; k < 5; ++k) {
                uint256 units = 60 + (uint256(keccak256(abi.encode(seed, k))) % 80);
                real[k] = units * 10 ** decs[k] + (uint256(keccak256(abi.encode(seed, k, 1))) % 10 ** decs[k]);
                rates[k] = 10 ** (36 - decs[k]);
            }
            StabrixMath.Range memory p = StabrixMath.Range({
                floor: (seed % 4) * 300e18,
                sumCapRatio: 2.9e18,
                feeBps: uint16(seed % 31),
                maxShareBps: t % 5 == 0 ? 3500 : 10_000
            });
            uint256 i = seed % 5;
            uint256 j = (i + 1 + (seed >> 8) % 4) % 5;
            uint256 amount = ((seed >> 16) % (30 * 10 ** decs[i])) + 1000;
            string memory inRes;
            string memory outRes;
            try h.exactIn(real, rates, p, i, j, amount) returns (uint256 v) {
                inRes = vm.toString(v);
            } catch {
                inRes = "revert";
            }
            try h.exactOut(real, rates, p, i, j, amount % (real[j] / 2) + 1) returns (uint256 v) {
                outRes = vm.toString(v);
            } catch {
                outRes = "revert";
            }
            string memory reals = string.concat(
                vm.toString(real[0]),
                ",",
                vm.toString(real[1]),
                ",",
                vm.toString(real[2]),
                ",",
                vm.toString(real[3]),
                ",",
                vm.toString(real[4])
            );
            out = string.concat(
                out,
                t == 0 ? "" : ",",
                "{\"real\":\"",
                reals,
                "\",\"floor\":\"",
                vm.toString(p.floor),
                "\",\"fee\":",
                vm.toString(p.feeBps),
                ",\"maxShare\":",
                vm.toString(p.maxShareBps),
                ",\"i\":",
                vm.toString(i),
                ",\"j\":",
                vm.toString(j),
                ",\"amount\":\"",
                vm.toString(amount),
                "\",\"outAmount\":\"",
                vm.toString(amount % (real[j] / 2) + 1),
                "\",\"exactIn\":\"",
                inRes,
                "\",\"exactOut\":\"",
                outRes,
                "\",\"radius\":\"",
                vm.toString(h.radius(real, rates, p.floor)),
                "\"}"
            );
        }
    }
}
