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
import {DepegSentinel} from "../../src/DepegSentinel.sol";
import {StabrixPricing} from "../../src/StabrixPricing.sol";

interface IOfficialRouter {
    function AQUA() external view returns (address);
    function hash(ISwapVM.Order calldata order) external view returns (bytes32);
    function swap(ISwapVM.Order calldata, address, address, uint256, bytes calldata)
        external
        returns (uint256, uint256, bytes32);
}

/// BASE_RPC_URL=https://mainnet.base.org forge test --match-path test/fork/BaseFork.t.sol
contract BaseForkTest is Test {
    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant OFFICIAL_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;
    address constant CRE_SIM_FORWARDER = 0x5E342a8438B4f5d39e72875FCee6f76B39CCE548;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    address[5] internal BASE_STABLES = [
        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
        0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2,
        0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb,
        0x820C137fa70C8691f0e44Dc420a5e53c168921Dc,
        0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34
    ];

    address[] internal tokens;
    uint8[] internal decimals;
    StabrixLens internal lens;
    StabrixExtruction internal ext;
    DepegSentinel internal sentinel;

    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");
    bool internal noFork;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            noFork = true;
            return;
        }
        vm.createSelectFork(rpc);

        address[] memory raw = new address[](5);
        for (uint256 k; k < 5; ++k) {
            raw[k] = BASE_STABLES[k];
        }
        for (uint256 a; a < 5; ++a) {
            for (uint256 b = a + 1; b < 5; ++b) {
                if (raw[b] < raw[a]) (raw[a], raw[b]) = (raw[b], raw[a]);
            }
        }
        for (uint256 k; k < 5; ++k) {
            tokens.push(raw[k]);
            decimals.push(IERC20Metadata(raw[k]).decimals());
        }

        lens = new StabrixLens(AQUA);
        ext = new StabrixExtruction(AQUA);
        sentinel = new DepegSentinel(CRE_SIM_FORWARDER, address(this));
    }

    function _config() internal view returns (StabrixConfig.Config memory c) {
        c.tokens = tokens;
        c.decimals = decimals;
        c.floor = uint128(900e18);
        c.sumCapRatio = uint64(2.79e18);
        c.feeBps = 4;
        c.maxShareBps = 10_000;
        c.sentinel = address(sentinel);
    }

    function _ship(address app, ISwapVM.Order memory order) internal returns (bytes32 h) {
        uint256[] memory amounts = new uint256[](5);
        for (uint256 k; k < 5; ++k) {
            amounts[k] = 100 * 10 ** decimals[k];
            deal(tokens[k], lp, IERC20Metadata(tokens[k]).balanceOf(lp) + amounts[k]);
            vm.prank(lp);
            IERC20Metadata(tokens[k]).approve(AQUA, type(uint256).max);
        }
        vm.prank(lp);
        h = IAqua(AQUA).ship(app, abi.encode(order), tokens, amounts);
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

    function _index(address token) internal view returns (uint256) {
        for (uint256 k; k < 5; ++k) {
            if (tokens[k] == token) return k;
        }
        revert();
    }

    function test_OfficialRouterUsesOfficialAqua() public view {
        if (noFork) return;
        assertEq(IOfficialRouter(OFFICIAL_ROUTER).AQUA(), AQUA);
    }

    function test_StabrixOnOfficialRouter_RealTokens() public {
        if (noFork) return;
        ISwapVM.Order memory order = lens.buildExtructionOrder(address(ext), lp, _config(), 1);
        _ship(OFFICIAL_ROUTER, order);

        uint256 usdc = _index(BASE_STABLES[0]);
        uint256 dai = _index(BASE_STABLES[2]);
        uint256 amountIn = 10 * 10 ** decimals[usdc];
        deal(tokens[usdc], trader, amountIn);
        vm.prank(trader);
        IERC20Metadata(tokens[usdc]).approve(OFFICIAL_ROUTER, amountIn);

        uint256 lpUsdcBefore = IERC20Metadata(tokens[usdc]).balanceOf(lp);
        vm.prank(trader);
        (, uint256 out,) =
            IOfficialRouter(OFFICIAL_ROUTER).swap(order, tokens[usdc], tokens[dai], amountIn, _takerData());

        assertGt(out, 9.8e18);
        assertLt(out, 10e18);
        assertEq(IERC20Metadata(tokens[dai]).balanceOf(trader), out);
        assertEq(IERC20Metadata(tokens[usdc]).balanceOf(lp) - lpUsdcBefore, amountIn);
    }

    function test_NativeRouterMatchesOfficialRouter() public {
        if (noFork) return;
        StabrixRouter native = new StabrixRouter(AQUA, WETH, address(this));
        ISwapVM.Order memory viaExt = lens.buildExtructionOrder(address(ext), lp, _config(), 7);
        ISwapVM.Order memory viaNative = lens.buildOrder(address(native), lp, _config(), 7);
        _ship(OFFICIAL_ROUTER, viaExt);
        _ship(address(native), viaNative);

        uint256 i = _index(BASE_STABLES[1]);
        uint256 j = _index(BASE_STABLES[4]);
        uint256 amountIn = 25 * 10 ** decimals[i];

        deal(tokens[i], trader, 2 * amountIn);
        vm.startPrank(trader);
        IERC20Metadata(tokens[i]).approve(OFFICIAL_ROUTER, amountIn);
        IERC20Metadata(tokens[i]).approve(address(native), amountIn);
        (, uint256 a,) = IOfficialRouter(OFFICIAL_ROUTER).swap(viaExt, tokens[i], tokens[j], amountIn, _takerData());
        (, uint256 b,) = native.swap(viaNative, tokens[i], tokens[j], amountIn, _takerData());
        vm.stopPrank();
        assertEq(a, b);
    }

    function test_SentinelReportViaCreSimForwarder() public {
        if (noFork) return;
        ISwapVM.Order memory order = lens.buildExtructionOrder(address(ext), lp, _config(), 3);
        _ship(OFFICIAL_ROUTER, order);
        uint256 usde = _index(BASE_STABLES[4]);

        address[] memory t = new address[](1);
        int256[] memory p = new int256[](1);
        bool[] memory h = new bool[](1);
        t[0] = tokens[usde];
        p[0] = 0.93e8;
        h[0] = true;
        vm.prank(CRE_SIM_FORWARDER);
        sentinel.onReport("", abi.encode(t, p, h, uint64(block.timestamp)));

        deal(tokens[usde], trader, 5e18);
        vm.prank(trader);
        IERC20Metadata(tokens[usde]).approve(OFFICIAL_ROUTER, 5e18);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StabrixPricing.Halted.selector, tokens[usde]));
        IOfficialRouter(OFFICIAL_ROUTER).swap(order, tokens[usde], tokens[0], 5e18, _takerData());
    }
}
