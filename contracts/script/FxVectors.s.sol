// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";

import {StabrixRouter} from "../src/StabrixRouter.sol";
import {StabrixLens} from "../src/StabrixLens.sol";
import {StabrixMath} from "../src/StabrixMath.sol";
import {StabrixBackstopConfig} from "../src/StabrixBackstopConfig.sol";
import {StabrixBackstopPricing} from "../src/StabrixBackstopPricing.sol";

contract FxHarness {
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

    function backstop(StabrixBackstopPricing.Quote memory x) external pure returns (uint256) {
        return StabrixBackstopPricing.quote(x);
    }
}

/// forge script script/FxVectors.s.sol --tc FxVectors
contract FxVectors is Script {
    uint8[8] internal DECS = [6, 6, 18, 18, 18, 6, 18, 2];

    function run() external {
        FxHarness h = new FxHarness();
        StabrixRouter router = new StabrixRouter(address(1), address(0), address(0xBEEF), address(2), address(3));
        StabrixLens lens = new StabrixLens(address(1));

        StabrixBackstopConfig.Config memory c;
        c.tokens = new address[](8);
        c.decimals = new uint8[](8);
        for (uint256 k; k < 8; ++k) {
            c.tokens[k] = address(uint160(0x1111111111111111111111111111111111111111) * uint160(k + 1));
            c.decimals[k] = DECS[k];
        }
        c.startDiscountBps = 200;
        c.endDiscountBps = 1000;
        c.capPerToken = 25_000e18;
        c.oracle = address(0x9999999999999999999999999999999999999999);
        ISwapVM.Order memory native = lens.buildBackstopOrder(address(router), address(0xA11CE), c, 7);
        ISwapVM.Order memory official = lens.buildBackstopExtructionOrder(address(3), address(0xA11CE), c, 7);

        string memory json = string.concat(
            "{\"backstopConfig\":\"",
            vm.toString(lens.encodeBackstopConfig(c)),
            "\",\"backstopNativeData\":\"",
            vm.toString(native.data),
            "\",\"backstopOfficialData\":\"",
            vm.toString(official.data),
            "\",\"backstopOpcode\":",
            vm.toString(router.backstopOpcode()),
            ",\"orbital\":[",
            _orbital(h),
            "],\"backstop\":[",
            _backstop(h),
            "]}"
        );
        vm.writeFile("../sdk/test/fx-vectors.json", json);
    }

    function _price(uint256 seed, uint256 k) internal pure returns (uint256) {
        uint256 r = uint256(keccak256(abi.encode(seed, k, "p")));
        if (k == 5) return 1.0e18 + r % 0.3e18;
        if (k == 6) return 0.15e18 + r % 0.1e18;
        if (k == 7) return 40e12 + r % 30e12;
        return 1e18;
    }

    function _join(uint256[] memory v) internal pure returns (string memory out) {
        for (uint256 k; k < v.length; ++k) {
            out = string.concat(out, k == 0 ? "" : ",", vm.toString(v[k]));
        }
    }

    struct OrbitalCase {
        uint256[] real;
        uint256[] rates;
        StabrixMath.Range r;
        uint256 i;
        uint256 j;
        uint256 amount;
        uint256 outAmount;
        string exactIn;
        string exactOut;
    }

    function _orbitalCase(FxHarness h, uint256 t) internal view returns (OrbitalCase memory c) {
        uint256 seed = uint256(keccak256(abi.encode("fx", t)));
        c.real = new uint256[](8);
        c.rates = new uint256[](8);
        for (uint256 k; k < 8; ++k) {
            uint256 p = _price(seed, k);
            uint256 usd = 60 + uint256(keccak256(abi.encode(seed, k))) % 80;
            c.real[k] = usd * 10 ** DECS[k] * 1e18 / p + uint256(keccak256(abi.encode(seed, k, 1))) % 10 ** DECS[k];
            c.rates[k] = 10 ** (36 - DECS[k]) * p / 1e18;
        }
        c.r = StabrixMath.Range({
            floor: (seed % 4) * 300e18,
            sumCapRatio: 5.4e18,
            feeBps: uint16(seed % 31),
            maxShareBps: t % 5 == 0 ? 3000 : 10_000
        });
        c.i = seed % 8;
        c.j = (c.i + 1 + (seed >> 8) % 7) % 8;
        c.amount = (seed >> 16) % (20 * 10 ** DECS[c.i] * 1e18 / _price(seed, c.i)) + 1000;
        c.outAmount = c.amount % (c.real[c.j] / 2) + 1;
        c.exactIn = "revert";
        c.exactOut = "revert";
        try h.exactIn(c.real, c.rates, c.r, c.i, c.j, c.amount) returns (uint256 v) {
            c.exactIn = vm.toString(v);
        } catch {}
        try h.exactOut(c.real, c.rates, c.r, c.i, c.j, c.outAmount) returns (uint256 v) {
            c.exactOut = vm.toString(v);
        } catch {}
    }

    function _orbitalJson(OrbitalCase memory c) internal pure returns (string memory) {
        return string.concat(
            string.concat("{\"real\":\"", _join(c.real), "\",\"rates\":\"", _join(c.rates), "\",\"floor\":\""),
            string.concat(vm.toString(c.r.floor), "\",\"fee\":", vm.toString(c.r.feeBps), ",\"maxShare\":"),
            string.concat(vm.toString(c.r.maxShareBps), ",\"i\":", vm.toString(c.i), ",\"j\":", vm.toString(c.j)),
            string.concat(",\"amount\":\"", vm.toString(c.amount), "\",\"outAmount\":\"", vm.toString(c.outAmount)),
            string.concat("\",\"exactIn\":\"", c.exactIn, "\",\"exactOut\":\"", c.exactOut, "\"}")
        );
    }

    function _orbital(FxHarness h) internal view returns (string memory out) {
        for (uint256 t; t < 40; ++t) {
            out = string.concat(out, t == 0 ? "" : ",", _orbitalJson(_orbitalCase(h, t)));
        }
    }

    function _backstop(FxHarness h) internal view returns (string memory out) {
        for (uint256 t; t < 40; ++t) {
            uint256 seed = uint256(keccak256(abi.encode("bs", t)));
            uint256 i = seed % 8;
            uint256 j = (i + 1 + (seed >> 8) % 7) % 8;
            uint256 face = _price(seed, i);
            StabrixBackstopPricing.Quote memory x = StabrixBackstopPricing.Quote({
                token: address(0x1234),
                amountIn: (seed >> 16) % (3000 * 10 ** DECS[i] * 1e18 / face) + 1,
                absorbedIn: (seed >> 80) % (5000 * 10 ** DECS[i] * 1e18 / face),
                faceIn: face,
                marketIn: face * (5000 + (seed >> 40) % 7000) / 10_000,
                priceOut: _price(seed, j),
                decimalsIn: DECS[i],
                decimalsOut: DECS[j],
                startBps: uint16(100 + (seed >> 120) % 300),
                endBps: uint16(500 + (seed >> 130) % 1500),
                cap: uint128(6000e18)
            });
            string memory res = "revert";
            try h.backstop(x) returns (uint256 v) {
                res = vm.toString(v);
            } catch {}
            out = string.concat(
                out,
                t == 0 ? "" : ",",
                string.concat(
                    "{\"amountIn\":\"", vm.toString(x.amountIn), "\",\"absorbedIn\":\"", vm.toString(x.absorbedIn)
                ),
                string.concat("\",\"faceIn\":\"", vm.toString(x.faceIn), "\",\"marketIn\":\"", vm.toString(x.marketIn)),
                string.concat(
                    "\",\"priceOut\":\"", vm.toString(x.priceOut), "\",\"decimalsIn\":", vm.toString(x.decimalsIn)
                ),
                string.concat(
                    ",\"decimalsOut\":", vm.toString(x.decimalsOut), ",\"startBps\":", vm.toString(x.startBps)
                ),
                string.concat(
                        ",\"endBps\":",
                        vm.toString(x.endBps),
                        ",\"cap\":\"",
                        vm.toString(x.cap),
                        "\",\"out\":\"",
                        res,
                        "\"}"
                    )
            );
        }
    }
}
