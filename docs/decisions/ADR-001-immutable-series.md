# ADR-001 — A series is immutable

**Status:** Proposed, 12 September 2026. Not decided. Awaits the engineering lead and an independent reviewer (blueprint R06). The prototype in `contracts/` behaves as written here; the decision is whether that is the right behaviour, not whether the code does it.

## Context

A position receipt is a claim on two specific tokens from two specific issuers in fixed amounts per lot. Every way of changing that after issue — swapping a component, changing the units per lot, upgrading the contract's code — is a way of changing what a holder holds without the holder's act. The blueprint (§1, §11) proposes that none of those ways exist.

## Decision

A series contract fixes, at construction and forever: component A's address, component B's address, the units of each per lot (`qA`, `qB`) and the cap in lots. There is no function that changes any of them, no proxy in front of the contract, and no admin path that moves backing. A component that must change means a new series and the holder's own choice to migrate. A critical bug means stopping the affected operations under [ADR-004](ADR-004-per-component-stops.md) and a reviewed plan, not an upgrade.

## Consequences

- Holders can read what a receipt is from the contract's immutables and never need to watch for a change.
- A bug cannot be patched in place. The stops are the only lever, and the reviewed plan may be to let every holder exit and retire the series.
- A better wrapper, a corrected address, or a change in an issuer's terms all produce a new series; the old one keeps paying claims until it is empty.
- Nothing here removes the shared failures the blueprint names: the chain, the operator's keys, a component's own upgradeability (the candidate components are EIP-1967 proxies; see the series page), or the issuers' actions.

## What exists today

`contracts/src/CompanySeries.sol` declares `componentA`, `componentB`, `qA`, `qB` and `capLots` immutable and has no upgrade path. `contracts/test/CompanySeries.t.sol` T01 checks the constructor refuses a zero address, equal components, non-positive units and an overflowing cap. Unaudited, unreviewed, undeployed.

**13 September mainnet preparation:** operator rotation uses nomination and acceptance. `transferOperator(next)` records a pending nominee; the current operator keeps authority. Only the nominee can execute `acceptOperator()`; the current operator can replace or cancel the nomination. This addresses the self-review's immediate-loss-by-typo finding in local source. It does not change backing, components, quantities, receipt transferability or pause quorum, and it has not received independent review or been deployed publicly.

## Open

- Whether a time-boxed "sunset" — the operator stopping mints permanently and announcing an exit window — should be a named state rather than an operator convention.
- Independent review and final signoff of two-step operator rotation, including cancellation, pending nomination replacement and Safe-to-Safe acceptance. Decide whether this local implementation is the policy for the selected pilot before recording a public build.
