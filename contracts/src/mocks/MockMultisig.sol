// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * A stand-in for the operator multisig, for rehearsals only: owners, a
 * threshold, propose / confirm / execute. It exists so the operator policy
 * — one signer stops minting? no: any signer proposes, a quorum executes —
 * can be rehearsed on a local chain with the bytes the operator tool
 * prints. A pilot would use an audited multisig (a Safe), not this.
 */
contract MockMultisig {
    struct Proposal {
        address to;
        bytes data;
        uint256 confirmations;
        bool executed;
    }

    address[] public owners;
    uint256 public immutable threshold;
    mapping(address => bool) public isOwner;
    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    event Proposed(uint256 indexed id, address indexed by, address to, bytes data);
    event Confirmed(uint256 indexed id, address indexed by, uint256 confirmations);
    event Executed(uint256 indexed id, bool ok);

    error NotOwner();
    error AlreadyConfirmed();
    error AlreadyExecuted();
    error CallFailed();

    constructor(address[] memory owners_, uint256 threshold_) {
        require(owners_.length >= threshold_ && threshold_ > 0, "threshold");
        for (uint256 i = 0; i < owners_.length; i++) {
            isOwner[owners_[i]] = true;
            owners.push(owners_[i]);
        }
        threshold = threshold_;
    }

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    /// Propose and confirm in one step; executes at once if the threshold is one.
    function propose(address to, bytes calldata data) external onlyOwner returns (uint256 id) {
        proposals.push(Proposal({ to: to, data: data, confirmations: 0, executed: false }));
        id = proposals.length - 1;
        emit Proposed(id, msg.sender, to, data);
        _confirm(id);
    }

    function confirm(uint256 id) external onlyOwner {
        _confirm(id);
    }

    function _confirm(uint256 id) internal {
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (confirmed[id][msg.sender]) revert AlreadyConfirmed();
        confirmed[id][msg.sender] = true;
        p.confirmations += 1;
        emit Confirmed(id, msg.sender, p.confirmations);
        if (p.confirmations >= threshold) {
            p.executed = true;
            (bool ok, ) = p.to.call(p.data);
            emit Executed(id, ok);
            if (!ok) revert CallFailed();
        }
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }
}
