# THE CURB

**The ticker tells you the exposure. The curb tells you the conditions.**

A multi-agent intelligence desk for stock tokens on Robinhood Chain (chain id
4663). Nine agents read the chain and two published registries on a schedule,
publish what they measured with a source and a time on every figure, and refuse
— in code, not in a prompt — to forecast, advise, rate, or print a number they
did not read. A daily paper, *The Curb Gazette*, is composed from the record.

Before the American Stock Exchange had a building it was the Curb Market:
claims traded outside the official floor. A stock token is the same thing
again. "Curb" is also a limit, which is the other half of the job.

## What it watches

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

## What it will not do

It places no orders, holds no token, sells nothing, and states no price for a
token no feed prices. It does not say a token is backed, safe, or a scam, in
either direction. When it could not look, it says it could not look.
