# ADR-006 — Units per lot, the receipt's decimals, the lot size and the cap

**Status:** Proposed, 12 September 2026. Not decided. Awaits the contract engineer and a reviewer (blueprint R05). **Nothing here is production configuration.** The figures the simulation uses (10 and 20 units per lot, a cap of 1,000 lots) are illustrative and are labelled so wherever they appear; the method below is what is proposed, and its inputs are not yet known.

## Context

A lot is the unit of a position: a fixed number of base units of A and of B. Choosing those numbers decides how a holder's rights can be computed with no oracle (§7), how large the smallest position is, how much of a small wrapper's supply one lot would be, and how much the series may owe in total.

## Decision (proposed method)

1. **Integer base units, fixed at construction.** `qA` and `qB` are positive integers of each component's own base units. Both candidate tokens have been read with 18 decimals; B's published address is `0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c`, recorded in `contracts/evidence/apple-s1.fork.json`. Re-read both identities and decimals at the chosen configuration block. Quantities are immutable ([ADR-001](ADR-001-immutable-series.md)).
2. **The receipt has 0 decimals.** One receipt is one whole lot. Fractional lots do not exist, so no rounding exists in mint, exit or claims: every claim is `lots × q`, exactly.
3. **Lot size is chosen so that one lot is economically small and unit-round.** Proposed: choose `qA` and `qB` so that one lot corresponds to a comparable economic exposure to the company through each component at the time the series is made, rounded to whole units of each token where the token's unit is a share-equivalent, and to a round number of base units otherwise. Because the two components' units are not equal (A's wrapper share and B's total-return unit each drift from one share over time), **a lot is not one share and not one dollar**, and the ratio between `qA` and `qB` is fixed for the life of the series even as the two components' values diverge. This is the "no rebalancing" rule seen from the lot's side.
4. **The cap counts liability, reserved included.** For each component, `(outstanding lots × q) + reserved units` must remain at or below `capLots × q`; allocating an exit does not release that component's reserved capacity. Choose a pilot cap from demonstrated eligible acquisition/issuance capacity and operational/economic limits. At Ethereum block 25,967,875 the current A wrapper held about 10.16 raw tokens and had about 10.13 shares outstanding: ten wrapper shares would use almost all the existing inventory. This is a dated inventory observation, not proof of a fixed issuance ceiling. Current-wrapper deposit/mint access and limits still need evidence; no cap is approved here.
5. **Decimals of the components are read, not assumed.** The verification reads `decimals()` daily; a change is a DARK drift and a reason to stop mints.

## Consequences

- A holder's rights are computable from `lots`, `qA`, `qB` alone; the site's previews and the ledger model do exactly that.
- Small holders may be excluded by the lot size; that is a product decision to be tested in interviews (R04), not something the contract can soften without fractional lots.
- If sufficient eligible supply cannot be acquired or newly wrapped at an acceptable cost, hold the pilot or change the candidate. Existing wrapper size alone does not establish that outcome.

## What exists today

The contract takes `qA`, `qB`, `capLots` as constructor arguments, refuses zero and overflow, counts reserved liability against the cap (T05); the receipt has 0 decimals; the ledger model and simulation use illustrative values; the fork evidence records the wrapper's size.

## Open

- The actual `qA`, `qB` and cap for a pilot — inputs missing: eligible acquisition/current-wrapper issuance access and capacity, both components' unit economics on a chosen date, and the interview results. B's address and the candidates' 18 decimals have been read; freshness and suitability still require review.
- Whether the cap should be lowered by the operator during a pilot (today: immutable; lowering would need a new series or a mint pause).
