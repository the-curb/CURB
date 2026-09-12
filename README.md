# THE CURB

**One company. Multiple issuers. One position.**

Live at **https://the-curb.vercel.app** · [![tick](https://github.com/the-curb/CURB/actions/workflows/tick.yml/badge.svg)](https://github.com/the-curb/CURB/actions/workflows/tick.yml)

A stock-token holder chooses a company and, in the same act, a particular way
of getting exposure to it: an issuer, a contract, a set of terms and an exit.
THE CURB is being built as the place where that second choice is made in the
open — one position on one company, formed from several issuers, with the
composition inspectable, the right to every component recorded, and every
component withdrawn on its own.

**Stage: building.** The product is a design under test. No Curb series
contract, issuer integration, transaction or deployment exists yet. What
exists is the mechanism ([MECHANISM.md](MECHANISM.md), rendered at `/mechanism`),
the ledger model that implements its accounting (`lib/positions/`, tested
against the blueprint's cases in `tests/positions.test.ts`), a simulation
of it at `/positions/apple-s1` — illustrative units, no prices, no chain —
the product's backend (an evidence archive of the issuers' records, daily
on-chain verification of every address they name, an event index and a
reconciliation for a series once one is deployed, a product API), a contract
prototype with fork evidence against the real component on Ethereum, a
rehearsal and an operational drill on a local chain, and the decision records
the blueprint asks for (`docs/decisions/`, rendered at `/mechanism/decisions`)
— all proposed, none decided.

Beneath the product is the desk: a multi-agent intelligence desk for stock
tokens on Robinhood Chain (chain id 4663). Nine agents read the chain and two
published registries on a schedule, publish what they measured with a source
and a time on every figure, and refuse — in code, not in a prompt — to
forecast, advise, rate, or print a number they did not read. A daily paper,
*The Curb Gazette*, is composed from the record. The desk is the evidence
layer a position would stand on; for a new chain it needs new sources and new
tests, and says so.

Before the American Stock Exchange had a building it was the Curb Market:
claims traded outside the official floor. A stock token is the same thing
again. "Curb" is also a limit, which is the other half of the job.

## What the desk watches

| District     | Agents                              | What is measured                                                                                                   |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| THE FLOOR    | The Bell, Pillar, The Surveyor      | The exchange session; every tokenized-equity feed with two ages kept apart; the issuer's pause flag; market structure on request |
| THE REGISTRY | The Registrar, The Archivist        | Every stock token the issuer lists, the one beacon they all delegate to, shares-per-token multipliers and staged changes |
| THE VAULT    | The Tally                           | Transfer flow as an hourly rate sample — never a total the node cannot answer                                      |
| CHAMBERS     | Counsel, The Warden                 | The published terms, pointed at and watched for change; the three numbers the system cannot fake                   |
| THE PRESS    | —                                   | The Gazette: composed from the record, its lede narrated by a model under the same policy gate as every agent       |
| THE CAGE     | The Herald                          | The declared promoter, kept apart, with its disclosure appended by code                                             |

Every reading is one of three states — verified, stale, or unread with a reason
— and an unread reading renders as an absence, never as zero. The rules are in
[DOCTRINE.md](DOCTRINE.md); each names the file that enforces it.

## Run it

```bash
npm install
cp .env.local.example .env.local   # then read the comments in it
npm run dev                         # http://localhost:3000
```

Without a database URL the filesystem store is used, and says so in its own
return values. With `CURB_POSTGRES_URL` set, `npm run db:migrate` applies the
schema and `npm run verify:store` proves the store contract against it.

```bash
npm test                # unit tests, no network
npm run verify:store    # the store contract, against the filesystem and Postgres
node --env-file-if-exists=.env.local scripts/preview.ts pillar   # rehearse one agent, writing nothing
```

The scheduler is `POST /api/tick` every five minutes from outside the host;
[DEPLOY.md](DEPLOY.md) is the runbook — store, app, scheduler, alerting,
retention, the registries and how to re-capture them, and what is deliberately
not covered.

## The contract prototype

`contracts/` is a separate workspace: the series contract the mechanism
proposes (`src/CompanySeries.sol`), the mocks that misbehave on demand, and
the blueprint's test cases as Solidity tests with a fuzz run. Unaudited,
unreviewed, undeployed — the site reports NOT_DEPLOYED until a reviewed
deployment record is configured.

```bash
cd contracts && npm install && npm run build && npm test
```

## What it will not do

The position product makes three testable promises — a holder can know and
prove the composition of their position; the ledger never erases a right to a
component that cannot yet be transferred; mint and exit need no decision by a
model — and refuses eight claims: capital protected, cannot be frozen, the
same as holding the share, automatically safer, always sellable at the
reference value, earns more, fully independent issuers, first of its kind.

The desk places no orders, holds no token, sells nothing, and states no price
for a token no feed prices. It does not say a token is backed, safe, or a
scam, in either direction. When it could not look, it says it could not look.

## License

MIT — see [LICENSE](LICENSE). The doctrine is the part worth copying.
