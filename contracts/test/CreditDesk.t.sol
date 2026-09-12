// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { CreditDesk, IERC20 } from "../src/CreditDesk.sol";
import { MockToken } from "../src/mocks/MockToken.sol";

/**
 * The credit desk under test: a top-up is a transfer to the treasury plus
 * an event, or it is nothing. The desk holds nothing, decides nothing, and
 * every way the token could misbehave leaves the payer's balance where it
 * was.
 */
contract CreditDeskTest is Test {
    MockToken curb;
    CreditDesk desk;

    address treasury = address(0x7e);
    address payer = address(0xa1);
    bytes32 constant KEY = keccak256("curb_key_example");

    event TopUp(bytes32 indexed keyHash, address indexed payer, uint256 amount);

    function setUp() public {
        curb = new MockToken("The Curb", "CURB", 18);
        desk = new CreditDesk(IERC20(address(curb)), treasury);
        curb.mint(payer, 1_000e18);
        vm.prank(payer);
        curb.approve(address(desk), type(uint256).max);
    }

    /* ── construction ───────────────────────────────────────────────────── */

    function test_ZeroTokenIsRefused() public {
        vm.expectRevert(CreditDesk.ZeroAddress.selector);
        new CreditDesk(IERC20(address(0)), treasury);
    }

    function test_ZeroTreasuryIsRefused() public {
        vm.expectRevert(CreditDesk.ZeroAddress.selector);
        new CreditDesk(IERC20(address(curb)), address(0));
    }

    function test_TokenWithoutCodeIsRefused() public {
        vm.expectRevert(CreditDesk.NotAContract.selector);
        new CreditDesk(IERC20(address(0xdead)), treasury);
    }

    function test_ImmutablesAreWhatWasGiven() public view {
        assertEq(address(desk.curb()), address(curb));
        assertEq(desk.treasury(), treasury);
    }

    /* ── the one thing it does ──────────────────────────────────────────── */

    function test_TopUpMovesCurbToTheTreasuryAndSaysSo() public {
        vm.expectEmit(true, true, false, true, address(desk));
        emit TopUp(KEY, payer, 25e18);
        vm.prank(payer);
        desk.topUp(KEY, 25e18);
        assertEq(curb.balanceOf(treasury), 25e18, "treasury received the amount");
        assertEq(curb.balanceOf(payer), 975e18, "payer paid the amount");
        assertEq(curb.balanceOf(address(desk)), 0, "the desk holds nothing");
    }

    function test_TwoTopUpsForOneKeyAreTwoEvents() public {
        vm.startPrank(payer);
        desk.topUp(KEY, 10e18);
        desk.topUp(KEY, 15e18);
        vm.stopPrank();
        assertEq(curb.balanceOf(treasury), 25e18);
    }

    function test_AnyoneMayTopUpAnyKey() public {
        address other = address(0xb2);
        curb.mint(other, 5e18);
        vm.startPrank(other);
        curb.approve(address(desk), 5e18);
        vm.expectEmit(true, true, false, true, address(desk));
        emit TopUp(KEY, other, 5e18);
        desk.topUp(KEY, 5e18);
        vm.stopPrank();
    }

    /* ── refusals ───────────────────────────────────────────────────────── */

    function test_ZeroAmountIsRefused() public {
        vm.expectRevert(CreditDesk.AmountZero.selector);
        vm.prank(payer);
        desk.topUp(KEY, 0);
    }

    function test_ZeroKeyHashIsRefused() public {
        vm.expectRevert(CreditDesk.KeyHashZero.selector);
        vm.prank(payer);
        desk.topUp(bytes32(0), 1e18);
    }

    function test_NoAllowanceMeansNothingMoves() public {
        address stranger = address(0xc3);
        curb.mint(stranger, 50e18);
        vm.expectRevert(CreditDesk.TransferFailed.selector);
        vm.prank(stranger);
        desk.topUp(KEY, 50e18);
        assertEq(curb.balanceOf(stranger), 50e18);
        assertEq(curb.balanceOf(treasury), 0);
    }

    function test_ATransferThatReturnsFalseIsRefused() public {
        curb.setReturnFalse(true);
        vm.expectRevert(CreditDesk.TransferFailed.selector);
        vm.prank(payer);
        desk.topUp(KEY, 1e18);
    }

    function test_AHaltedTokenIsRefused() public {
        curb.setHalted(true);
        vm.expectRevert(CreditDesk.TransferFailed.selector);
        vm.prank(payer);
        desk.topUp(KEY, 1e18);
    }

    function test_AFeeOnTransferIsRefusedRatherThanCreditedShort() public {
        curb.setFeeBps(100);
        vm.expectRevert(CreditDesk.DeltaWrong.selector);
        vm.prank(payer);
        desk.topUp(KEY, 100e18);
        assertEq(curb.balanceOf(payer), 1_000e18, "the payer keeps everything when the desk refuses");
        assertEq(curb.balanceOf(treasury), 0);
    }

    function test_MoreThanTheBalanceIsRefused() public {
        vm.expectRevert(CreditDesk.TransferFailed.selector);
        vm.prank(payer);
        desk.topUp(KEY, 1_001e18);
    }

    /* ── fuzz: the event equals the transfer ────────────────────────────── */

    function testFuzz_EventAmountEqualsTreasuryDelta(bytes32 keyHash, uint128 amount) public {
        vm.assume(keyHash != bytes32(0));
        vm.assume(amount > 0 && amount <= 1_000e18);
        uint256 before = curb.balanceOf(treasury);
        vm.expectEmit(true, true, false, true, address(desk));
        emit TopUp(keyHash, payer, amount);
        vm.prank(payer);
        desk.topUp(keyHash, amount);
        assertEq(curb.balanceOf(treasury) - before, amount);
        assertEq(curb.balanceOf(address(desk)), 0);
    }
}
