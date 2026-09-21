# A self-review of the series contract — not an independent review

**Status:** Filed 12 September 2026 by the author of the code, against commit `1d6b3f7` of `contracts/src/CompanySeries.sol`. **This is not an independent review.** It does not satisfy C09, and the site does not say *reviewed* because of it.

**13 September mainnet preparation addendum:** local source has since added two-step operator nomination/acceptance/cancellation, and the public series deployment tool checks a reviewed Safe expectation on the target chain. The tables keep the earlier source scope, and those findings do not cover the changed source, which needs a new pinned release and independent review. Scope, open findings and acceptance fields: [the mainnet dossier](../mainnet/PREPARATION.md#independent-review-brief).

## Method

Line-by-line reading against the blueprint's cases; unit tests, fuzz sequence and invariant handler (256 sequences, depth 64, recorded seed); fork tests on both real components; each item below checked by hand.

## Checklist and findings

| Area | Looked at | Finding |
| --- | --- | --- |
| Reentrancy | `nonReentrant` `mint`, `claimComponent`; `allocateExit` calls nothing external; claim effects first | Held (T09); the invariant handler never paid a claim twice. |
| Checks-effects-interactions | Token calls after state changes; receipt after both pulls and delta checks | Held. |
| Return values of tokens | `_pull`/`_push` accept true or no data only | Held for standard and no-return tokens; non-32-byte data makes `abi.decode` revert (fails closed). |
| Balance deltas | Exactly `lots × q` in (`mint`), exactly the claim out (`claimComponent`) | Held; fee-on-transfer components unusable (T10) and unpayable (T22/T23 logic), deliberately. |
| Whole-liability check | Pays only if `held ≥ liability`; a mint leaving the series short reverts | Held (T08, T23; invariant `ShortfallHaltsPayment`). |
| Cap | `capLots` bounds `n × q + reserved` per component | Held (T22; invariant `CapCountsReserved`). |
| Immutables and construction | Immutable components, units, cap; zero address, equal components, non-contract, zero units, zero cap, `cap × q` overflow refused | Held (T01, T19). |
| Access control | `onlyOperator`: stops, permits, `transferOperator`, `cancelOperatorTransfer`; `acceptOperator`: the nominated `pendingOperator` only (a new surface since 13 September 2026); no admin mint, unallocated burn or sweep | Held (T24; the invariant handler's `transferReceipt` never succeeds). |
| Receipt transfer | `transfer`, `transferFrom`, `approve` always revert | Held (T17). |
| Permits | On-chain mint (unexpired) and claim permits; no backend signature | Held (T25). |
| Pauses | Mint and per-component claim pauses independent; A's leaves B | Held (T04, T20, operator-limit tests, the drill). |
| Arithmetic | 18 decimals, `uint256`, `lots × q` bounded by the constructor's overflow check | Held (T12). |
| Events | Every state change emits; indexer checked against the ABI fixture | Held. |
| Time | Preview `deadline` vs `block.timestamp`; validators shift seconds | Acceptable for a fifteen-minute preview; noted. |
| Low-level calls to a component with no code | A codeless `call` succeeds with no data | Covered: the constructor refuses non-contracts; the delta check catches a no-op or a later self-destruct, and every operation then reverts, correctly. |
| `transferOperator` | Historical source: one step, no acceptance | **Finding in the reviewed source:** a typo immediately hands away authority. **Local remediation prepared 13 September:** nomination (authority kept), nominee-only acceptance, cancellation; see ADR-001. Independent verification and release signoff remain open. |
| Reason strings | On-chain stop reason, length unenforced | The operator tool refuses under eight characters, the contract does not; acceptable. |
| Front-running | Exit and claim act only on the caller's rights; a raced mint cap check fails cleanly | No holder can act on another's rights. |
| Gas griefing | A gas-exhausting component transfer | Fails closed; the claim stays whole (drill: frozen A). |

## The credit desk, walked the same way

`contracts/src/CreditDesk.sol` (fifteen tests in `test/CreditDesk.t.sol`), 12 September 2026: forty lines, one job.

| Area | Looked at | Finding |
| --- | --- | --- |
| Surface | `topUp` only; two immutables; no owner, pause, upgrade or receive | Held. |
| Reentrancy | One `transferFrom`, a view call, then the event; no stored balance or mapping | Held; re-entry can only pay again. |
| Return values | False, revert or malformed data: `TransferFailed` | Held (returns-false, halted, no-allowance tests). |
| Balance delta | Treasury rises by exactly `amount`, else `DeltaWrong` | Held (fee-on-transfer test); the site credits from the event, so an underpaying token is unusable. |
| Zero cases | `amount == 0`, `keyHash == 0`; zero addresses and a non-contract token at construction | Refused; held. |
| Who pays whom | `msg.sender` pays an immutable treasury; anyone may top up any hash | Held; a top-up to an unheld hash is the payer's recorded loss. |
| Front-running | Credit goes to the payer's chosen hash | None. |
| Site side | Event-priced at the block's rate; reorgs uncredit; idempotent index; two rows per key, one writer each | Held (`tests/credits.test.ts`, local rehearsal). **Closed 13 September 2026:** a spend-row race lost one of two concurrent charges. Now written conditionally on the version read (`writeSnapshotIf`); the loser re-reads and is refused, with figures, if too little is left; a write whose reply was lost is found by its token, not repeated (`tests/credits.test.ts`, `tests/store-conformance.ts`). |
| The treasury's key | Multisig by policy; a codeless treasury refused on a public chain | Held; an EOA treasury only on chain 31337. |

## Static analysis, run and read (13 September 2026)

Slither 0.11 on both contracts, compiled as built (solc 0.8.30, via-IR, optimizer 200, prague), on every source push (`.github/workflows/static-analysis.yml`, advisory; reports kept per run). Fifteen findings; none changes the source. The readings are the author's; a reviewer may differ.

| Detector | Where | Reading |
| --- | --- | --- |
| `reentrancy-balance` (high, medium confidence) | `CreditDesk.topUp`; `CompanySeries.mint`, `claimComponent` | The delta check is intended. Series: `nonReentrant`, ledger written after checks. Desk: no guard or state; a reentering `transferFrom` fails the outer delta check, so everything reverts and nothing is emitted. A guard would cost a slot and change the recorded bytecode; not added. Launch condition: a plain ERC-20 token that calls nobody. |
| `reentrancy-no-eth`, `reentrancy-benign` (medium, low) | `CompanySeries.mint` | `nonReentrant`; `totalSupply`, `balanceOf` written after the delta checks. |
| `reentrancy-events` (low) | `CreditDesk.topUp` | Event after the call on purpose: a failed transfer records no top-up. |
| `timestamp` (low) | `CompanySeries.mint` | Deadlines and permit expiries span minutes to days; seconds of sequencer drift change nothing. |
| `low-level-calls` (informational) | `_pull`, `_push`, `topUp` | Deliberate: handles tokens returning nothing or `false`, without a library. |
| `cyclomatic-complexity` (informational) | `claimComponent` | Each component's path spelled out; a chosen style. |

## What this review did not do

- It did not read the components' code (issuer proxies); fork tests read behaviour, not source.
- No economic attacks across series: one series, no factory.
- Static analysis ran only after the fact.
- It was done by the person who wrote the code. It is not an independent review.
