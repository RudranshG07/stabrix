// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import {StabrixRouter} from "../../src/StabrixRouter.sol";
import {StabrixLens} from "../../src/StabrixLens.sol";
import {StabrixExtruction} from "../../src/StabrixExtruction.sol";
import {StabrixConfig} from "../../src/StabrixConfig.sol";
import {StabrixBackstopConfig} from "../../src/StabrixBackstopConfig.sol";
import {StabrixOracle} from "../../src/StabrixOracle.sol";
import {StabrixBackstop} from "../../src/StabrixBackstop.sol";

interface IOfficialRouter {
    function AQUA() external view returns (address);
    function swap(ISwapVM.Order calldata, address, address, uint256, bytes calldata)
        external
        returns (uint256, uint256, bytes32);
}

interface IForwarder {
    function report(
        address receiver,
        bytes calldata rawReport,
        bytes calldata reportContext,
        bytes[] calldata signatures
    ) external;
}

address constant CRE_SIMULATION_OWNER = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;

/// BASE_RPC_URL=https://mainnet.base.org forge test --match-path test/fork/BaseFork.t.sol
contract BaseForkTest is Test {
    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant OFFICIAL_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;
    address constant CRE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;
    address constant CRE_SIM_FORWARDER = 0x5E342a8438B4f5d39e72875FCee6f76B39CCE548;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    uint32 constant FEED_MAX_AGE = 4500;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDE = 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34;
    address constant EURC = 0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42;
    address constant BRZ = 0xE9185Ee218cae427aF7B9764A011bb89FeA761B4;
    address constant IDRX = 0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22;

    address[8] internal COINS = [
        USDC,
        0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2,
        0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb,
        0x820C137fa70C8691f0e44Dc420a5e53c168921Dc,
        USDE,
        EURC,
        BRZ,
        IDRX
    ];

    address[] internal tokens;
    uint8[] internal decimals;
    StabrixLens internal lens;
    StabrixExtruction internal ext;
    StabrixOracle internal oracle;
    StabrixBackstop internal bs;

    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");
    bool internal noFork;

    modifier forked() {
        vm.skip(noFork);
        _;
    }

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            noFork = true;
            return;
        }
        vm.createSelectFork(rpc);

        address[] memory raw = new address[](8);
        for (uint256 k; k < 8; ++k) {
            raw[k] = COINS[k];
        }
        for (uint256 a; a < 8; ++a) {
            for (uint256 b = a + 1; b < 8; ++b) {
                if (raw[b] < raw[a]) (raw[a], raw[b]) = (raw[b], raw[a]);
            }
        }
        for (uint256 k; k < 8; ++k) {
            tokens.push(raw[k]);
            decimals.push(IERC20Metadata(raw[k]).decimals());
        }

        lens = new StabrixLens(AQUA);
        ext = new StabrixExtruction(AQUA);
        bs = new StabrixBackstop(AQUA);
        oracle = _oracle(CRE_FORWARDER);
    }

    function _oracle(address forwarder) internal returns (StabrixOracle o) {
        o = new StabrixOracle(forwarder, address(this), 900, 50);
        if (forwarder == CRE_SIM_FORWARDER) o.setWorkflowOwner(CRE_SIMULATION_OWNER);
        o.setFeed(EURC, 0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F, FEED_MAX_AGE);
        o.setFeed(BRZ, 0x0b0E64c05083FdF9ED7C5D3d8262c4216eFc9394, FEED_MAX_AGE);
        o.setFeed(IDRX, 0x05A6cF213EcC5501A11a08EBefA4A8a60313ef97, FEED_MAX_AGE);
    }

    function _config(StabrixOracle o) internal view returns (StabrixConfig.Config memory c) {
        c.tokens = tokens;
        c.decimals = decimals;
        c.floor = uint128(90_000e18);
        c.sumCapRatio = type(uint64).max;
        c.feeBps = 1;
        c.fxFeeBps = 10;
        c.maxShareBps = 10_000;
        c.oracle = address(o);
    }

    function _ship(address app, ISwapVM.Order memory order, StabrixOracle o) internal {
        uint256[] memory amounts = new uint256[](8);
        for (uint256 k; k < 8; ++k) {
            (uint256 price,,) = o.priceOf(tokens[k]);
            amounts[k] = 10_000 * 10 ** decimals[k] * 1e18 / price;
            deal(tokens[k], lp, IERC20Metadata(tokens[k]).balanceOf(lp) + amounts[k]);
            vm.prank(lp);
            IERC20Metadata(tokens[k]).approve(AQUA, type(uint256).max);
        }
        vm.prank(lp);
        IAqua(AQUA).ship(app, abi.encode(order), tokens, amounts);
    }

    function _swap(address router, ISwapVM.Order memory order, address tIn, address tOut, uint256 amountIn)
        internal
        returns (uint256 out)
    {
        deal(tIn, trader, amountIn);
        vm.startPrank(trader);
        IERC20Metadata(tIn).approve(router, amountIn);
        (, out,) = IOfficialRouter(router).swap(order, tIn, tOut, amountIn, _takerData());
        vm.stopPrank();
    }

    function _usd(address token, uint256 amount) internal view returns (uint256) {
        (uint256 price,,) = oracle.priceOf(token);
        return amount * price / 10 ** IERC20Metadata(token).decimals();
    }

    function test_OfficialRouterUsesOfficialAqua() public forked {
        assertEq(IOfficialRouter(OFFICIAL_ROUTER).AQUA(), AQUA);
    }

    function test_FeedsAreLiveAndPriced() public forked {
        (uint256 eur, bool fx,) = oracle.priceOf(EURC);
        assertTrue(fx);
        assertGt(eur, 0.9e18);
        assertLt(eur, 1.4e18);
        (uint256 brl,,) = oracle.priceOf(BRZ);
        assertGt(brl, 0.1e18);
        assertLt(brl, 0.3e18);
        (uint256 idr,,) = oracle.priceOf(IDRX);
        assertGt(idr, 0.00003e18);
        assertLt(idr, 0.0001e18);
        (uint256 usd, bool usdFx,) = oracle.priceOf(USDC);
        assertEq(usd, 1e18);
        assertFalse(usdFx);
    }

    function test_EightCoinRangeFitsOfficialRouter() public forked {
        ISwapVM.Order memory order = lens.buildExtructionOrder(address(ext), lp, _config(oracle), 1);
        assertEq(uint8(order.data[1]), 20 + 1 + 21 * 8 + 50);
    }

    function test_EveryPairOnOfficialRouter_RealTokens() public forked {
        ISwapVM.Order memory order = lens.buildExtructionOrder(address(ext), lp, _config(oracle), 1);
        _ship(OFFICIAL_ROUTER, order, oracle);

        for (uint256 i; i < 8; ++i) {
            for (uint256 j; j < 8; ++j) {
                if (i == j) continue;
                uint256 snap = vm.snapshotState();
                (uint256 price,,) = oracle.priceOf(tokens[i]);
                uint256 amountIn = 50 * 10 ** decimals[i] * 1e18 / price;
                uint256 out = _swap(OFFICIAL_ROUTER, order, tokens[i], tokens[j], amountIn);
                uint256 valueIn = _usd(tokens[i], amountIn);
                uint256 valueOut = _usd(tokens[j], out);
                assertLe(valueOut, valueIn, "never pays more than it takes");
                assertGt(valueOut, valueIn * 9980 / 10_000, "fee and slippage under 0.2%");
                vm.revertToState(snap);
            }
        }
    }

    function test_NativeRouterMatchesOfficialRouter_FxPair() public forked {
        StabrixRouter native = new StabrixRouter(AQUA, WETH, address(this), address(ext), address(bs));
        ISwapVM.Order memory viaExt = lens.buildExtructionOrder(address(ext), lp, _config(oracle), 7);
        ISwapVM.Order memory viaNative = lens.buildOrder(address(native), lp, _config(oracle), 7);
        _ship(OFFICIAL_ROUTER, viaExt, oracle);
        _ship(address(native), viaNative, oracle);

        uint256 a = _swap(OFFICIAL_ROUTER, viaExt, BRZ, IDRX, 200e18);
        uint256 b = _swap(address(native), viaNative, BRZ, IDRX, 200e18);
        assertEq(a, b);
        assertGt(a, 0);
    }

    function test_StaleFeedRefusesFxRange() public forked {
        ISwapVM.Order memory order = lens.buildExtructionOrder(address(ext), lp, _config(oracle), 2);
        _ship(OFFICIAL_ROUTER, order, oracle);
        vm.warp(block.timestamp + FEED_MAX_AGE + 3600);
        deal(USDC, trader, 10e6);
        vm.startPrank(trader);
        IERC20Metadata(USDC).approve(OFFICIAL_ROUTER, 10e6);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.StaleRate.selector, IDRX));
        IOfficialRouter(OFFICIAL_ROUTER).swap(order, USDC, EURC, 10e6, _takerData());
        vm.stopPrank();
    }

    function test_ProductionForwarderRejectsUnsignedReport() public forked {
        bytes memory raw = _rawReport(USDE, true);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        IForwarder(CRE_FORWARDER).report(address(oracle), raw, "", new bytes[](0));
        assertFalse(oracle.isHalted(USDE));
    }

    function test_SimForwarderReportsAsSimulationOwner() public forked {
        StabrixOracle demo = _oracle(CRE_SIM_FORWARDER);
        ISwapVM.Order memory order = lens.buildExtructionOrder(address(ext), lp, _config(demo), 3);
        _ship(OFFICIAL_ROUTER, order, demo);

        bytes memory raw = _rawReport(USDE, true);
        vm.prank(makeAddr("stranger"));
        IForwarder(CRE_SIM_FORWARDER).report(address(demo), raw, "", new bytes[](0));
        assertTrue(demo.isHalted(USDE));

        deal(USDE, trader, 5e18);
        vm.startPrank(trader);
        IERC20Metadata(USDE).approve(OFFICIAL_ROUTER, 5e18);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.Halted.selector, USDE));
        IOfficialRouter(OFFICIAL_ROUTER).swap(order, USDE, USDC, 5e18, _takerData());
        vm.stopPrank();
    }

    function test_BackstopBuysRealUSDeAfterCreDepegReport() public forked {
        StabrixOracle demo = _oracle(CRE_SIM_FORWARDER);
        demo.setMarketFeed(USDE, 0x790181e93e9F4Eedb5b864860C12e4d2CffFe73B, 90_000);

        StabrixBackstopConfig.Config memory c;
        c.tokens = tokens;
        c.decimals = decimals;
        c.startDiscountBps = 200;
        c.endDiscountBps = 1000;
        c.capPerToken = uint128(20_000e18);
        c.oracle = address(demo);
        ISwapVM.Order memory order = lens.buildBackstopExtructionOrder(address(bs), lp, c, 9);
        uint256[] memory amounts = new uint256[](8);
        uint256 usdc = 0;
        for (uint256 k; k < 8; ++k) {
            if (tokens[k] == USDC) usdc = k;
        }
        amounts[usdc] = 10_000e6;
        deal(USDC, lp, 10_000e6);
        vm.prank(lp);
        IERC20Metadata(USDC).approve(AQUA, type(uint256).max);
        vm.prank(lp);
        IAqua(AQUA).ship(OFFICIAL_ROUTER, abi.encode(order), tokens, amounts);

        deal(USDE, trader, 1000e18);
        vm.startPrank(trader);
        IERC20Metadata(USDE).approve(OFFICIAL_ROUTER, 1000e18);
        vm.expectRevert(abi.encodeWithSelector(StabrixOracle.NotDepegged.selector, USDE));
        IOfficialRouter(OFFICIAL_ROUTER).swap(order, USDE, USDC, 1000e18, _takerData());
        vm.stopPrank();

        bytes memory raw = _rawReport(USDE, true);
        vm.prank(makeAddr("cre"));
        IForwarder(CRE_SIM_FORWARDER).report(address(demo), raw, "", new bytes[](0));

        uint256 out = _swap(OFFICIAL_ROUTER, order, USDE, USDC, 1000e18);
        assertLe(out, 930e6 * 98 / 100, "at least the start discount below the CRE price");
        assertGt(out, 930e6 * 97 / 100);
        assertEq(IERC20Metadata(USDE).balanceOf(lp), 1000e18, "USDe lands in the maker wallet");
        assertEq(IERC20Metadata(USDC).balanceOf(lp), 10_000e6 - out);
    }

    function _rawReport(address token, bool halted) internal view returns (bytes memory) {
        address[] memory t = new address[](1);
        uint256[] memory p = new uint256[](1);
        bool[] memory h = new bool[](1);
        t[0] = token;
        p[0] = 0.93e18;
        h[0] = halted;
        bytes memory metadata = abi.encodePacked(
            uint8(1),
            bytes32(uint256(1)),
            uint32(block.timestamp),
            uint32(1),
            uint32(1),
            bytes32(0),
            bytes10(0),
            CRE_SIMULATION_OWNER,
            bytes2(0x0001)
        );
        return bytes.concat(metadata, abi.encode(t, p, h, uint64(block.timestamp)));
    }

    function _takerData() internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(0),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: trader,
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }
}
