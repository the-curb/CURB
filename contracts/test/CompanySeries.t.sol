// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { CompanySeries } from "../src/CompanySeries.sol";
import { MockToken } from "../src/mocks/MockToken.sol";

/**
 * The blueprint's test plan (MECHANISM.md §14), run against the prototype.
 * Each test names its case. Units are the illustrative ones scaled to 18
 * decimals: 10 A and 20 B to a lot.
 */
contract CompanySeriesTest is Test {
    uint256 constant QA = 10e18;
    uint256 constant QB = 20e18;
    uint256 constant CAP = 1_000;

    MockToken a;
    MockToken b;
    CompanySeries series;

    address operator = address(0x0e);
    address alice = address(0xa1);
    address bob = address(0xb2);
    address others = address(0xc3);

    function setUp() public {
        a = new MockToken("Component A", "A", 18);
        b = new MockToken("Component B", "B", 18);
        series = new CompanySeries(address(a), address(b), QA, QB, CAP, operator, "Apple Position - Series 1", "cAAPL-S1");
        _permit(alice);
        _permit(bob);
        _permit(others);
        _fund(alice, 1_000);
        _fund(bob, 1_000);
        _fund(others, 1_000);
    }

    function _permit(address who) internal {
        vm.startPrank(operator);
        series.setMintPermit(who, type(uint64).max);
        series.setClaimPermit(who, true);
        vm.stopPrank();
    }

    function _fund(address who, uint256 lots) internal {
        a.mint(who, lots * QA);
        b.mint(who, lots * QB);
        vm.startPrank(who);
        a.approve(address(series), type(uint256).max);
        b.approve(address(series), type(uint256).max);
        vm.stopPrank();
    }

    function _mint(address who, uint256 lots) internal {
        vm.prank(who);
        series.mint(lots, block.timestamp + 1 hours);
    }

    function _exit(address who, uint256 lots) internal {
        vm.prank(who);
        series.allocateExit(lots);
    }

    function _claim(address who, uint8 component) internal {
        vm.prank(who);
        series.claimComponent(component);
    }

    function _assertSolvent() internal view {
        assertGe(a.balanceOf(address(series)), series.liabilityA(), "A held >= A owed");
        assertGe(b.balanceOf(address(series)), series.liabilityB(), "B held >= B owed");
        assertLe(series.liabilityA(), CAP * QA, "A within cap");
        assertLe(series.liabilityB(), CAP * QB, "B within cap");
    }

    /* ── construction ───────────────────────────────────────────────────── */

    function test_T19_TwoComponentsWithOneAddressAreRefused() public {
        vm.expectRevert(CompanySeries.ComponentsMustDiffer.selector);
        new CompanySeries(address(a), address(a), QA, QB, CAP, operator, "x", "x");
    }

    function test_ConstructionRefusesZeroUnitsAndNonContracts() public {
        vm.expectRevert(CompanySeries.UnitsMustBePositive.selector);
        new CompanySeries(address(a), address(b), 0, QB, CAP, operator, "x", "x");
        vm.expectRevert(CompanySeries.NotAContract.selector);
        new CompanySeries(address(a), address(0x1234), QA, QB, CAP, operator, "x", "x");
        vm.expectRevert(CompanySeries.CapMustBePositive.selector);
        new CompanySeries(address(a), address(b), QA, QB, 0, operator, "x", "x");
    }

    /* ── T01–T03 ────────────────────────────────────────────────────────── */

    function test_T01_MintIsExact() public {
        _mint(alice, 3);
        assertEq(series.totalSupply(), 3);
        assertEq(series.balanceOf(alice), 3);
        assertEq(a.balanceOf(address(series)), 3 * QA);
        assertEq(b.balanceOf(address(series)), 3 * QB);
        assertEq(series.liabilityA(), 3 * QA);
        _assertSolvent();
    }

    function test_T02_SecondComponentFailingRevertsTheWholeMint() public {
        b.setHalted(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.TransferFailed.selector, uint8(1)));
        series.mint(3, block.timestamp + 1 hours);
        assertEq(series.totalSupply(), 0);
        assertEq(a.balanceOf(address(series)), 0, "no partial deposit of A is final");
        assertEq(a.balanceOf(alice), 1_000 * QA);
    }

    function test_T03_ExitMovesActiveToReservedAndChangesNoLiability() public {
        _mint(alice, 4);
        uint256 owedA = series.liabilityA();
        uint256 owedB = series.liabilityB();
        _exit(alice, 1);
        assertEq(series.liabilityA(), owedA);
        assertEq(series.liabilityB(), owedB);
        assertEq(series.totalSupply(), 3);
        assertEq(series.reservedA(), QA);
        assertEq(series.claimA(alice), QA);
        assertEq(series.claimB(alice), QB);
        _assertSolvent();
    }

    /* ── T04–T08 ────────────────────────────────────────────────────────── */

    function test_T04_HaltedAKeepsTheClaimAndLetsBBeClaimedWithoutTouchingA() public {
        _mint(alice, 2);
        _exit(alice, 2);
        a.setHalted(true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.TransferFailed.selector, uint8(0)));
        series.claimComponent(0);
        assertEq(series.claimA(alice), 2 * QA, "the A claim is intact");

        _claim(alice, 1);
        assertEq(series.claimB(alice), 0);
        assertEq(b.balanceOf(alice), 1_000 * QB);
        assertEq(a.balanceOf(address(series)), 2 * QA, "A was not moved");
        assertEq(series.reservedA(), 2 * QA);
    }

    function test_T05_ClaimPaysOnceAndOnlyToItsHolder() public {
        _mint(alice, 1);
        _exit(alice, 1);
        _claim(alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.NothingToClaim.selector, uint8(0)));
        series.claimComponent(0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.NothingToClaim.selector, uint8(0)));
        series.claimComponent(0);
    }

    function test_T06_LaterDepositorGetsNoPartOfTheReserve() public {
        _mint(alice, 5);
        _exit(alice, 5);
        _mint(bob, 2);
        assertEq(series.reservedA(), 5 * QA);
        assertEq(series.claimA(alice), 5 * QA);
        assertEq(series.totalSupply(), 2);
        assertEq(a.balanceOf(address(series)), 7 * QA);
        _assertSolvent();
    }

    function test_T07_DonationChangesNoLotReceiptOrClaim() public {
        a.mint(address(series), 999);
        _mint(alice, 1);
        assertEq(series.balanceOf(alice), 1);
        assertEq(series.liabilityA(), QA, "the surplus backs nothing and prices nothing");
        assertEq(a.balanceOf(address(series)), QA + 999);
        _exit(alice, 1);
        assertEq(series.claimA(alice), QA, "the surplus is not claimable");
        _claim(alice, 0);
        assertEq(a.balanceOf(address(series)), 999, "the surplus stays; nothing sweeps it");
    }

    function test_T08_ShortfallHaltsNominalPaymentForEveryone() public {
        _mint(alice, 2);
        _mint(bob, 2);
        _exit(alice, 2);
        _exit(bob, 2);
        // 40 A owed; 15 A leave by a path that is not a claim (modelled by the mock).
        vm.prank(address(series));
        a.transfer(others, 15e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.ShortfallHaltsPayment.selector, uint8(0)));
        series.claimComponent(0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.ShortfallHaltsPayment.selector, uint8(0)));
        series.claimComponent(0);
        assertEq(a.balanceOf(address(series)), 25e18, "nothing was taken early");
        _claim(alice, 1);
    }

    /* ── T09–T12 ────────────────────────────────────────────────────────── */

    function test_T09_ReentrantClaimIsRefusedAndAFalseReturnReverts() public {
        _mint(alice, 1);
        _exit(alice, 1);
        a.setReenter(address(series), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.TransferFailed.selector, uint8(0)));
        series.claimComponent(0);
        assertEq(series.claimA(alice), QA, "the claim is whole after the refused reentry");
        a.setReenter(address(0), 0);

        b.setReturnFalse(true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.TransferFailed.selector, uint8(1)));
        series.mint(1, block.timestamp + 1 hours);
        assertEq(series.totalSupply(), 0, "alice exited her lot; bob's mint did not land");
    }

    function test_T10_FeeOnTransferIsRejectedByTheDelta() public {
        a.setFeeBps(100);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.DepositDeltaWrong.selector, uint8(0)));
        series.mint(1, block.timestamp + 1 hours);
        assertEq(series.totalSupply(), 0);
    }

    function test_T11_ZeroSupplyWithReservesDoesNotLetANewMintAdoptThem() public {
        _mint(alice, 1);
        _exit(alice, 1);
        assertEq(series.totalSupply(), 0);
        _mint(bob, 1);
        assertEq(a.balanceOf(address(series)), 2 * QA);
        assertEq(series.reservedA(), QA);
        assertEq(series.claimA(alice), QA);
        _assertSolvent();
    }

    function test_T12_LargeIntegersDoNotOverflowOrLosePrecision() public {
        MockToken bigA = new MockToken("A", "A", 18);
        MockToken bigB = new MockToken("B", "B", 6);
        CompanySeries big = new CompanySeries(address(bigA), address(bigB), 1e18, 1e6, 1e9, operator, "x", "x");
        vm.startPrank(operator);
        big.setMintPermit(alice, type(uint64).max);
        big.setClaimPermit(alice, true);
        vm.stopPrank();
        bigA.mint(alice, 123_456_789e18);
        bigB.mint(alice, 123_456_789e6);
        vm.startPrank(alice);
        bigA.approve(address(big), type(uint256).max);
        bigB.approve(address(big), type(uint256).max);
        big.mint(123_456_789, block.timestamp + 1 hours);
        vm.stopPrank();
        assertEq(big.liabilityA(), 123_456_789e18);
        assertEq(big.liabilityB(), 123_456_789e6);
        assertEq(big.balanceOf(alice), 123_456_789);
    }

    /* ── T17, T22–T25 ───────────────────────────────────────────────────── */

    function test_T17_ReceiptTransferIsAlwaysRefused() public {
        _mint(alice, 1);
        vm.startPrank(alice);
        vm.expectRevert(CompanySeries.ReceiptNotTransferable.selector);
        series.transfer(bob, 1);
        vm.expectRevert(CompanySeries.ReceiptNotTransferable.selector);
        series.approve(bob, 1);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(CompanySeries.ReceiptNotTransferable.selector);
        series.transferFrom(alice, bob, 1);
        assertEq(series.balanceOf(alice), 1);
    }

    function test_T22_BurnAndRemintCannotPassACapThatCountsReserved() public {
        MockToken smallA = new MockToken("A", "A", 18);
        MockToken smallB = new MockToken("B", "B", 18);
        CompanySeries small = new CompanySeries(address(smallA), address(smallB), QA, QB, 10, operator, "x", "x");
        vm.startPrank(operator);
        small.setMintPermit(alice, type(uint64).max);
        small.setClaimPermit(alice, true);
        small.setMintPermit(bob, type(uint64).max);
        vm.stopPrank();
        smallA.mint(alice, 10 * QA);
        smallB.mint(alice, 10 * QB);
        smallA.mint(bob, QA);
        smallB.mint(bob, QB);
        vm.startPrank(alice);
        smallA.approve(address(small), type(uint256).max);
        smallB.approve(address(small), type(uint256).max);
        small.mint(10, block.timestamp + 1 hours);
        small.allocateExit(10);
        vm.stopPrank();
        vm.startPrank(bob);
        smallA.approve(address(small), type(uint256).max);
        smallB.approve(address(small), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.CapExceeded.selector, uint8(0)));
        small.mint(1, block.timestamp + 1 hours);
        vm.stopPrank();
        vm.prank(alice);
        small.claimComponent(0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.CapExceeded.selector, uint8(1)));
        small.mint(1, block.timestamp + 1 hours);
        vm.prank(alice);
        small.claimComponent(1);
        vm.prank(bob);
        small.mint(1, block.timestamp + 1 hours);
        assertEq(small.balanceOf(bob), 1);
    }

    function test_T23_ExactDepositDoesNotCoverAnOlderShortfall() public {
        _mint(alice, 2);
        vm.prank(address(series));
        b.transfer(others, 5e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.BackingShort.selector, uint8(1)));
        series.mint(1, block.timestamp + 1 hours);
        assertEq(series.balanceOf(bob), 0);
    }

    function test_T24_SupplyChangesOnlyThroughDepositOrExit() public {
        _mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(CompanySeries.LotsMustBePositive.selector);
        series.mint(0, block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(CompanySeries.InsufficientReceipts.selector);
        series.allocateExit(2);
        vm.prank(bob);
        vm.expectRevert(CompanySeries.InsufficientReceipts.selector);
        series.allocateExit(1);
        assertEq(series.totalSupply(), 1);
    }

    function test_T25_PermitsLiveOnChainAndAreSeparate() public {
        _mint(alice, 1);
        _exit(alice, 1);
        vm.prank(operator);
        series.setMintPermit(alice, uint64(block.timestamp - 1));
        vm.prank(alice);
        vm.expectRevert(CompanySeries.MintPermitMissing.selector);
        series.mint(1, block.timestamp + 1 hours);
        // An expired mint permit does not touch the claim permit.
        _claim(alice, 0);
        vm.prank(operator);
        series.setClaimPermit(alice, false);
        vm.prank(alice);
        vm.expectRevert(CompanySeries.ClaimPermitMissing.selector);
        series.claimComponent(1);
        assertEq(series.claimB(alice), QB, "a revoked permit leaves the claim recorded");
    }

    function test_T20_ARevertingBalanceOfOnADoesNotTouchExitOrBClaims() public {
        _mint(alice, 2);
        a.setRevertBalanceOf(true);
        _exit(alice, 1);
        assertEq(series.reservedA(), QA, "exit allocation calls no token");
        _claim(alice, 1);
        assertEq(series.claimB(alice), 0, "claiming B never reads A");
        vm.prank(alice);
        vm.expectRevert(bytes("BALANCEOF_REVERTS"));
        series.claimComponent(0);
        assertEq(series.claimA(alice), QA, "the A claim is intact");
    }

    /* ── the operator's limits ──────────────────────────────────────────── */

    function test_OperatorStopsArePerOperationAndPerComponent() public {
        _mint(alice, 1);
        _exit(alice, 1);
        vm.prank(operator);
        series.setMintPaused(true, "assumptions unconfirmed");
        vm.prank(bob);
        vm.expectRevert(CompanySeries.MintPaused.selector);
        series.mint(1, block.timestamp + 1 hours);
        vm.prank(operator);
        series.setClaimPaused(0, true, "exploit risk");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.ClaimPaused.selector, uint8(0)));
        series.claimComponent(0);
        _claim(alice, 1);
        assertEq(series.claimA(alice), QA);
        vm.prank(alice);
        vm.expectRevert(CompanySeries.NotOperator.selector);
        series.setMintPaused(false, "");
    }

    function test_PreviewDeadlineIsHonoured() public {
        vm.prank(alice);
        vm.expectRevert(CompanySeries.PreviewExpired.selector);
        series.mint(1, block.timestamp - 1);
    }

    /* ── the worked example, row by row ─────────────────────────────────── */

    function test_WorkedExample() public {
        _mint(alice, 25);
        _mint(others, 75);
        _row(100, 1_000e18, 0, 2_000e18, 0);
        _exit(alice, 25);
        _row(75, 750e18, 250e18, 1_500e18, 500e18);
        a.setHalted(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.TransferFailed.selector, uint8(0)));
        series.claimComponent(0);
        _claim(alice, 1);
        _row(75, 750e18, 250e18, 1_500e18, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CompanySeries.TransferFailed.selector, uint8(0)));
        series.mint(10, block.timestamp + 1 hours);
        a.setHalted(false);
        _mint(bob, 10);
        _row(85, 850e18, 250e18, 1_700e18, 0);
        assertEq(series.claimA(alice), 250e18, "alice keeps her claim; bob got no part of it");
        _assertSolvent();
    }

    function _row(uint256 n, uint256 activeA, uint256 reservedA_, uint256 activeB, uint256 reservedB_) internal view {
        assertEq(series.totalSupply(), n, "receipts");
        assertEq(series.totalSupply() * QA, activeA, "A active");
        assertEq(series.reservedA(), reservedA_, "A reserved");
        assertEq(series.totalSupply() * QB, activeB, "B active");
        assertEq(series.reservedB(), reservedB_, "B reserved");
    }

    /* ── fuzz: any order of mints, exits and claims keeps the invariants ── */

    function testFuzz_SequencesKeepTheInvariants(uint8[16] calldata ops, uint8[16] calldata amounts) public {
        address[3] memory holders = [alice, bob, others];
        for (uint256 i = 0; i < ops.length; i++) {
            address who = holders[ops[i] % 3];
            uint256 lots = (amounts[i] % 9) + 1;
            uint8 op = (ops[i] / 3) % 4;
            vm.startPrank(who);
            if (op == 0) {
                if (series.totalSupply() + lots <= 900) series.mint(lots, block.timestamp + 1 hours);
            } else if (op == 1) {
                if (series.balanceOf(who) >= lots) series.allocateExit(lots);
            } else if (op == 2) {
                if (series.claimA(who) > 0) series.claimComponent(0);
            } else {
                if (series.claimB(who) > 0) series.claimComponent(1);
            }
            vm.stopPrank();
            _assertSolvent();
            assertEq(series.balanceOf(alice) + series.balanceOf(bob) + series.balanceOf(others), series.totalSupply(), "n = sum of receipts");
            assertEq(series.claimA(alice) + series.claimA(bob) + series.claimA(others), series.reservedA(), "R[A] = sum of claims");
            assertEq(series.claimB(alice) + series.claimB(bob) + series.claimB(others), series.reservedB(), "R[B] = sum of claims");
        }
    }
}
