// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { TransferObservation } from "./helpers/TransferObservation.sol";
import { MockToken } from "../src/mocks/MockToken.sol";

/** Local regressions for the same transfer probe used by the Ethereum evidence writer. */
contract TransferObservationTest is TransferObservation {
    MockToken token;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new MockToken("Observed component", "OBS", 18);
        token.mint(alice, 40e18);
        token.mint(bob, 10e18); // the gas probe funded Bob before the old AAPLon observation
    }

    function test_TransferObservation_PrefundedRecipientCountsOnlyNewUnits() public {
        (bool accepted, uint256 received) = _observeTransfer(address(token), alice, bob, 4e18);
        assertTrue(accepted);
        assertEq(received, 4e18);
        assertEq(token.balanceOf(bob), 14e18);
    }

    function test_TransferObservation_RepeatedProbesMeasureEachTransfer() public {
        _observeTransfer(address(token), alice, bob, 4e18);
        (bool accepted, uint256 received) = _observeTransfer(address(token), alice, bob, 4e18);
        assertTrue(accepted);
        assertEq(received, 4e18);
        assertEq(token.balanceOf(bob), 18e18);
    }

    function test_TransferObservation_FalseReturnDoesNotCountExistingFunds() public {
        token.setReturnFalse(true);
        (bool accepted, uint256 received) = _observeTransfer(address(token), alice, bob, 4e18);
        assertFalse(accepted);
        assertEq(received, 0);
        assertEq(token.balanceOf(bob), 10e18);
    }

    function test_TransferObservation_RevertDoesNotCountExistingFunds() public {
        token.setHalted(true);
        (bool accepted, uint256 received) = _observeTransfer(address(token), alice, bob, 4e18);
        assertFalse(accepted);
        assertEq(received, 0);
    }

    function test_TransferObservation_FeeIsVisibleInReceivedUnits() public {
        token.setFeeBps(100);
        (bool accepted, uint256 received) = _observeTransfer(address(token), alice, bob, 4e18);
        assertTrue(accepted);
        assertEq(received, 3.96e18);
        assertTrue(received != 4e18, "accepting a call does not prove an exact transfer");
    }
}
