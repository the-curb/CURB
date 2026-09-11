// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * A component for the tests: an ERC-20 whose misbehaviour can be switched
 * on. Each switch is a case in the blueprint's plan — an issuer halt, a
 * transfer that returns false, a fee on transfer, a reentrant callback —
 * so the series can be shown to refuse each one rather than assumed to.
 */
interface IReenter {
    function claimComponent(uint8 component) external;
}

contract MockToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) public allowance;

    /// The issuer has halted transfers: every transfer reverts.
    bool public halted;
    /// A broken token: transfers do nothing and return false.
    bool public returnFalse;
    /// A fee-on-transfer token: the recipient gets less than was sent.
    uint256 public feeBps;
    /// A token whose balanceOf reverts — an oracle of nothing, for T20.
    bool public revertBalanceOf;
    /// A malicious token: on transfer out, call back into the series.
    address public reenterTarget;
    uint8 public reenterComponent;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function balanceOf(address holder) external view returns (uint256) {
        require(!revertBalanceOf, "BALANCEOF_REVERTS");
        return _balances[holder];
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function setHalted(bool value) external {
        halted = value;
    }

    function setReturnFalse(bool value) external {
        returnFalse = value;
    }

    function setFeeBps(uint256 value) external {
        feeBps = value;
    }

    function setRevertBalanceOf(bool value) external {
        revertBalanceOf = value;
    }

    function setReenter(address target, uint8 component) external {
        reenterTarget = target;
        reenterComponent = component;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (returnFalse) return false;
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        allowance[from][msg.sender] = allowed - amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        require(!halted, "HALTED");
        if (returnFalse) return false;
        uint256 fee = (amount * feeBps) / 10_000;
        require(_balances[from] >= amount, "BALANCE");
        _balances[from] -= amount;
        _balances[to] += amount - fee;
        if (fee > 0) totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
        if (reenterTarget != address(0) && from == reenterTarget) {
            IReenter(reenterTarget).claimComponent(reenterComponent);
        }
        return true;
    }
}
