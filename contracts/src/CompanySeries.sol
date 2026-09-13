// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * THE CURB — CompanySeries, the prototype of one series.
 *
 * A DESIGN UNDER TEST. Unaudited. Undeployed. Its rules are the ones the
 * mechanism proposes (MECHANISM.md §7, §9.1, §11); its tests are the
 * blueprint's cases. Nothing about it is a claim that it is safe.
 *
 * One series holds exactly two distinct component tokens, A and B, and a
 * fixed number of base units of each per lot, set at construction and never
 * changed. A receipt is one whole lot (decimals 0). Receipts cannot be
 * transferred: exit is by allocation and a separate claim per component.
 *
 *   n        totalSupply — lots outstanding
 *   q[i]     base units of component i per lot
 *   A[i]     active liability            = n × q[i]
 *   R[i]     reserved for exit           = Σ claims[u][i]
 *   L[i]     total liability             = A[i] + R[i]
 *   B[i]     balance the series holds
 *
 * Invariants the tests hold the contract to:
 *   - B[i] ≥ L[i] after every mint, in units of the token (solvent in units only)
 *   - L[i] ≤ capLots × q[i], reserved included
 *   - an exit changes no L[i]; it moves units from A[i] to R[i]
 *   - claiming A never reads or calls B
 *   - supply changes only through a complete deposit or an exit allocation
 *   - nothing sweeps a surplus, mints without a deposit, or swaps a component
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address holder) external view returns (uint256);
}

contract CompanySeries {
    /* ── errors ──────────────────────────────────────────────────────────── */
    error ComponentsMustDiffer();
    error ZeroAddress();
    error NotAContract();
    error UnitsMustBePositive();
    error CapMustBePositive();
    error LotsMustBePositive();
    error PreviewExpired();
    error MintPaused();
    error MintPermitMissing();
    error CapExceeded(uint8 component);
    error DepositDeltaWrong(uint8 component);
    error BackingShort(uint8 component);
    error TransferFailed(uint8 component);
    error InsufficientReceipts();
    error UnknownComponent();
    error ClaimPermitMissing();
    error ClaimPaused(uint8 component);
    error NothingToClaim(uint8 component);
    error ShortfallHaltsPayment(uint8 component);
    error ReceiptNotTransferable();
    error NotOperator();
    error NotPendingOperator();
    error NoPendingOperator();
    error Reentrancy();

    /* ── events — as the mechanism proposes them ─────────────────────────── */
    event PositionMinted(address indexed holder, uint256 lots, uint256 unitsA, uint256 unitsB);
    event ExitAllocated(address indexed holder, uint256 lots, uint256 unitsA, uint256 unitsB);
    event ComponentClaimed(address indexed holder, uint8 component, uint256 units);
    event MintStatusChanged(bool paused, string reason);
    event ComponentClaimStatusChanged(uint8 component, bool paused, string reason);
    event MintPermitSet(address indexed holder, uint64 until);
    event ClaimPermitSet(address indexed holder, bool permitted);
    event OperatorChanged(address indexed previous, address indexed next);
    event OperatorTransferProposed(address indexed current, address indexed proposed);
    event OperatorTransferCancelled(address indexed current, address indexed cancelled);
    /// ERC-20 shape for wallets that display balances; the receipt still cannot be transferred.
    event Transfer(address indexed from, address indexed to, uint256 value);

    /* ── the composition, fixed for the life of the series ───────────────── */
    IERC20 public immutable componentA;
    IERC20 public immutable componentB;
    uint256 public immutable qA;
    uint256 public immutable qB;
    uint256 public immutable capLots;

    string public name;
    string public symbol;
    uint8 public constant decimals = 0;

    /* ── the ledger ──────────────────────────────────────────────────────── */
    uint256 public totalSupply; // n
    mapping(address => uint256) public balanceOf; // receipts
    mapping(address => uint256) public claimA; // C[u, A]
    mapping(address => uint256) public claimB; // C[u, B]
    uint256 public reservedA; // R[A]
    uint256 public reservedB; // R[B]

    /* ── the operator, and what it may touch ─────────────────────────────── */
    address public operator;
    /// A nomination grants no authority. The nominee must accept from its own address.
    address public pendingOperator;
    bool public mintPaused;
    bool public claimPausedA;
    bool public claimPausedB;
    /// Access decisions live on chain: minting needs an unexpired permit;
    /// claiming needs a recorded permit that the operator can revoke. Neither
    /// overrides anything a component's own contract refuses.
    mapping(address => uint64) public mintPermitUntil;
    mapping(address => bool) public claimPermitted;

    uint256 private _entered;

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address a,
        address b,
        uint256 unitsAPerLot,
        uint256 unitsBPerLot,
        uint256 cap,
        address operator_,
        string memory name_,
        string memory symbol_
    ) {
        if (a == address(0) || b == address(0) || operator_ == address(0)) revert ZeroAddress();
        if (a == b) revert ComponentsMustDiffer();
        if (a.code.length == 0 || b.code.length == 0) revert NotAContract();
        if (unitsAPerLot == 0 || unitsBPerLot == 0) revert UnitsMustBePositive();
        if (cap == 0) revert CapMustBePositive();
        // capLots × q[i] must be representable from deployment; checked arithmetic reverts otherwise.
        uint256 limitA = cap * unitsAPerLot;
        uint256 limitB = cap * unitsBPerLot;
        require(limitA / cap == unitsAPerLot && limitB / cap == unitsBPerLot);

        componentA = IERC20(a);
        componentB = IERC20(b);
        qA = unitsAPerLot;
        qB = unitsBPerLot;
        capLots = cap;
        operator = operator_;
        name = name_;
        symbol = symbol_;
    }

    /* ── views ───────────────────────────────────────────────────────────── */

    function liabilityA() public view returns (uint256) {
        return totalSupply * qA + reservedA;
    }

    function liabilityB() public view returns (uint256) {
        return totalSupply * qB + reservedB;
    }

    /* ── mint: both arrive, or neither does ──────────────────────────────── */

    /**
     * Deposit exactly `lots × q[i]` of each component and receive `lots`
     * receipts. The deposits are checked by balance delta — a token that
     * takes a fee, returns false, or does not move fails the whole mint —
     * and the backing is checked against the whole liability afterwards,
     * so an exact deposit cannot quietly cover an older shortfall. The cap
     * counts reserved units, so burning and re-minting cannot hide them.
     */
    function mint(uint256 lots, uint256 deadline) external nonReentrant {
        if (lots == 0) revert LotsMustBePositive();
        if (block.timestamp > deadline) revert PreviewExpired();
        if (mintPaused) revert MintPaused();
        if (mintPermitUntil[msg.sender] < block.timestamp) revert MintPermitMissing();

        uint256 newSupply = totalSupply + lots;
        if (newSupply * qA + reservedA > capLots * qA) revert CapExceeded(0);
        if (newSupply * qB + reservedB > capLots * qB) revert CapExceeded(1);

        uint256 needA = lots * qA;
        uint256 needB = lots * qB;
        uint256 beforeA = componentA.balanceOf(address(this));
        uint256 beforeB = componentB.balanceOf(address(this));

        _pull(componentA, needA, 0);
        _pull(componentB, needB, 1);

        uint256 afterA = componentA.balanceOf(address(this));
        uint256 afterB = componentB.balanceOf(address(this));
        if (afterA != beforeA + needA) revert DepositDeltaWrong(0);
        if (afterB != beforeB + needB) revert DepositDeltaWrong(1);
        if (afterA < newSupply * qA + reservedA) revert BackingShort(0);
        if (afterB < newSupply * qB + reservedB) revert BackingShort(1);

        totalSupply = newSupply;
        balanceOf[msg.sender] += lots;
        emit Transfer(address(0), msg.sender, lots);
        emit PositionMinted(msg.sender, lots, needA, needB);
    }

    /* ── exit: a change to the ledger, and only that ─────────────────────── */

    /**
     * Burn `lots` receipts and record the holder's right to `lots × q[i]` of
     * every component as a claim. No external call, no oracle, no model. The
     * total liability of each component is the same before and after.
     */
    function allocateExit(uint256 lots) external {
        if (lots == 0) revert LotsMustBePositive();
        uint256 held = balanceOf[msg.sender];
        if (held < lots) revert InsufficientReceipts();

        uint256 unitsA = lots * qA;
        uint256 unitsB = lots * qB;
        balanceOf[msg.sender] = held - lots;
        totalSupply -= lots;
        claimA[msg.sender] += unitsA;
        claimB[msg.sender] += unitsB;
        reservedA += unitsA;
        reservedB += unitsB;
        emit Transfer(msg.sender, address(0), lots);
        emit ExitAllocated(msg.sender, lots, unitsA, unitsB);
    }

    /* ── claim: one component, to the claimant, never reading the other ──── */

    /**
     * Pay the caller's whole claim on one component. Component 0 is A,
     * component 1 is B. Claiming A reads only A: its pause flag, its claim,
     * its balance, its liability. If the series holds less of the component
     * than it owes in total, nobody is paid from it — the fastest claimant
     * does not take the remainder before the shortfall is acknowledged. The
     * claim is cleared before the transfer; a transfer that fails or moves
     * the wrong amount reverts the whole call, so the claim stays whole.
     */
    function claimComponent(uint8 component) external nonReentrant {
        if (component > 1) revert UnknownComponent();
        if (!claimPermitted[msg.sender]) revert ClaimPermitMissing();

        if (component == 0) {
            if (claimPausedA) revert ClaimPaused(0);
            uint256 owed = claimA[msg.sender];
            if (owed == 0) revert NothingToClaim(0);
            uint256 held = componentA.balanceOf(address(this));
            if (held < liabilityA()) revert ShortfallHaltsPayment(0);
            claimA[msg.sender] = 0;
            reservedA -= owed;
            _push(componentA, msg.sender, owed, 0);
            if (componentA.balanceOf(address(this)) != held - owed) revert TransferFailed(0);
            emit ComponentClaimed(msg.sender, 0, owed);
        } else {
            if (claimPausedB) revert ClaimPaused(1);
            uint256 owed = claimB[msg.sender];
            if (owed == 0) revert NothingToClaim(1);
            uint256 held = componentB.balanceOf(address(this));
            if (held < liabilityB()) revert ShortfallHaltsPayment(1);
            claimB[msg.sender] = 0;
            reservedB -= owed;
            _push(componentB, msg.sender, owed, 1);
            if (componentB.balanceOf(address(this)) != held - owed) revert TransferFailed(1);
            emit ComponentClaimed(msg.sender, 1, owed);
        }
    }

    /* ── the receipt cannot be transferred ───────────────────────────────── */

    function transfer(address, uint256) external pure returns (bool) {
        revert ReceiptNotTransferable();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert ReceiptNotTransferable();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert ReceiptNotTransferable();
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    /* ── the operator: stops and permits, never principal ────────────────── */

    function setMintPaused(bool paused, string calldata reason) external onlyOperator {
        mintPaused = paused;
        emit MintStatusChanged(paused, reason);
    }

    function setClaimPaused(uint8 component, bool paused, string calldata reason) external onlyOperator {
        if (component > 1) revert UnknownComponent();
        if (component == 0) claimPausedA = paused;
        else claimPausedB = paused;
        emit ComponentClaimStatusChanged(component, paused, reason);
    }

    function setMintPermit(address holder, uint64 until) external onlyOperator {
        mintPermitUntil[holder] = until;
        emit MintPermitSet(holder, until);
    }

    function setClaimPermit(address holder, bool permitted) external onlyOperator {
        claimPermitted[holder] = permitted;
        emit ClaimPermitSet(holder, permitted);
    }

    /// Nominate or replace a successor; the current operator retains every power until acceptance.
    function transferOperator(address next) external onlyOperator {
        if (next == address(0)) revert ZeroAddress();
        pendingOperator = next;
        emit OperatorTransferProposed(operator, next);
    }

    function cancelOperatorTransfer() external onlyOperator {
        address cancelled = pendingOperator;
        if (cancelled == address(0)) revert NoPendingOperator();
        pendingOperator = address(0);
        emit OperatorTransferCancelled(operator, cancelled);
    }

    /// For a Safe nominee, acceptance must be executed by that Safe's quorum.
    function acceptOperator() external {
        if (msg.sender != pendingOperator || pendingOperator == address(0)) revert NotPendingOperator();
        address previous = operator;
        operator = msg.sender;
        pendingOperator = address(0);
        emit OperatorChanged(previous, msg.sender);
    }

    /* ── token calls, with their answers checked ─────────────────────────── */

    function _pull(IERC20 token, uint256 amount, uint8 component) private {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed(component);
    }

    function _push(IERC20 token, address to, uint256 amount, uint8 component) private {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed(component);
    }
}
