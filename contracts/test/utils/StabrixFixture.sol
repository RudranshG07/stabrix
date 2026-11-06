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
import {StabrixExtruction} from "../../src/StabrixExtruction.sol";
import {StabrixOracle} from "../../src/StabrixOracle.sol";
import {StabrixBackstop} from "../../src/StabrixBackstop.sol";
import {MockStablecoin} from "../../src/mocks/MockStablecoin.sol";

abstract contract StabrixFixture is Test {
    uint256 internal N;
    uint256 internal constant W = 1e18;

    Aqua internal aqua;
    StabrixRouter internal router;
    StabrixLens internal lens;
    StabrixBatchTaker internal batch;
    StabrixExtruction internal pricer;
    StabrixOracle internal oracle;
    StabrixBackstop internal backstop;

    address[] internal tokens;
    uint8[] internal decimals;

    address internal forwarder = makeAddr("forwarder");
    address internal lp = makeAddr("lp");
    address internal lp2 = makeAddr("lp2");
    address internal trader = makeAddr("trader");

    function setUp() public virtual {
        aqua = new Aqua();
        pricer = new StabrixExtruction(address(aqua));
        backstop = new StabrixBackstop(address(aqua));
        router = new StabrixRouter(address(aqua), address(0), address(this), address(pricer), address(backstop));
        lens = new StabrixLens(address(aqua));
        batch = new StabrixBatchTaker();
        oracle = new StabrixOracle(forwarder, address(this), 900, 50);

        (string[] memory symbols, uint8[] memory decs) = specs();
        N = symbols.length;
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

    function specs() internal pure virtual returns (string[] memory symbols, uint8[] memory decs) {
        symbols = new string[](5);
        decs = new uint8[](5);
        (symbols[0], symbols[1], symbols[2], symbols[3], symbols[4]) = ("USDC", "USDT", "DAI", "PYUSD", "USDS");
        (decs[0], decs[1], decs[2], decs[3], decs[4]) = (6, 6, 18, 6, 18);
    }

    function unit(uint256 k) internal view returns (uint256) {
        return 10 ** decimals[k];
    }

    function config(uint16 feeBps, uint16 maxShareBps, bool withOracle)
        internal
        view
        returns (StabrixConfig.Config memory c)
    {
        c.tokens = tokens;
        c.decimals = decimals;
        c.floor = uint128(900 * W);
        c.sumCapRatio = uint64(2.79e18);
        c.feeBps = feeBps;
        c.fxFeeBps = feeBps;
        c.maxShareBps = maxShareBps;
        c.oracle = withOracle ? address(oracle) : address(0);
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
