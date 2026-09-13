// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";

interface IObservedToken {
    function balanceOf(address holder) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/** Test-only probe. Existing recipient funds are never counted as this transfer's result. */
abstract contract TransferObservation is Test {
    function _observeTransfer(address token, address sender, address recipient, uint256 amount)
        internal returns (bool accepted, uint256 received)
    {
        uint256 beforeBalance = IObservedToken(token).balanceOf(recipient);
        vm.prank(sender);
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IObservedToken.transfer, (recipient, amount)));
        uint256 afterBalance = IObservedToken(token).balanceOf(recipient);
        accepted = ok && (data.length == 0 || (data.length == 32 && abi.decode(data, (uint256)) == 1));
        if (afterBalance < beforeBalance) return (false, 0);
        received = afterBalance - beforeBalance;
    }
}
