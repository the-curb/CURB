// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * The credit desk: CURB paid in for the desk's services, credited to an API
 * key by its hash (mechanism §16 — the one function the token is proposed
 * to have: payment for data and integration services that exist).
 *
 * Nothing is held here. A top-up moves CURB from the payer straight to the
 * published treasury and emits the key hash and the amount; the site reads
 * the event and credits the key at the published rate. There is no admin,
 * no pause, no refund path and no upgrade: what a key was credited is
 * decided by this event and the published rate, and nothing else.
 *
 * A credit is a prepaid unit of a service that exists today. It is not a
 * claim on anything, not a share of anything, and not a condition of using
 * the position product.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address holder) external view returns (uint256);
}

contract CreditDesk {
    IERC20 public immutable curb;
    address public immutable treasury;

    event TopUp(bytes32 indexed keyHash, address indexed payer, uint256 amount);

    error ZeroAddress();
    error NotAContract();
    error AmountZero();
    error KeyHashZero();
    error TransferFailed();
    error DeltaWrong();

    constructor(IERC20 curb_, address treasury_) {
        if (address(curb_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (address(curb_).code.length == 0) revert NotAContract();
        curb = curb_;
        treasury = treasury_;
    }

    /// Pay `amount` of CURB to the treasury for the key whose hash is `keyHash`. The amount that arrives must be the amount sent.
    function topUp(bytes32 keyHash, uint256 amount) external {
        if (amount == 0) revert AmountZero();
        if (keyHash == bytes32(0)) revert KeyHashZero();
        uint256 before = curb.balanceOf(treasury);
        (bool ok, bytes memory data) = address(curb).call(abi.encodeCall(IERC20.transferFrom, (msg.sender, treasury, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        if (curb.balanceOf(treasury) != before + amount) revert DeltaWrong();
        emit TopUp(keyHash, msg.sender, amount);
    }
}
