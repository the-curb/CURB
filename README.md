<p align="center">
  <a href="https://the-curb-production.up.railway.app"><img src="docs/images/front.png" alt="THE CURB — the front page: one company, two issuers, one position" width="100%"></a>
</p>

<h1 align="center">THE CURB</h1>

<p align="center"><b>Every price with its age. Every issuer with its terms.</b></p>

<p align="center">
  <a href="https://the-curb-production.up.railway.app">Live</a> ·
  <a href="https://the-curb-production.up.railway.app/guide">How to use it</a> ·
  <a href="https://x.com/thecurb_xyz">X · @thecurb_xyz</a> ·
  <a href="MECHANISM.md">The mechanism</a> ·
  <a href="DOCTRINE.md">The doctrine</a> ·
  <a href="docs/decisions/TOKEN.md">The token record</a> ·
  <a href="DEPLOY.md">Deploy</a>
</p>

<p align="center">
  <a href="https://github.com/the-curb/CURB/actions/workflows/checks.yml"><img src="https://github.com/the-curb/CURB/actions/workflows/checks.yml/badge.svg" alt="checks"></a>
  <a href="https://github.com/the-curb/CURB/actions/workflows/tick.yml"><img src="https://github.com/the-curb/CURB/actions/workflows/tick.yml/badge.svg" alt="tick"></a>
  <a href="https://github.com/the-curb/CURB/actions/workflows/watch.yml"><img src="https://github.com/the-curb/CURB/actions/workflows/watch.yml/badge.svg" alt="watch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2b2b2b" alt="MIT"></a>
</p>

THE CURB is a data desk for stock tokens on Robinhood Chain (4663). Ten agents
read the chain, its pools and the issuers' registries on a schedule. Every
figure has a source and a time, every price both its ages and its gap to the
on-chain trade; where they could not look, the absence shows. Pages and JSON.

It offers one thing: **alerts**, with no credit, wallet or top-up. A key (only a
name) names a webhook and its tokens, and is told once when raised and once when
cleared: multiplier changes staged or effective, pause flags set, prices past
heartbeat in session, pools drifting past the published band from their feed or
thinning, beacon moves, terms changes. Decided 20 September 2026; enforced in
lib/credits/access.ts, which the guard, the routes and every page read.

Beneath the desk: **one company, multiple issuers, one position**, its
composition inspectable, each component's right recorded and withdrawable on its
own. A prototype today.

Named for the Curb Market, where claims traded off the official floor before
the American Stock Exchange had a building.

## Where it stands

**Mainnet — Robinhood Chain (4663).** The operator's treasury, a 2-of-3 Safe, is
live since 13 September 2026
([`contracts/evidence/safes/safe.4663.json`](contracts/evidence/safes/safe.4663.json)).
`/services` says `NOT_CONFIGURED` until the token and credit desk are configured
from the chain. Nothing is sold yet.

The position product is a prototype: `CompanySeries` has run on local chains
and Ethereum forks, including a corporate action across a recorded block. No
public series deployment or issuer integration is approved; the Robinhood
treasury is not an Ethereum series operator.

| What exists | Where |
| --- | --- |
| The mechanism (blueprint) | [MECHANISM.md](MECHANISM.md), rendered at [`/mechanism`](https://the-curb-production.up.railway.app/mechanism) |
| Ledger model | `lib/positions/`, tested against the blueprint's cases in `tests/positions.test.ts` |
| One simulated position: illustrative units, no prices, no chain | [`/positions/apple-s1`](https://the-curb-production.up.railway.app/positions/apple-s1) |
| Backend: issuer-record archive, daily on-chain checks of every address they name, event index and reconciliation once a series is deployed, API | `lib/positions/`, `app/api/positions` |
| Contract prototype: Ethereum fork evidence against both real components, local rehearsal and drill | [`contracts/`](contracts/) |
| Decision records: series ADRs and most operations policy proposed; treasury signers and token decided | [`docs/decisions/`](docs/decisions/), rendered at [`/mechanism/decisions`](https://the-curb-production.up.railway.app/mechanism/decisions) |
| Token's one function (product owner's decision): prepaid desk credit in dollars, paid in CURB at a pool rate read at a block | [TOKEN.md](docs/decisions/TOKEN.md), [`/services`](https://the-curb-production.up.railway.app/services) |
| Mainnet dossier: preparation, external facts, venue terms from primary sources, execution decisions | [`docs/mainnet/`](docs/mainnet/) |

`npm run mainnet:preflight` lists evidence still missing for a token launch, a
paid beta and the position pilot. It stays HELD until real reviews and
deployment evidence are recorded, and authorizes nothing.

## The desk

<p align="center">
  <a href="https://the-curb-production.up.railway.app/floor"><img src="docs/images/floor.png" alt="The Floor — every price with its age" width="49%"></a>
  <a href="https://the-curb-production.up.railway.app/gazette"><img src="docs/images/gazette.png" alt="The Curb Gazette — one day's record, set as a paper" width="49%"></a>
</p>

A code policy gate stops forecast, advice, rating language and undeclared
figures, and prints what it stops. Pattern and provenance checks do not prove a
sentence semantically true. A new chain needs new sources and tests, and the
desk says so.

| District | Agents | What is measured |
| --- | --- | --- |
| THE FLOOR | The Bell, Pillar, The Surveyor | Session; each tokenized-equity feed, two ages apart; pause flag; market structure on request |
| THE REGISTRY | The Registrar, The Archivist | Listed stock tokens, their one beacon, shares-per-token multipliers, staged changes |
| THE VAULT | The Tally | Transfer flow as an hourly rate sample, never a total the node cannot answer |
| CHAMBERS | Counsel, The Warden | Published terms, watched; the three numbers the system cannot fake |
| THE PRESS | — | The Gazette, from the record; lede narrated by a model under the same policy gate |
| THE CAGE | The Herald | The declared promoter, apart; disclosure appended by code |

Readings are verified, stale, or unread with a reason; unread renders as an
absence, never zero. Rules: [DOCTRINE.md](DOCTRINE.md).

## Run it

```bash
npm install
cp .env.local.example .env.local   # then read the comments in it
npm run dev                         # http://localhost:3000
```

Without a database URL the filesystem store is used, and says so. With
`CURB_POSTGRES_URL` set, `npm run db:migrate` applies the schema and
`npm run verify:store` proves the store contract.

```bash
npm test                # unit tests, no network
npm run verify:store    # the store contract, against the filesystem and Postgres
node --env-file-if-exists=.env.local scripts/preview.ts pillar   # rehearse one agent, writing nothing
```

`POST /api/tick` runs every five minutes from outside the host (GitHub's cron,
best-effort: runs land ten to twenty minutes apart). Runbook, and what it does
not cover: [DEPLOY.md](DEPLOY.md). Runs on Railway with Postgres; deploys from
`main`.

## The contract prototype

`contracts/` is a separate workspace: the proposed series contract
(`src/CompanySeries.sol`), the decided credit desk (`src/CreditDesk.sol`: a
top-up to a published treasury plus an event, nothing held, no admin),
misbehaving mocks, and the blueprint's cases as Solidity tests with fuzz and
invariant runs. Unaudited, unreviewed, undeployed: the site shows NOT_DEPLOYED
until a reviewed deployment record is configured, and NOT_CONFIGURED for the
credit desk while no token exists. Operator tools for the decided launch venue
(`contracts/scripts/`) refuse to send until every check passes.

```bash
cd contracts && npm install && npm run build && npm test
```

## What it will not do

The position product makes three testable promises: a holder can know and prove
their composition; the ledger never erases a right to a component not yet
transferable; mint and exit need no model decision. It refuses eight claims:
capital protected, cannot be frozen, the same as holding the share,
automatically safer, always sellable at the reference value, earns more, fully
independent issuers, first of its kind.

The desk places no orders, holds no token, sells nothing, prices no token no
feed prices, and never calls a token backed, safe or a scam, either way. When it
could not look, it says so.

## License

MIT — see [LICENSE](LICENSE). The doctrine is the part worth copying.
