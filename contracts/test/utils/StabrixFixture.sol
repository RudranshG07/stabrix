// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import {StabrixRouter} from "../../src/StabrixRouter.sol";
import {StabrixLens} from "../../src/StabrixLens.sol";
import {StabrixConfig} from "../../src/StabrixConfig.sol";
import {StabrixBatchTaker} from "../../src/StabrixBatchTaker.sol";
import {DepegSentinel} from "../../src/DepegSentinel.sol";
import {MockStablecoin} from "../../src/mocks/MockStablecoin.sol";

abstract contract StabrixFixture is Test {
    uint256 internal constant N = 5;
    uint256 internal constant W = 1e18;

    Aqua internal aqua;
    StabrixRouter internal router;
    StabrixLens internal lens;
    StabrixBatchTaker internal batch;
    DepegSentinel internal sentinel;

    address[] internal tokens;
    uint8[] internal decimals;

    address internal forwarder = makeAddr("forwarder");
    address internal lp = makeAddr("lp");
    address internal lp2 = makeAddr("lp2");
    address internal trader = makeAddr("trader");

    function setUp() public virtual {
        aqua = new Aqua();
        router = new StabrixRouter(address(aqua), address(0), address(this));
        lens = new StabrixLens(address(aqua));
        batch = new StabrixBatchTaker();
        sentinel = new DepegSentinel(forwarder, address(this));

        string[5] memory symbols = ["USDC", "USDT", "DAI", "PYUSD", "USDS"];
        uint8[5] memory decs = [6, 6, 18, 6, 18];
        address[] memory raw = new address[](N);
        for (uint256 k; k < N; ++k) {
            raw[k] = address(new MockStablecoin(symbols[k], symbols[k], decs[k]));
        }
        for (uint256 a; a < N; ++a) {
            for (uint256 b = a + 1; b < N; ++b) {
                if (raw[b] < raw[a]) (raw[a], raw[b]) = (raw[b], raw[a]);
            }
        }
        for (uint256 k; k < N; ++k) {
            tokens.push(raw[k]);
            decimals.push(MockStablecoin(raw[k]).decimals());
            vm.label(raw[k], MockStablecoin(raw[k]).symbol());
        }
    }

    function unit(uint256 k) internal view returns (uint256) {
        return 10 ** decimals[k];
    }

    function config(uint16 feeBps, uint16 maxShareBps, bool withSentinel)
        internal
        view
        returns (StabrixConfig.Config memory c)
    {
        c.tokens = tokens;
        c.decimals = decimals;
        c.floor = uint128(900 * W);
        c.sumCapRatio = uint64(2.79e18);
        c.feeBps = feeBps;
        c.maxShareBps = maxShareBps;
        c.sentinel = withSentinel ? address(sentinel) : address(0);
    }

    function ship(address maker, StabrixConfig.Config memory c, uint256 perToken, uint64 salt)
        internal
        returns (ISwapVM.Order memory order, bytes32 strategyHash)
    {
        order = lens.buildOrder(address(router), maker, c, salt);
        uint256[] memory amounts = new uint256[](N);
        for (uint256 k; k < N; ++k) {
            amounts[k] = perToken * unit(k);
            MockStablecoin(tokens[k]).mint(maker, amounts[k]);
            vm.prank(maker);
            MockStablecoin(tokens[k]).approve(address(aqua), type(uint256).max);
        }
        vm.prank(maker);
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        assertEq(strategyHash, router.hash(order));
    }

    function takerData(bool exactIn, address to) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(0),
                isExactIn: exactIn,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: to,
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

    function fund(address who, uint256 k, uint256 amount, address spender) internal {
        MockStablecoin(tokens[k]).mint(who, amount);
        vm.prank(who);
        MockStablecoin(tokens[k]).approve(spender, type(uint256).max);
    }

    function swapIn(ISwapVM.Order memory order, uint256 i, uint256 j, uint256 amountIn) internal returns (uint256 out) {
        fund(trader, i, amountIn, address(router));
        vm.prank(trader);
        (, out,) = router.swap(order, tokens[i], tokens[j], amountIn, takerData(true, trader));
    }

    function quoteIn(ISwapVM.Order memory order, uint256 i, uint256 j, uint256 amountIn)
        internal
        returns (uint256 out)
    {
        vm.prank(trader);
        (, out,) = router.quote(order, tokens[i], tokens[j], amountIn, takerData(true, trader));
    }

    function aquaBalance(address maker, bytes32 h, uint256 k) internal view returns (uint256 b) {
        (uint248 x,) = aqua.rawBalances(maker, address(router), h, tokens[k]);
        b = x;
    }
}
