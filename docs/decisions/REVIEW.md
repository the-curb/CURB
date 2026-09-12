# A self-review of the series contract — not an independent review

**Status:** Filed 12 September 2026 by the author of the code, against commit `1d6b3f7` of `contracts/src/CompanySeries.sol`. This is what an author can do before a reviewer arrives: walk the checklist a reviewer would walk, say what was looked at and what was found, and leave the findings where they can be checked. It does not satisfy C09, and the site does not say *reviewed* because of it.

## Method

Read the contract and its tests line by line against the blueprint's cases; run the unit tests, the fuzz sequence and the invariant handler (256 sequences, depth 64) with the recorded seed; run the fork tests against both real components; check each item below by hand.

## Checklist and findings

| Area | Looked at | Finding |
| --- | --- | --- |
| Reentrancy | `mint` and `claimComponent` are `nonReentrant`; `allocateExit` makes no external call; claims set effects (claim to zero, reserve reduced) before the token is called | Held. The mock's reentrant callback is refused (T09); the invariant handler could not pay a claim twice. |
| Checks-effects-interactions | Every external token call comes after state changes in `claimComponent`; in `mint` the receipt is issued after both pulls and both delta checks | Held. |
| Return values of tokens | `_pull`/`_push` accept a true, or no data, and refuse a false or a revert | Held for standard and no-return tokens. A token returning data that is not a 32-byte word makes `abi.decode` revert — the call still fails closed. |
| Balance deltas | `mint` checks each component's balance rose by exactly `lots × q`; `claimComponent` checks it fell by exactly the claim | Held. A fee-on-transfer component cannot be used (T10) and cannot be paid from (T22/T23 logic), which is deliberate: a fee would come out of other holders' backing. |
| Whole-liability check | A claim pays only if `held ≥ liability` for that component; a mint reverts if the series would be short after the deposit | Held (T08, T23; invariant `ShortfallHaltsPayment`). |
| Cap | `capLots` bounds `n × q + reserved` per component | Held (T22; invariant `CapCountsReserved`). |
| Immutables and construction | Components, units, cap immutable; zero address, equal components, non-contract, zero units, zero cap and `cap × q` overflow refused | Held (T01, T19). |
| Access control | `onlyOperator` on stops, permits and `transferOperator`; no admin mint, no burn without allocation, no sweep | Held (T24; the invariant handler's `transferReceipt` never succeeds). |
| Receipt transfer | `transfer`, `transferFrom`, `approve` revert unconditionally | Held (T17). |
| Permits | Mint needs an unexpired permit; claim needs a claim permit; both are on-chain state, no backend signature | Held (T25). |
| Pauses | Mint pause and per-component claim pause are separate; a pause of A does not touch B | Held (T04, T20, operator-limit tests, the drill). |
| Arithmetic | 18-decimal components, `uint256` throughout, `lots × q` bounded by the constructor's overflow check | Held (T12). |
| Events | Every state change emits; the site's indexer decodes exactly these signatures, checked against the ABI fixture | Held. |
| Time | `deadline` compared to `block.timestamp` for a mint preview; a validator can move it by seconds | Acceptable for a fifteen-minute preview; noted. |
| Low-level calls to a component with no code | `call` to an address without code returns success with no data | Covered twice: the constructor refuses a non-contract, and every transfer is followed by a balance-delta check that a no-op cannot pass. A component that self-destructs after construction would fail the delta check on the next mint or claim — every operation would then revert, which is the right failure. |
| `transferOperator` | One step, no acceptance by the new operator | **Finding, open:** a typo hands the role to nobody; the series would keep paying claims under existing permits and could neither pause nor grant — the designed failure mode, but avoidable with a two-step transfer. Recorded in [ADR-001](ADR-001-immutable-series.md) as open. |
| Reason strings | Stops carry a reason on chain; nothing enforces its length | The operator tool refuses a reason under eight characters; the contract does not. Acceptable: the reason is for people. |
| Front-running | `allocateExit` and `claimComponent` act only on the caller's own receipts and claims; a mint's cap check can be raced by another mint, which then fails cleanly | No holder can act on another's rights. |
| Gas griefing | A component's transfer that consumes all gas makes the call fail closed | The claim stays whole; the drill's frozen-A scenario shows the shape. |

## What this review did not do

- It did not read the components' code (the issuers' contracts are proxies whose implementations are theirs); the fork tests read their behaviour, not their source.
- It did not look for economic attacks across series, because there is one series and no factory.
- It did not use a static analyser; none is set up in this repository, and adding one is a reasonable first ask of a reviewer.
- It was done by the person who wrote the code.
