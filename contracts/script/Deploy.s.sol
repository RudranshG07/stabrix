// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {StabrixRouter} from "../src/StabrixRouter.sol";
import {StabrixLens} from "../src/StabrixLens.sol";
import {StabrixExtruction} from "../src/StabrixExtruction.sol";
import {StabrixBackstop} from "../src/StabrixBackstop.sol";
import {StabrixBatchTaker} from "../src/StabrixBatchTaker.sol";
import {StabrixOracle} from "../src/StabrixOracle.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {TestnetFeed} from "../src/mocks/TestnetFeed.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {AquaSwapVMRouter} from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";

contract Deploy is Script {
    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant OFFICIAL_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant BASE_CRE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;

    uint32 constant REPORT_MAX_AGE = 900;
    uint16 constant MAX_DEVIATION_BPS = 50;
    uint32 constant FEED_MAX_AGE = 4500;
    uint32 constant MARKET_FEED_MAX_AGE = 90_000;

    struct Coin {
        address token;
        address feed;
        address marketFeed;
    }

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        uint256 fromBlock = block.number + 1;
        bool official = AQUA.code.length > 0 && OFFICIAL_ROUTER.code.length > 0;
        address forwarder = vm.envOr("CRE_FORWARDER", BASE_CRE_FORWARDER);
        address workflowOwner = vm.envOr("CRE_WORKFLOW_OWNER", address(0));
        uint32 feedMaxAge = uint32(vm.envOr("FEED_MAX_AGE", uint256(FEED_MAX_AGE)));
        uint32 marketFeedMaxAge = uint32(vm.envOr("MARKET_FEED_MAX_AGE", uint256(MARKET_FEED_MAX_AGE)));

        Coin[] memory coins = block.chainid == 8453 ? _baseCoins() : new Coin[](0);

        vm.startBroadcast(key);
        address aqua = official ? AQUA : address(new Aqua());
        address officialRouter = official
            ? OFFICIAL_ROUTER
            : address(new AquaSwapVMRouter(aqua, WETH, deployer, "1inch SwapVM v1.0", "1.0.2"));
        StabrixExtruction extruction = new StabrixExtruction(aqua);
        StabrixBackstop backstop = new StabrixBackstop(aqua);
        StabrixRouter router = new StabrixRouter(aqua, WETH, deployer, address(extruction), address(backstop));
        StabrixLens lens = new StabrixLens(aqua);
        StabrixBatchTaker batch = new StabrixBatchTaker();
        StabrixOracle oracle = new StabrixOracle(forwarder, deployer, REPORT_MAX_AGE, MAX_DEVIATION_BPS);
        if (workflowOwner != address(0)) oracle.setWorkflowOwner(workflowOwner);
        if (coins.length == 0) coins = _mockCoins();
        for (uint256 k; k < coins.length; ++k) {
            if (coins[k].feed != address(0)) oracle.setFeed(coins[k].token, coins[k].feed, feedMaxAge);
            if (coins[k].marketFeed != address(0)) {
                oracle.setMarketFeed(coins[k].token, coins[k].marketFeed, marketFeedMaxAge);
            }
        }
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
            _field("backstop", address(backstop)),
            _field("batchTaker", address(batch)),
            _field("oracle", address(oracle)),
            _field("lens", address(lens)),
            _field("forwarder", forwarder),
            ",\"tokens\":",
            _tokensJson(coins),
            "}"
        );
        vm.writeFile(
            string.concat("../deployments/", vm.envOr("DEPLOYMENT_NAME", vm.toString(block.chainid)), ".json"), json
        );
    }

    function _field(string memory k, address v) internal pure returns (string memory) {
        return string.concat(",\"", k, "\":\"", vm.toString(v), "\"");
    }

    function _baseCoins() internal pure returns (Coin[] memory c) {
        c = new Coin[](8);
        c[0] = Coin(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, address(0), 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B);
        c[1] = Coin(0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2, address(0), 0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9);
        c[2] = Coin(0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb, address(0), 0x591e79239a7d679378eC8c847e5038150364C78F);
        c[3] = Coin(0x820C137fa70C8691f0e44Dc420a5e53c168921Dc, address(0), 0x2330aaE3bca5F05169d5f4597964D44522F62930);
        c[4] = Coin(0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34, address(0), 0x790181e93e9F4Eedb5b864860C12e4d2CffFe73B);
        c[5] = Coin(
            0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42,
            0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F,
            0x9867186e52d2F1C2c565CDA6E747101Fa56501e0
        );
        c[6] = Coin(0xE9185Ee218cae427aF7B9764A011bb89FeA761B4, 0x0b0E64c05083FdF9ED7C5D3d8262c4216eFc9394, address(0));
        c[7] = Coin(0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22, 0x05A6cF213EcC5501A11a08EBefA4A8a60313ef97, address(0));
    }

    function _mockCoins() internal returns (Coin[] memory c) {
        string[8] memory names =
            ["USD Coin", "Tether USD", "Dai Stablecoin", "USDS Stablecoin", "USDe", "EURC", "BRZ", "IDRX"];
        string[8] memory symbols = ["USDC", "USDT", "DAI", "USDS", "USDe", "EURC", "BRZ", "IDRX"];
        uint8[8] memory decs = [6, 6, 18, 18, 18, 6, 18, 2];
        int256[8] memory usdE8 = [int256(0), 0, 0, 0, 0, 1.1164e8, 0.1817e8, 5524];
        c = new Coin[](8);
        for (uint256 k; k < 8; ++k) {
            c[k].token = address(new MockStablecoin(names[k], symbols[k], decs[k]));
            if (usdE8[k] != 0) c[k].feed = address(new TestnetFeed(usdE8[k]));
        }
    }

    function _tokensJson(Coin[] memory c) internal view returns (string memory out) {
        out = "[";
        for (uint256 k; k < c.length; ++k) {
            IERC20Metadata m = IERC20Metadata(c[k].token);
            out = string.concat(
                out,
                k == 0 ? "" : ",",
                "{\"address\":\"",
                vm.toString(c[k].token),
                "\",\"symbol\":\"",
                m.symbol(),
                "\",\"name\":\"",
                m.name(),
                "\",\"decimals\":",
                vm.toString(m.decimals()),
                ",\"feed\":\"",
                vm.toString(c[k].feed),
                "\",\"marketFeed\":\"",
                vm.toString(c[k].marketFeed),
                "\"}"
            );
        }
        out = string.concat(out, "]");
    }
}
