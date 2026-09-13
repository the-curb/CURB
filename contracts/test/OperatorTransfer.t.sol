// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { CompanySeries } from "../src/CompanySeries.sol";
import { MockToken } from "../src/mocks/MockToken.sol";
import { MockMultisig } from "../src/mocks/MockMultisig.sol";

contract OperatorTransferTest is Test {
    CompanySeries series;
    address current = address(0x10);
    address nominee = address(0x20);
    address other = address(0x30);

    function setUp() public {
        MockToken a = new MockToken("A", "A", 18);
        MockToken b = new MockToken("B", "B", 18);
        series = new CompanySeries(address(a), address(b), 10, 20, 100, current, "x", "x");
    }

    function nominate(address next) internal {
        vm.prank(current);
        series.transferOperator(next);
    }

    function test_NominationDoesNotGrantAuthorityOrRemoveCurrentOperator() public {
        nominate(nominee);
        assertEq(series.operator(), current);
        assertEq(series.pendingOperator(), nominee);
        vm.prank(nominee);
        vm.expectRevert(CompanySeries.NotOperator.selector);
        series.setMintPaused(true, "not yet accepted");
        vm.prank(current);
        series.setMintPaused(true, "current operator retains authority");
        assertTrue(series.mintPaused());
    }

    function test_OnlyNomineeCanAcceptAndOldAuthorityIsRemoved() public {
        nominate(nominee);
        vm.prank(current);
        vm.expectRevert(CompanySeries.NotPendingOperator.selector);
        series.acceptOperator();
        vm.prank(other);
        vm.expectRevert(CompanySeries.NotPendingOperator.selector);
        series.acceptOperator();
        vm.prank(nominee);
        series.acceptOperator();
        assertEq(series.operator(), nominee);
        assertEq(series.pendingOperator(), address(0));
        vm.prank(current);
        vm.expectRevert(CompanySeries.NotOperator.selector);
        series.setMintPaused(true, "former operator");
        vm.prank(nominee);
        series.setClaimPermit(other, true);
        assertTrue(series.claimPermitted(other));
        vm.prank(nominee);
        vm.expectRevert(CompanySeries.NotPendingOperator.selector);
        series.acceptOperator();
    }

    function test_CancelledOrReplacedNomineeCannotAccept() public {
        nominate(nominee);
        vm.prank(current);
        series.cancelOperatorTransfer();
        assertEq(series.operator(), current);
        vm.prank(nominee);
        vm.expectRevert(CompanySeries.NotPendingOperator.selector);
        series.acceptOperator();
        nominate(nominee);
        nominate(other);
        vm.prank(nominee);
        vm.expectRevert(CompanySeries.NotPendingOperator.selector);
        series.acceptOperator();
        vm.prank(other);
        series.acceptOperator();
        assertEq(series.operator(), other);
    }

    function test_ZeroAndUnauthorizedNominationOrCancellationAreRefused() public {
        vm.prank(current);
        vm.expectRevert(CompanySeries.ZeroAddress.selector);
        series.transferOperator(address(0));
        vm.prank(other);
        vm.expectRevert(CompanySeries.NotOperator.selector);
        series.transferOperator(nominee);
        vm.prank(other);
        vm.expectRevert(CompanySeries.NotOperator.selector);
        series.cancelOperatorTransfer();
        vm.prank(current);
        vm.expectRevert(CompanySeries.NoPendingOperator.selector);
        series.cancelOperatorTransfer();
    }

    function test_MultisigAcceptanceRequiresQuorumAndKeepsExistingPermits() public {
        address[] memory owners = new address[](3);
        owners[0] = address(0x41);
        owners[1] = address(0x42);
        owners[2] = address(0x43);
        MockMultisig safe = new MockMultisig(owners, 2);
        vm.prank(current);
        series.setClaimPermit(other, true);
        nominate(address(safe));
        vm.prank(owners[0]);
        uint256 id = safe.propose(address(series), abi.encodeCall(CompanySeries.acceptOperator, ()));
        assertEq(series.operator(), current, "one signature cannot accept");
        vm.prank(owners[1]);
        safe.confirm(id);
        assertEq(series.operator(), address(safe));
        assertTrue(series.claimPermitted(other), "handover changes no existing holder permit");
    }
}
