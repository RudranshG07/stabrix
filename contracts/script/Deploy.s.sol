// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {StabrixRouter} from "../src/StabrixRouter.sol";
import {StabrixLens} from "../src/StabrixLens.sol";
import {StabrixExtruction} from "../src/StabrixExtruction.sol";
import {StabrixBatchTaker} from "../src/StabrixBatchTaker.sol";
import {DepegSentinel} from "../src/DepegSentinel.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {AquaSwapVMRouter} from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

contract Deploy is Script {
    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant OFFICIAL_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant BASE_CRE_SIM_FORWARDER = 0x5E342a8438B4f5d39e72875FCee6f76B39CCE548;
    address constant BASE_SEPOLIA_CRE_SIM_FORWARDER = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        uint256 fromBlock = block.number + 1;
        bool official = AQUA.code.length > 0 && OFFICIAL_ROUTER.code.length > 0;

        address[] memory tokens = block.chainid == 8453 ? _baseStables() : new address[](0);

        vm.startBroadcast(key);
        address aqua = official ? AQUA : address(new Aqua());
        address officialRouter = official
            ? OFFICIAL_ROUTER
            : address(new AquaSwapVMRouter(aqua, WETH, deployer, "1inch SwapVM v1.0", "1.0.2"));
        StabrixRouter router = new StabrixRouter(aqua, WETH, deployer);
        StabrixLens lens = new StabrixLens(aqua);
        StabrixExtruction extruction = new StabrixExtruction(aqua);
        StabrixBatchTaker batch = new StabrixBatchTaker();
        address forwarder =
            vm.envOr("CRE_FORWARDER", block.chainid == 84532 ? BASE_SEPOLIA_CRE_SIM_FORWARDER : BASE_CRE_SIM_FORWARDER);
        DepegSentinel sentinel = new DepegSentinel(forwarder, deployer);
        if (tokens.length == 0) tokens = _mockStables();
        vm.stopBroadcast();

        string memory json = string.concat(
            "{\"chainId\":",
            vm.toString(block.chainid),
            ",\"fromBlock\":",
            vm.toString(fromBlock),
            ",\"officialAqua\":",
            official ? "true" : "false",
            _field("aqua", aqua),
            _field("router", address(router)),
            _field("officialRouter", officialRouter),
            _field("extruction", address(extruction)),
            _field("batchTaker", address(batch)),
            _field("sentinel", address(sentinel)),
            _field("lens", address(lens)),
            _field("forwarder", forwarder),
            ",\"tokens\":",
            _tokensJson(tokens),
            "}"
        );
        vm.writeFile(
            string.concat("../deployments/", vm.envOr("DEPLOYMENT_NAME", vm.toString(block.chainid)), ".json"), json
        );
    }

    function _field(string memory k, address v) internal pure returns (string memory) {
        return string.concat(",\"", k, "\":\"", vm.toString(v), "\"");
    }

    function _baseStables() internal pure returns (address[] memory t) {
        t = new address[](5);
        t[0] = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        t[1] = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2;
        t[2] = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb;
        t[3] = 0x820C137fa70C8691f0e44Dc420a5e53c168921Dc;
        t[4] = 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34;
    }

    function _mockStables() internal returns (address[] memory t) {
        string[5] memory names = ["USD Coin", "Tether USD", "Dai Stablecoin", "USDS Stablecoin", "USDe"];
        string[5] memory symbols = ["USDC", "USDT", "DAI", "USDS", "USDe"];
        uint8[5] memory decs = [6, 6, 18, 18, 18];
        t = new address[](5);
        for (uint256 k; k < 5; ++k) {
            t[k] = address(new MockStablecoin(names[k], symbols[k], decs[k]));
        }
    }

    function _tokensJson(address[] memory t) internal view returns (string memory out) {
        out = "[";
        for (uint256 k; k < t.length; ++k) {
            IERC20Metadata m = IERC20Metadata(t[k]);
            out = string.concat(
                out,
                k == 0 ? "" : ",",
                "{\"address\":\"",
                vm.toString(t[k]),
                "\",\"symbol\":\"",
                m.symbol(),
                "\",\"name\":\"",
                m.name(),
                "\",\"decimals\":",
                vm.toString(m.decimals()),
                "}"
            );
        }
        out = string.concat(out, "]");
    }
}
