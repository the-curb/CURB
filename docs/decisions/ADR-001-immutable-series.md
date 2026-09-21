# ADR-001 — A series is immutable

**Status:** Proposed, 12 September 2026. Not decided. Awaits the engineering lead and an independent reviewer (blueprint R06). The prototype in `contracts/` already behaves this way; the question is whether it should.

## Context

Swapping a component, changing units per lot or upgrading the code would change a holding without the holder's act. The blueprint (§1, §11) proposes none of these.

## Decision

Fixed at construction: A's and B's addresses, units per lot (`qA`, `qB`), the cap in lots. No setter, no proxy, no admin path that moves backing. A component change means a new series; holders choose whether to migrate. A critical bug means stops under [ADR-004](ADR-004-per-component-stops.md) and a reviewed plan, not an upgrade.

## Consequences

- No patch in place: stops are the only lever, and the plan may be full exit and retirement.
- A new wrapper, corrected address or new issuer terms means a new series; the old one pays claims until empty.
- Shared failures remain: the chain, the operator's keys, the components' own upgradeability (the candidates are EIP-1967 proxies; see the series page), the issuers' actions.

## What exists today

`contracts/src/CompanySeries.sol`: `componentA`, `componentB`, `qA`, `qB`, `capLots` immutable, no upgrade path. `contracts/test/CompanySeries.t.sol` T01: the constructor refuses a zero address, equal components, non-positive units, an overflowing cap. Unaudited, unreviewed, undeployed.

**13 September mainnet preparation:** local source rotates the operator in two steps. `transferOperator(next)` records a nominee; the current operator keeps authority and may replace or cancel it; only the nominee can execute `acceptOperator()`. This addresses the self-review's immediate-loss-by-typo finding and leaves backing, components, quantities, receipt transferability and pause quorum unchanged. Not independently reviewed or publicly deployed.

## Open

- Should a time-boxed "sunset" (mints stopped for good, exit window announced) be a named state, not an operator convention?
- Independent review and signoff of two-step rotation (cancellation, replacing a nomination, Safe-to-Safe acceptance); decide if it is the selected pilot's policy before recording a public build.
