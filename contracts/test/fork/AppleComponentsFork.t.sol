// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { console2 } from "forge-std/console2.sol";
import { CompanySeries } from "../../src/CompanySeries.sol";
import { MockToken } from "../../src/mocks/MockToken.sol";
import { TransferObservation } from "../helpers/TransferObservation.sol";

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
 * what. Component B is the address the issuer's own product page publishes
 * for AAPLon on Ethereum (archived and verified daily by the desk) — not the
 * example in the API specification, which is never used; the B tests ask
 * the same questions of it and run one series with both components real.
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

contract AppleComponentsForkTest is TransferObservation {
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
        (bool accepted, uint256 received) = _observeTransfer(WRAPPER_V2, alice, bob, 4e18);
        return accepted && received == 4e18;
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

    /// Execution gas of each operation with both real components, by gasleft()
    /// deltas: a plain wrapper transfer (what holding it directly costs to
    /// move), a mint of 3 lots, an exit allocation, a claim of A (the real
    /// wrapper moving out) and a claim of B (real AAPLon moving out). Add the
    /// 21,000 base and the calldata for a transaction; these are inputs to a
    /// cost comparison, not a price.
    function _gasRoundTrip() internal returns (uint256 transferGas, uint256 transferBGas, uint256 mintGas, uint256 exitGas, uint256 claimAGas, uint256 claimBGas) {
        CompanySeries series = new CompanySeries(WRAPPER_V2, AAPLON, 10e18, 20e18, 1_000, operator, "Apple Position - Series 1 (fork)", "cAAPL-S1");
        vm.startPrank(operator);
        series.setMintPermit(alice, type(uint64).max);
        series.setClaimPermit(alice, true);
        vm.stopPrank();
        deal(WRAPPER_V2, alice, 40e18);
        deal(AAPLON, alice, 70e18);
        vm.startPrank(alice);
        IERC20Like(WRAPPER_V2).approve(address(series), type(uint256).max);
        IERC20Like(AAPLON).approve(address(series), type(uint256).max);
        uint256 bobBeforeA = IERC20Like(WRAPPER_V2).balanceOf(bob);
        uint256 bobBeforeB = IERC20Like(AAPLON).balanceOf(bob);
        uint256 g = gasleft();
        bool transferredA = IERC20Like(WRAPPER_V2).transfer(bob, 10e18);
        transferGas = g - gasleft();
        g = gasleft();
        bool transferredB = IERC20Like(AAPLON).transfer(bob, 10e18);
        transferBGas = g - gasleft();
        assertTrue(transferredA && transferredB, "gas observations require successful transfers");
        assertEq(IERC20Like(WRAPPER_V2).balanceOf(bob) - bobBeforeA, 10e18, "gas probe A delivered exactly");
        assertEq(IERC20Like(AAPLON).balanceOf(bob) - bobBeforeB, 10e18, "gas probe B delivered exactly");
        g = gasleft();
        series.mint(3, block.timestamp + 1 hours);
        mintGas = g - gasleft();
        g = gasleft();
        series.allocateExit(3);
        exitGas = g - gasleft();
        g = gasleft();
        series.claimComponent(0);
        claimAGas = g - gasleft();
        g = gasleft();
        series.claimComponent(1);
        claimBGas = g - gasleft();
        vm.stopPrank();
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
        return _observeTransfer(RAW, alice, bob, 1e18);
    }

    function tryDealRaw() external {
        deal(RAW, alice, 5e18);
    }

    /// Whether this fixture can stage a raw AAPLx balance with deal() at the fork block.
    /// Failure is a fixture observation, not proof of a particular storage implementation.
    function _rawBalanceIsStored() internal returns (bool) {
        (bool ok, ) = address(this).call(abi.encodeCall(this.tryDealRaw, ()));
        return ok;
    }

    /* ── component B: AAPLon, as the issuer's product page publishes it ──── */

    /// AAPLon on Ethereum as app.ondo.finance/assets/aaplon publishes it (chain id 1, 18 decimals),
    /// read on chain by the daily verification. Not an example from any specification.
    address constant AAPLON = 0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c;

    function tryDealB() external {
        deal(AAPLON, alice, 40e18);
    }

    /// Whether an AAPLon balance can be set by storage (deal). If it cannot, no holder can be
    /// staged and the transfer questions stay open on the record rather than answered wrongly.
    function _bBalanceIsStored() internal returns (bool) {
        (bool ok, ) = address(this).call(abi.encodeCall(this.tryDealB, ()));
        return ok;
    }

    function _bIdentity() internal view returns (bool) {
        return keccak256(bytes(IERC20Like(AAPLON).symbol())) == keccak256("AAPLon") && IERC20Like(AAPLON).decimals() == 18;
    }

    /// An address that is nobody in particular moves AAPLon. Returns (staged, moved): staged false
    /// means the balance could not be set, so nothing was tried.
    function _bTransfers() internal returns (bool staged, bool moved) {
        staged = _bBalanceIsStored();
        if (!staged) return (false, false);
        (bool accepted, uint256 received) = _observeTransfer(AAPLON, alice, bob, 4e18);
        moved = accepted && received == 4e18;
    }

    /// Both components real: the wrapper as A, AAPLon as B, one lot of 10 wAAPLx and 20 AAPLon;
    /// mint, exit, claim A, claim B. Returns (staged, roundTrip).
    function _bothRealRoundTrip() internal returns (bool staged, bool roundTrip) {
        staged = _bBalanceIsStored();
        if (!staged) return (false, false);
        CompanySeries series = new CompanySeries(WRAPPER_V2, AAPLON, 10e18, 20e18, 1_000, operator, "Apple Position - Series 1 (fork, both real)", "cAAPL-S1");
        vm.startPrank(operator);
        series.setMintPermit(alice, type(uint64).max);
        series.setClaimPermit(alice, true);
        vm.stopPrank();
        deal(WRAPPER_V2, alice, 10e18);
        vm.startPrank(alice);
        IERC20Like(WRAPPER_V2).approve(address(series), type(uint256).max);
        (bool approved, ) = AAPLON.call(abi.encodeCall(IERC20Like.approve, (address(series), type(uint256).max)));
        if (!approved) {
            vm.stopPrank();
            return (true, false);
        }
        (bool minted, ) = address(series).call(abi.encodeCall(series.mint, (1, block.timestamp + 1 hours)));
        if (!minted) {
            vm.stopPrank();
            return (true, false);
        }
        bool held = IERC20Like(WRAPPER_V2).balanceOf(address(series)) == 10e18 && IERC20Like(AAPLON).balanceOf(address(series)) == 20e18;
        series.allocateExit(1);
        series.claimComponent(0);
        series.claimComponent(1);
        vm.stopPrank();
        roundTrip = held && IERC20Like(WRAPPER_V2).balanceOf(alice) == 10e18 && IERC20Like(AAPLON).balanceOf(alice) == 40e18
            && IERC20Like(WRAPPER_V2).balanceOf(address(series)) == 0 && IERC20Like(AAPLON).balanceOf(address(series)) == 0;
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

    function test_Fork_Observation_F04_UnwrapForAStagedHolder() public {
        (bool ok, uint256 received, uint256 quoted) = _unwrap();
        console2.log("unwrap ok", ok);
        console2.log("raw received", received);
        console2.log("quoted", quoted);
        if (ok) assertEq(received, quoted, "the wrapper delivers what it quotes");
        else assertEq(received, 0, "nothing moved on a reverted unwrap (T21: transfers, does not unwrap)");
    }

    function test_Fork_Observation_F05_RawTransferAfterUnwrap() public {
        (bool unwrapped, , ) = _unwrap();
        if (!unwrapped) {
            console2.log("raw transfer not attempted: unwrap did not succeed");
            return;
        }
        (bool moved, uint256 received) = _rawTransfer();
        console2.log("raw transfer moved", moved);
        console2.log("bob received", received);
        if (moved) assertApproxEqAbs(received, 1e18, 1e9, "the raw token delivers what was sent, to rounding");
        else assertEq(received, 0);
    }

    function test_Fork_Observation_F06_RawBalanceStorageStaging() public {
        console2.log("raw balance stageable by this fixture", _rawBalanceIsStored());
    }

    /// The wrapper's own size: what it holds of the raw token, and how many shares exist. Small numbers here
    /// are a dated inventory observation, not a hard ceiling on new wrapper issuance.
    /// Eligible raw acquisition, deposit/mint, and issuer limits are not tested here.
    function _wrapperSize() internal view returns (uint256 reserve, uint256 supply) {
        return (IERC20Like(RAW).balanceOf(WRAPPER_V2), IERC20Like(WRAPPER_V2).totalSupply());
    }

    function test_Fork_Observation_F07_WrapperSizeIsOnTheRecord() public view {
        (uint256 reserve, uint256 supply) = _wrapperSize();
        console2.log("wrapper raw reserve", reserve);
        console2.log("wrapper total supply", supply);
        assertGt(supply, 0);
    }

    /// The record: what was found, at which block, written for the site to show as dated evidence.
    /// keccak256("eip1967.proxy.implementation") - 1 and the admin slot beside it.
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    /// keccak256("eip1967.proxy.beacon") - 1: a beacon proxy keeps its implementation behind this address.
    bytes32 constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    /// Who can change what stands behind an address: the EIP-1967 slots read
    /// from storage, and owner() / paused() if the contract answers them. A
    /// function that reverts or is absent is recorded as null, not as false.
    function _probeAddress(address target, bytes4 selector) internal view returns (bool ok, address value) {
        (bool s, bytes memory ret) = target.staticcall(abi.encodeWithSelector(selector));
        if (!s || ret.length < 32) return (false, address(0));
        return (true, abi.decode(ret, (address)));
    }

    function _probeBool(address target, bytes4 selector) internal view returns (bool ok, bool value) {
        (bool s, bytes memory ret) = target.staticcall(abi.encodeWithSelector(selector));
        if (!s || ret.length < 32) return (false, false);
        return (true, abi.decode(ret, (bool)));
    }

    function _addressOrNull(bool ok, address value) internal pure returns (string memory) {
        return ok && value != address(0) ? string.concat('"', vm.toString(value), '"') : "null";
    }

    function _authorityJson(address target) internal view returns (string memory) {
        address impl = address(uint160(uint256(vm.load(target, IMPLEMENTATION_SLOT))));
        address admin = address(uint160(uint256(vm.load(target, ADMIN_SLOT))));
        address beacon = address(uint160(uint256(vm.load(target, BEACON_SLOT))));
        (bool ownerOk, address owner) = _probeAddress(target, bytes4(keccak256("owner()")));
        (bool pausedOk, bool paused) = _probeBool(target, bytes4(keccak256("paused()")));
        return string.concat(
            '{ "implementation": ', _addressOrNull(true, impl),
            ', "admin": ', _addressOrNull(true, admin),
            ', "beacon": ', _addressOrNull(true, beacon),
            ', "owner": ', _addressOrNull(ownerOk, owner),
            ', "paused": ', pausedOk ? (paused ? "true" : "false") : "null",
            " }"
        );
    }

    function test_Fork_B01_AAPLonAnswersAsTheIssuerPublishes() public view {
        assertTrue(_bIdentity(), "symbol AAPLon and 18 decimals, as the product page says");
        assertGt(IERC20Like(AAPLON).totalSupply(), 0, "AAPLon has supply");
    }

    function test_Fork_B02_AStagedHolderCanTransferAAPLon() public {
        (bool staged, bool moved) = _bTransfers();
        console2.log("AAPLon balance stageable by storage", staged);
        console2.log("AAPLon moved for an arbitrary holder", moved);
        assertTrue(staged, "the fixture must stage AAPLon before transfer support is tested");
        assertTrue(moved, "the staged holder must deliver the exact AAPLon units");
    }

    function test_Fork_B03_BothComponentsRealRoundTrip() public {
        (bool staged, bool roundTrip) = _bothRealRoundTrip();
        console2.log("staged", staged);
        console2.log("both-real round trip", roundTrip);
        assertTrue(staged, "the fixture must stage both real components");
        assertTrue(roundTrip, "both real components must complete mint, exit and claims");
    }

    function test_Fork_B04_PreviousGasProbeDoesNotContaminateTransfers() public {
        _gasRoundTrip();
        assertGe(IERC20Like(AAPLON).balanceOf(bob), 10e18, "the earlier probe funded Bob");
        (bool staged, bool moved) = _bTransfers();
        assertTrue(staged && moved, "existing Bob funds must not turn a successful transfer into false");
        assertTrue(_wrapperTransfers(), "the wrapper probe must also measure a delta");
    }

    function test_Fork_Observation_G_Authority() public view {
        address impl = address(uint160(uint256(vm.load(RAW, IMPLEMENTATION_SLOT))));
        console2.log("raw AAPLx implementation slot", impl);
        console2.log("wrapper v2 implementation slot", address(uint160(uint256(vm.load(WRAPPER_V2, IMPLEMENTATION_SLOT)))));
        // What is asserted is only that the read happened; who the admin is
        // is a finding for a person, recorded by the evidence test.
        assertTrue(RAW.code.length > 0);
    }

    function test_Fork_Z_RecordEvidence() public {
        (uint256 reserve, uint256 supply) = _wrapperSize();
        bool identity = _identityAsDocumented();
        uint256 cleanState = vm.snapshotState();
        bool transfers = _wrapperTransfers();
        assertTrue(vm.revertToState(cleanState), "restore before wrapper round trip");
        bool roundTrip = _seriesRoundTrip();
        assertTrue(vm.revertToState(cleanState), "restore before unwrap observation");
        (bool unwrapOk, uint256 rawReceived, uint256 quoted) = _unwrap();
        (bool rawMoved, uint256 bobReceived) = unwrapOk ? _rawTransfer() : (false, 0);
        if (unwrapOk) assertEq(rawReceived, quoted, "successful unwrap delivers its quote");
        if (rawMoved) assertApproxEqAbs(bobReceived, 1e18, 1e9, "successful raw transfer delivers within rounding tolerance");
        assertTrue(vm.revertToState(cleanState), "restore before storage observation");
        bool rawStored = _rawBalanceIsStored();
        assertTrue(vm.revertToState(cleanState), "restore before gas measurement");

        string memory json = string.concat(
            "{\n",
            '  "schemaVersion": 2,\n',
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
            '    "rawTransferAttempted": ', unwrapOk ? "true" : "false", ",\n",
            '    "rawReceivedFor1e18Sent": "', vm.toString(bobReceived), '",\n',
            '    "rawBalanceSettableByStorage": ', rawStored ? "true" : "false", "\n",
            "  },\n"
        );
        (uint256 gTransfer, uint256 gTransferB, uint256 gMint, uint256 gExit, uint256 gClaimA, uint256 gClaimB) = _gasRoundTrip();
        assertTrue(vm.revertToState(cleanState), "restore before AAPLon transfer");
        (bool bStaged, bool bMoved) = _bTransfers();
        assertTrue(vm.revertToState(cleanState), "restore before both-real round trip");
        (bool bothStaged, bool bothReal) = _bothRealRoundTrip();
        assertTrue(vm.revertToState(cleanState), "restore before authority reads");
        bool bIdentity = _bIdentity();
        // Do not publish a new record if any behavior advertised as supported failed.
        // Unwrap, raw staging/transfer, inventory, and authority remain dated observations.
        assertTrue(identity && transfers && roundTrip, "required wrapper behavior held");
        assertTrue(bIdentity && bStaged && bMoved && bothStaged && bothReal, "required AAPLon and both-real behavior held");
        json = string.concat(
            json,
            '  "componentB": {\n',
            '    "token": "', vm.toString(AAPLON), '",\n',
            '    "source": "the issuer\'s product page, app.ondo.finance/assets/aaplon, as archived by the desk",\n',
            '    "identityAsPublished": ', bIdentity ? "true" : "false", ",\n",
            '    "totalSupply": "', vm.toString(IERC20Like(AAPLON).totalSupply()), '",\n',
            '    "balanceStageableByStorage": ', bStaged ? "true" : "false", ",\n",
            '    "transfersForArbitraryHolder": ', bMoved ? "true" : "false", ",\n",
            '    "seriesMintExitClaimWithBothReal": ', bothReal ? "true" : "false", ",\n",
            '    "authority": ', _authorityJson(AAPLON), "\n",
            "  },\n"
        );
        json = string.concat(
            json,
            '  "gas": {\n',
            '    "note": "execution gas by gasleft() deltas inside one call, with the real wrapper as A and real AAPLon as B: storage already touched is warm, so a real transaction pays cold access, the 21,000 base and its calldata on top; an input to a cost comparison, not a price",\n',
            '    "wrapperTransfer": ', vm.toString(gTransfer), ",\n",
            '    "aaplonTransfer": ', vm.toString(gTransferB), ",\n",
            '    "mint3Lots": ', vm.toString(gMint), ",\n",
            '    "allocateExit3Lots": ', vm.toString(gExit), ",\n",
            '    "claimA": ', vm.toString(gClaimA), ",\n",
            '    "claimB": ', vm.toString(gClaimB), "\n",
            "  },\n"
        );
        json = string.concat(
            json,
            '  "authority": {\n',
            '    "raw": ', _authorityJson(RAW), ",\n",
            '    "wrapperV2": ', _authorityJson(WRAPPER_V2), ",\n",
            '    "wrapperV1": ', _authorityJson(WRAPPER_V1), "\n",
            "  },\n",
            '  "requiredAssertionsPassed": true,\n',
            '  "observationalOnly": ["unwrap availability", "raw transfer availability after unwrap", "storage staging", "wrapper inventory", "authority slots"],\n',
            '  "notProven": [\n',
            '    "a static balance under every corporate action: one dividend activation is on the record (AppleCorporateActionFork.t.sol); a split is not",\n',
            '    "holder eligibility for a series contract or its receipt holders",\n',
            '    "eligible acquisition of raw tokens, current-wrapper deposit/mint access and limits, or available issuance capacity",\n',
            '    "anything about the issuer\'s reserves, custody, or the value of a unit",\n',
            '    "component B: eligibility of a series contract or its receipt holders under the issuer\'s rules; a transfer that works on a fork for a staged balance is not eligibility"\n',
            "  ],\n",
            '  "how": "contracts/test/fork/AppleComponentsFork.t.sol on a fork of Ethereum; balances set by storage, no holder impersonated; each recorded scenario restores clean fork state and transfer results use recipient balance deltas"\n',
            "}\n"
        );
        vm.writeFile("evidence/apple-s1.fork.json", json);
    }
}
