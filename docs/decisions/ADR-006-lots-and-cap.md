# ADR-006 — Units per lot, the receipt's decimals, the lot size and the cap

**Status:** Proposed, 12 September 2026. Not decided. Awaits the contract engineer and a reviewer (blueprint R05). **Nothing here is production configuration.** The simulation's 10 and 20 units per lot and cap of 1,000 lots are illustrative and labelled so. The method is proposed; its inputs are not yet known.

## Context

A lot is a fixed number of base units of A and of B. It sets how rights are computed without an oracle (§7), the smallest position, one lot's share of a small wrapper, and total liability.

## Decision (proposed method)

1. **Integer base units, fixed at construction**: `qA`, `qB` are positive integers of each component's base units, immutable ([ADR-001](ADR-001-immutable-series.md)). Both candidates read with 18 decimals; B's published address `0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c` is in `contracts/evidence/apple-s1.fork.json`. Re-read identities and decimals at the chosen configuration block.
2. **The receipt has 0 decimals**: one receipt is one whole lot, so nothing rounds; every claim is exactly `lots × q`.
3. **One lot is economically small and unit-round**: comparable company exposure through each component when the series is made, rounded to whole units where a unit is a share-equivalent, else to round base units. A's wrapper share and B's total-return unit both drift from one share, so **a lot is not one share and not one dollar**, and the `qA`:`qB` ratio stays fixed as values diverge ("no rebalancing").
4. **The cap counts liability, reserved included**: per component, `(outstanding lots × q) + reserved units` stays at or below `capLots × q`; allocating an exit does not release reserved capacity. Set a pilot cap from demonstrated eligible acquisition/issuance capacity and operational/economic limits. At Ethereum block 25,967,875 the current A wrapper held about 10.16 raw tokens, with about 10.13 shares outstanding: ten wrapper shares would use almost all of it. A dated observation, not a fixed issuance ceiling. Current-wrapper deposit/mint access and limits still need evidence. No cap is approved here.
5. **Component decimals are read, not assumed**: `decimals()` daily; a change is a DARK drift and a reason to stop mints.

## Consequences

- Rights are computable from `lots`, `qA`, `qB` alone, as the previews and ledger model do.
- The lot size may exclude small holders: a product decision for interviews (R04), not softenable without fractional lots.
- If enough eligible supply cannot be acquired or newly wrapped at acceptable cost, hold the pilot or change the candidate; wrapper size alone does not establish that.

## What exists today

The constructor takes `qA`, `qB`, `capLots`, refuses zero and overflow, and counts reserved liability against the cap (T05); the receipt has 0 decimals; the ledger model and simulation use illustrative values; the fork evidence records the wrapper's size.

## Open

- The pilot's actual `qA`, `qB` and cap. Missing: eligible acquisition/current-wrapper issuance access and capacity, both components' unit economics on a chosen date, the interview results. B's address and the 18 decimals are read; freshness and suitability need review.
- Should the operator be able to lower the cap during a pilot? (Today: immutable; lowering needs a new series or a mint pause.)
