// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";
import { CompanySeries } from "../../src/CompanySeries.sol";
import { MockToken } from "../../src/mocks/MockToken.sol";

/**
 * The candidate components of Apple Position - Series 1, on a fork of
 * Ethereum (gate G3, blueprint C08): does the real wrapper answer as the
 * issuer documents, can an address that is nobody in particular hold and
 * move it, can a series contract take it in and pay it out, and does the
 * wrapper unwrap for such a holder?
 *
 * The addresses are the ones the issuer's public record names and the
 * daily verification read on chain (lib/positions/verify.ts), not the
 * example in anyone's documentation. Balances are set by storage (deal),
 * so no real holder is impersonated and nothing here depends on who owns
 * what. Component B stays a mock: Ondo's record is behind a key this desk
 * does not hold, and a guessed address would be exactly the mistake the
 * blueprint forbids.
 *
 * Every test prints the block it ran at, and the last one writes what it
 * found to evidence/apple-s1.fork.json for the site to show, dated. A
 * public node serves recent state only, so the block is not pinned; rerun
 * with an archive endpoint in ETH_RPC_URL to pin one.
 */
interface IERC20Like {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function totalSupply() external view returns (uint256);
}

interface IERC4626Like {
    function asset() external view returns (address);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
}

contract AppleComponentsForkTest is Test {
    /// AAPLx as the issuer's record lists it for Ethereum, read on chain: symbol AAPLx, 18 decimals.
    address constant RAW = 0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a;
    /// The current non-rebasing wrapper the issuer lists (wrapperAddressV2): symbol wAAPLx, asset() == RAW.
    address constant WRAPPER_V2 = 0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f;
    /// The older wrapper the issuer still lists (wrapperAddress): also points at RAW.
    address constant WRAPPER_V1 = 0x5AA7649fdbDa47De64A07aC81D64B682AF9C0724;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address operator = address(0x0E);

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("mainnet"));
        console2.log("fork block", block.number);
    }

    /* ── the questions, as helpers the tests and the record share ─────────── */

    function _identityAsDocumented() internal view returns (bool) {
        return IERC4626Like(WRAPPER_V2).asset() == RAW && IERC4626Like(WRAPPER_V1).asset() == RAW && IERC20Like(WRAPPER_V2).decimals() == 18
            && IERC20Like(RAW).decimals() == 18 && keccak256(bytes(IERC20Like(WRAPPER_V2).symbol())) == keccak256("wAAPLx")
            && keccak256(bytes(IERC20Like(RAW).symbol())) == keccak256("AAPLx");
    }

    function _wrapperTransfers() internal returns (bool) {
        deal(WRAPPER_V2, alice, 10e18);
        vm.prank(alice);
        (bool ok, bytes memory data) = WRAPPER_V2.call(abi.encodeCall(IERC20Like.transfer, (bob, 4e18)));
        return ok && (data.length == 0 || abi.decode(data, (bool))) && IERC20Like(WRAPPER_V2).balanceOf(bob) == 4e18;
    }

    /// Mint 3 lots into a fresh series with the real wrapper as A, exit, claim A. Returns whether the wrapper came back whole.
    function _seriesRoundTrip() internal returns (bool) {
        MockToken b = new MockToken("Component B (mock)", "B", 18);
        CompanySeries series = new CompanySeries(WRAPPER_V2, address(b), 10e18, 20e18, 1_000, operator, "Apple Position - Series 1 (fork)", "cAAPL-S1");
        vm.startPrank(operator);
        series.setMintPermit(alice, type(uint64).max);
        series.setClaimPermit(alice, true);
        vm.stopPrank();
        deal(WRAPPER_V2, alice, 30e18);
        b.mint(alice, 60e18);
        vm.startPrank(alice);
        IERC20Like(WRAPPER_V2).approve(address(series), type(uint256).max);
        b.approve(address(series), type(uint256).max);
        series.mint(3, block.timestamp + 1 hours);
        bool held = IERC20Like(WRAPPER_V2).balanceOf(address(series)) == 30e18 && series.liabilityA() == 30e18;
        series.allocateExit(3);
        series.claimComponent(0);
        vm.stopPrank();
        return held && IERC20Like(WRAPPER_V2).balanceOf(alice) == 30e18 && IERC20Like(WRAPPER_V2).balanceOf(address(series)) == 0 && series.claimB(alice) == 60e18;
    }

    /// Unwrap 10 wAAPLx for an arbitrary holder. Returns (succeeded, raw received, the wrapper's quote).
    function _unwrap() internal returns (bool, uint256, uint256) {
        deal(WRAPPER_V2, alice, 10e18);
        uint256 quoted = IERC4626Like(WRAPPER_V2).convertToAssets(10e18);
        uint256 before = IERC20Like(RAW).balanceOf(alice);
        vm.prank(alice);
        (bool ok, ) = WRAPPER_V2.call(abi.encodeCall(IERC4626Like.redeem, (10e18, alice, alice)));
        uint256 received = ok ? IERC20Like(RAW).balanceOf(alice) - before : 0;
        return (ok, received, quoted);
    }

    /// The raw token moved by an arbitrary holder who got it by unwrapping (call _unwrap first). Returns (succeeded, received by bob for 1e18 sent).
    function _rawTransfer() internal returns (bool, uint256) {
        require(IERC20Like(RAW).balanceOf(alice) >= 1e18, "unwrap first");
        vm.prank(alice);
        (bool ok, bytes memory data) = RAW.call(abi.encodeCall(IERC20Like.transfer, (bob, 1e18)));
        bool moved = ok && (data.length == 0 || abi.decode(data, (bool)));
        return (moved, IERC20Like(RAW).balanceOf(bob));
    }

    function tryDealRaw() external {
        deal(RAW, alice, 5e18);
    }

    /// Whether a raw AAPLx balance can be set by storage at all. It cannot: balanceOf is derived, not stored.
    function _rawBalanceIsStored() internal returns (bool) {
        (bool ok, ) = address(this).call(abi.encodeCall(this.tryDealRaw, ()));
        return ok;
    }

    /* ── the tests ───────────────────────────────────────────────────────── */

    function test_Fork_F01_WrapperAnswersAsTheIssuerDocuments() public view {
        assertTrue(_identityAsDocumented(), "asset(), symbols and decimals as the issuer's record says");
        assertGt(IERC20Like(WRAPPER_V2).totalSupply(), 0, "the wrapper has supply");
    }

    function test_Fork_F02_AnArbitraryHolderCanTransferTheWrapper() public {
        assertTrue(_wrapperTransfers(), "an address that is nobody in particular can move wAAPLx");
    }

    function test_Fork_F03_ASeriesCanTakeTheWrapperInAndPayItOut() public {
        assertTrue(_seriesRoundTrip(), "mint, exit and claim with the real wrapper");
    }

    function test_Fork_F04_UnwrapForAnArbitraryHolder() public {
        (bool ok, uint256 received, uint256 quoted) = _unwrap();
        console2.log("unwrap ok", ok);
        console2.log("raw received", received);
        console2.log("quoted", quoted);
        if (ok) assertEq(received, quoted, "the wrapper delivers what it quotes");
        else assertEq(received, 0, "nothing moved on a reverted unwrap (T21: transfers, does not unwrap)");
    }

    function test_Fork_F05_RawTokenTransferForAnArbitraryHolder() public {
        _unwrap();
        (bool moved, uint256 received) = _rawTransfer();
        console2.log("raw transfer moved", moved);
        console2.log("bob received", received);
        if (moved) assertApproxEqAbs(received, 1e18, 1e9, "the raw token delivers what was sent, to rounding");
        else assertEq(received, 0);
    }

    function test_Fork_F06_RawBalanceIsComputedNotStored() public {
        assertFalse(_rawBalanceIsStored(), "deal() cannot set a raw AAPLx balance by storage: balanceOf is derived");
    }

    /// The wrapper's own size: what it holds of the raw token, and how many shares exist. Small numbers here
    /// are a finding about adoption and unwrap capacity, and they are read before any balance is set by storage.
    function _wrapperSize() internal view returns (uint256 reserve, uint256 supply) {
        return (IERC20Like(RAW).balanceOf(WRAPPER_V2), IERC20Like(WRAPPER_V2).totalSupply());
    }

    function test_Fork_F07_WrapperSizeIsOnTheRecord() public view {
        (uint256 reserve, uint256 supply) = _wrapperSize();
        console2.log("wrapper raw reserve", reserve);
        console2.log("wrapper total supply", supply);
        assertGt(supply, 0);
    }

    /// The record: what was found, at which block, written for the site to show as dated evidence.
    function test_Fork_Z_RecordEvidence() public {
        (uint256 reserve, uint256 supply) = _wrapperSize();
        bool identity = _identityAsDocumented();
        bool transfers = _wrapperTransfers();
        bool roundTrip = _seriesRoundTrip();
        (bool unwrapOk, uint256 rawReceived, uint256 quoted) = _unwrap();
        (bool rawMoved, uint256 bobReceived) = unwrapOk ? _rawTransfer() : (false, 0);
        bool rawStored = _rawBalanceIsStored();

        string memory json = string.concat(
            "{\n",
            '  "seriesId": "apple-s1",\n',
            '  "chainId": 1,\n',
            '  "block": ', vm.toString(block.number), ",\n",
            '  "blockTimestamp": ', vm.toString(block.timestamp), ",\n",
            '  "component": "A",\n',
            '  "raw": "', vm.toString(RAW), '",\n',
            '  "wrapperV2": "', vm.toString(WRAPPER_V2), '",\n',
            '  "wrapperV1": "', vm.toString(WRAPPER_V1), '",\n',
            '  "wrapperRawReserve": "', vm.toString(reserve), '",\n',
            '  "wrapperTotalSupply": "', vm.toString(supply), '",\n'
        );
        json = string.concat(
            json,
            '  "findings": {\n',
            '    "identityAsDocumented": ', identity ? "true" : "false", ",\n",
            '    "wrapperTransfersForArbitraryHolder": ', transfers ? "true" : "false", ",\n",
            '    "seriesMintExitClaimWithRealWrapper": ', roundTrip ? "true" : "false", ",\n",
            '    "wrapperUnwrapsForArbitraryHolder": ', unwrapOk ? "true" : "false", ",\n",
            '    "unwrapRawReceivedFor10e18": "', vm.toString(rawReceived), '",\n',
            '    "unwrapQuotedFor10e18": "', vm.toString(quoted), '",\n'
        );
        json = string.concat(
            json,
            '    "rawTransfersForArbitraryHolder": ', rawMoved ? "true" : "false", ",\n",
            '    "rawReceivedFor1e18Sent": "', vm.toString(bobReceived), '",\n',
            '    "rawBalanceSettableByStorage": ', rawStored ? "true" : "false", "\n",
            "  },\n",
            '  "notProven": [\n',
            '    "a static balance under a corporate action (needs a fork at a recorded block across one)",\n',
            '    "holder eligibility for a series contract or its receipt holders",\n',
            '    "anything about the issuer\'s reserves, custody, or the value of a unit",\n',
            '    "component B: no address was tested; the issuer\'s record is behind an API key this desk does not hold"\n',
            "  ],\n",
            '  "how": "contracts/test/fork/AppleComponentsFork.t.sol on a fork of Ethereum; balances set by storage, no holder impersonated"\n',
            "}\n"
        );
        vm.writeFile("evidence/apple-s1.fork.json", json);
        assertTrue(identity && transfers && roundTrip, "the findings the site relies on held");
    }
}
