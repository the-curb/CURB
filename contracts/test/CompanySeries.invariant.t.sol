// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { CompanySeries } from "../src/CompanySeries.sol";
import { MockToken } from "../src/mocks/MockToken.sol";

/**
 * Invariant tests: a handler the fuzzer drives through every entry point —
 * mint, exit, claim, donation, an issuer halt and resume, an issuer seizing
 * balance from the series, the operator's stops and permits, transfer
 * attempts on the receipt — in random order with random sizes, and after
 * every call the invariants below must hold. A sequence that breaks one is
 * shrunk and printed.
 *
 * Reverts are allowed inside the handler (a mint over the cap, a claim of
 * nothing, a transfer that must fail); what is asserted is the state after.
 * This is the adversarial run a reviewer would start from (C07, C09). It
 * is not the review.
 */
contract Handler is Test {
    CompanySeries public series;
    MockToken public a;
    MockToken public b;
    address public operator;
    address[] public holders;

    /// Balance the issuer removed from the series without a transfer: the one way the series can be short.
    uint256 public seizedA;
    uint256 public seizedB;
    /// Sums the ledger must equal, kept by the handler from the events it caused.
    uint256 public ghostMinted;
    uint256 public ghostExited;
    /// Set if a claim was ever paid while the series held less of that component than it owed.
    bool public paidWhileShort;
    uint256 public calls;

    constructor(CompanySeries series_, MockToken a_, MockToken b_, address operator_, address[] memory holders_) {
        series = series_;
        a = a_;
        b = b_;
        operator = operator_;
        holders = holders_;
    }

    function _holder(uint256 seed) internal view returns (address) {
        return holders[seed % holders.length];
    }

    function mint(uint256 seed, uint256 lots) external {
        calls++;
        lots = bound(lots, 1, 50);
        address who = _holder(seed);
        vm.prank(who);
        try series.mint(lots, block.timestamp + 1 hours) {
            ghostMinted += lots;
        } catch {}
    }

    function exit(uint256 seed, uint256 lots) external {
        calls++;
        address who = _holder(seed);
        uint256 held = series.balanceOf(who);
        if (held == 0) return;
        lots = bound(lots, 1, held);
        vm.prank(who);
        try series.allocateExit(lots) {
            ghostExited += lots;
        } catch {}
    }

    function claim(uint256 seed, uint8 component) external {
        calls++;
        address who = _holder(seed);
        uint8 c = component % 2;
        bool short = c == 0 ? a.balanceOf(address(series)) < series.liabilityA() : b.balanceOf(address(series)) < series.liabilityB();
        vm.prank(who);
        try series.claimComponent(c) {
            if (short) paidWhileShort = true;
        } catch {}
    }

    function donate(uint256 seed, uint256 amount) external {
        calls++;
        amount = bound(amount, 1, 100e18);
        if (seed % 2 == 0) a.mint(address(series), amount);
        else b.mint(address(series), amount);
    }

    function halt(uint256 seed, bool on) external {
        calls++;
        if (seed % 2 == 0) a.setHalted(on);
        else b.setHalted(on);
    }

    function seize(uint256 seed, uint256 amount) external {
        calls++;
        if (seed % 2 == 0) {
            amount = bound(amount, 0, a.balanceOf(address(series)) / 10);
            if (amount == 0) return;
            a.seize(address(series), amount);
            seizedA += amount;
        } else {
            amount = bound(amount, 0, b.balanceOf(address(series)) / 10);
            if (amount == 0) return;
            b.seize(address(series), amount);
            seizedB += amount;
        }
    }

    function stop(uint256 seed, bool on) external {
        calls++;
        vm.startPrank(operator);
        if (seed % 3 == 0) series.setMintPaused(on, "invariant run");
        else series.setClaimPaused(uint8(seed % 2), on, "invariant run");
        vm.stopPrank();
    }

    function transferReceipt(uint256 seed, uint256 amount) external {
        calls++;
        address who = _holder(seed);
        vm.prank(who);
        try series.transfer(_holder(seed + 1), amount) {
            revert("a receipt transfer went through");
        } catch {}
    }

    function sumReceipts() external view returns (uint256 s) {
        for (uint256 i = 0; i < holders.length; i++) s += series.balanceOf(holders[i]);
    }

    function sumClaimA() external view returns (uint256 s) {
        for (uint256 i = 0; i < holders.length; i++) s += series.claimA(holders[i]);
    }

    function sumClaimB() external view returns (uint256 s) {
        for (uint256 i = 0; i < holders.length; i++) s += series.claimB(holders[i]);
    }
}

contract CompanySeriesInvariantTest is StdInvariant, Test {
    uint256 constant QA = 10e18;
    uint256 constant QB = 20e18;
    uint256 constant CAP = 1_000;

    MockToken a;
    MockToken b;
    CompanySeries series;
    Handler handler;
    address operator = address(0x0E);

    function setUp() public {
        a = new MockToken("Component A", "A", 18);
        b = new MockToken("Component B", "B", 18);
        series = new CompanySeries(address(a), address(b), QA, QB, CAP, operator, "Apple Position - Series 1", "cAAPL-S1");
        address[] memory holders = new address[](4);
        holders[0] = address(0xA11CE);
        holders[1] = address(0xB0B);
        holders[2] = address(0xCA201);
        holders[3] = address(0xDA4E);
        for (uint256 i = 0; i < holders.length; i++) {
            vm.startPrank(operator);
            series.setMintPermit(holders[i], type(uint64).max);
            series.setClaimPermit(holders[i], true);
            vm.stopPrank();
            a.mint(holders[i], 2_000 * QA);
            b.mint(holders[i], 2_000 * QB);
            vm.startPrank(holders[i]);
            a.approve(address(series), type(uint256).max);
            b.approve(address(series), type(uint256).max);
            vm.stopPrank();
        }
        handler = new Handler(series, a, b, operator, holders);
        targetContract(address(handler));
    }

    /// n = Σ receipts; R[i] = Σ claims of i; liability is exactly n·q + R.
    function invariant_LedgerSumsAgree() public view {
        assertEq(handler.sumReceipts(), series.totalSupply(), "n = sum of receipts");
        assertEq(handler.sumClaimA(), series.reservedA(), "R[A] = sum of A claims");
        assertEq(handler.sumClaimB(), series.reservedB(), "R[B] = sum of B claims");
        assertEq(series.liabilityA(), series.totalSupply() * QA + series.reservedA(), "liability A is n*q + R");
        assertEq(series.liabilityB(), series.totalSupply() * QB + series.reservedB(), "liability B is n*q + R");
    }

    /// The series holds at least what it owes, less only what the issuer seized from it. A donation only raises the surplus.
    function invariant_BackingCoversLiabilityButForSeizure() public view {
        assertGe(a.balanceOf(address(series)) + handler.seizedA(), series.liabilityA(), "A held + seized >= A owed");
        assertGe(b.balanceOf(address(series)) + handler.seizedB(), series.liabilityB(), "B held + seized >= B owed");
    }

    /// Liability never passes the cap, however the sequence lowered and raised active supply.
    function invariant_CapCountsReserved() public view {
        assertLe(series.liabilityA(), CAP * QA, "A within cap, reserved included");
        assertLe(series.liabilityB(), CAP * QB, "B within cap, reserved included");
    }

    /// Lots come into existence only by mint and leave only by exit allocation.
    function invariant_SupplyOnlyByMintAndExit() public view {
        assertEq(series.totalSupply(), handler.ghostMinted() - handler.ghostExited(), "n = minted - exited");
    }

    /// While a component is short, nobody is paid from it: the fastest claimant never takes the remainder.
    function invariant_ShortfallHaltsPayment() public view {
        assertFalse(handler.paidWhileShort(), "a claim was paid while the series was short of that component");
    }
}
