# Deploying

The system is three parts with three different owners: the app on Railway, the
store on Railway Postgres (moved from Supabase; §1 says how), and the scheduler
on GitHub. They are separate on purpose.
The app can be redeployed without touching the record; the record can be
inspected without the app; and the scheduler can stop without the app looking
healthy — the Warden's "agents reporting in the last hour" goes to zero and says
so.

## Before anything: what the build has to be

`next build` must show every page as **ƒ (Dynamic)**. If one says `○ (Static)`,
it was prerendered with whatever the store held at build time and will serve
that forever. Every page under `app/` sets `dynamic = 'force-dynamic'` for this
reason; do not remove it. The only static route is `/_not-found`.

```
Route (app)
┌ ƒ /               the front page: the position, its ledger, and the desk beneath it
├ ƒ /agents
├ ƒ /api/credits   the credit desk: the price list, the rate, the receipts, a quote
├ ƒ /api/desk
├ ƒ /api/floor      the Floor board as data
├ ƒ /api/registry   the Registry roll as data
├ ƒ /api/positions  the series, their evidence, previews — the product API
├ ƒ /api/keys      a key and its hash, stored nowhere; /api/keys/[hash] is the public balance
├ ƒ /api/session
├ ƒ /api/state      the desk's operator page
├ ƒ /api/status     the position product's status, and the credit desk's
├ ƒ /api/subscriptions  a key's webhooks, charged per delivery
├ ƒ /api/tick
├ ƒ /api/wallets    a wallet's receipts and claims, from the index
├ ƒ /chambers       the terms watched, the conditions, the three numbers
├ ƒ /doctrine
├ ƒ /floor          the session, the book, the Warden, the wire
├ ƒ /gazette
├ ƒ /mechanism      MECHANISM.md, rendered from the file
├ ƒ /positions      the series in design, and /positions/[series] with the ledger simulation
├ ƒ /registry
├ ƒ /services      the price list in dollars, the rate, the key, the receipts
└ ƒ /vault          flow as an hourly rate sample
```

`/api/tick` and `/api/desk` declare `maxDuration = 60`. A tick with the Tally,
the Archivist and a narration due together runs thirty to forty seconds, and a
platform default of ten would kill it mid-run with the lock held. Sixty is
within the Hobby plan's ceiling; the run lock's 120-second TTL is what frees a
run that overruns even that.

## 1. Store — Railway Postgres

Done once. (Until 15 September 2026 the store was a Supabase project reached
through its transaction pooler; the move is the last step of this section.)

1. In the Railway project of §2, **Create → Database → PostgreSQL**, in the
   same region as the app — both were created in `sfo` (US West) on 16 September 2026; what matters is that the two are in one region, not which. One Postgres
   service; nothing else runs in it.
2. Two connection strings exist and they are not interchangeable:
   - **From the app**, the private one — `postgres://postgres:…@postgres.railway.internal:5432/railway`,
     which Railway exposes to the app as the variable reference
     `${{Postgres.DATABASE_URL}}`. The private network carries no TLS, so the
     app's `CURB_POSTGRES_URL` is that reference with `?sslmode=disable`
     appended (the driver otherwise insists on TLS and the connection fails).
   - **From the operator's shell**, the public one — the *TCP proxy* string
     (`…proxy.rlwy.net:<port>`), with `?sslmode=require`. This is the one that
     goes in `.env.local`; it is a secret like every connection string.
   The app is a long-lived server on Railway, not a function: the store keeps
   its pool open (`CURB_POSTGRES_MAX`, default small), so no external pooler
   is needed and none is used.
3. Locally, with the public string in `.env.local` as `CURB_POSTGRES_URL`:

   ```bash
   npm run db:migrate     # applies lib/store/schema.sql, idempotent
   npm run verify:store   # the store contract in a schema of its own; every case must pass
   ```

   The verification creates and drops `curb_conformance`; it never touches
   `public`. Do not deploy against a store that has not passed it. The
   checks workflow runs it too, against a Postgres of its own.

   **Moving the record from Supabase (once).** With the Supabase string in
   the shell, `npm run db:dump <directory>`; with the Railway string,
   `npm run db:migrate` then `npm run db:restore <directory>`, and compare the
   manifest's counts with the tables' (`db:dump` again into a second directory
   and diff the manifests). Then point the scheduler at the new app (§3), let
   one tick run, read `/api/state` (`state: READ`, `warden.reportingLastHour`
   climbing), and leave the Supabase project untouched for a week before it is
   deleted — the dump kept off both providers is the record's insurance while
   the two exist.

   **Backups.** The record is the store; a provider's backups are the
   provider's. `npm run db:dump <directory>` writes every table but the run
   lock as gzipped JSONL with a manifest (counts, columns, time), paged so
   the size does not matter; `npm run db:restore <directory>` reads one back,
   inserting what is missing and leaving what is there. A dump before every
   migration, and one a week, kept off the provider. Rehearsed 13 September
   2026: 5,404 observations, 297 snapshots, 100 publications dumped and
   restored into a fresh schema, twice (the second time inserting nothing);
   and again on 16 September, when the whole record moved from Supabase to
   Railway with every table's count matched.

   The weekly one runs by itself: `.github/workflows/backup.yml` dumps the
   store every Sunday at 02:00 UTC and keeps the artifact for ninety days —
   off the platform the store runs on, which is the point. This repository is
   public and an artifact of a public repository can be downloaded by anyone
   who can see it, so the dump is encrypted on the runner before it is
   uploaded and the plain files are deleted there: the store is mostly the
   published record, but once the desk runs it also holds subscribers'
   delivery URLs and the hashes their credits are keyed by. Two secrets:
   `CURB_POSTGRES_URL` (the store's public connection string,
   `sslmode=require`) and `CURB_BACKUP_PASSPHRASE`. Without either the run
   fails rather than passing with nothing in hand, and GitHub cannot show a
   secret back — **a lost passphrase is a lost backup**, so it lives in the
   operator's own keeping as well. Reading one back:

   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in store.tar.gz.enc \
     -out store.tar.gz -pass env:CURB_BACKUP_PASSPHRASE
   tar xzf store.tar.gz && npm run db:restore backup
   ```

   Railway can also keep continuous backups of the Postgres service itself
   (`railway postgres pitr enable`; off as of 16 September 2026, and it
   stores them next to the database it protects) — that is the provider's
   copy, and it does not replace this one.

   **Schema.** A build that needs a column a migration adds says so: the tick
   and `/api/state` carry `storeSchema` (`CURRENT` or `BEHIND`, naming the
   column), and the scheduler's run turns red on it. Run `db:migrate` before
   the push that needs it; the migration is idempotent and additive.

## 2. App — Railway

Railway runs the app as one long-lived Node server (no function ceiling: the
`maxDuration` the tick and the desk routes export is the budget the tick
gives itself, not a platform limit) and prices by usage on a paid plan that
permits commercial use, so the desk can sell services from it once
`CURB_CREDITS` is set (LAUNCH row 8).

**Where the deploy settings live, and why not in this repository.** They are
on the service, set 16 September 2026 and readable in **Settings → Deploy**:
health check `/api/state` with a 300-second timeout, restart `ON_FAILURE`,
and **Wait for CI on** — so a push to `main` deploys only after the
repository's checks have passed for that commit and `release checks` gates
the deployment rather than warning after it. The build and start commands are
not set: Railpack detects Next.js and runs `npm run build` then `npm run start`
(Next listens on the `PORT` Railway provides, on every interface), and
`.node-version` pins Node 24, the version CI runs. A `railway.json` in the
repository would be the tidier record, but Railway has retired Config as Code:
the API refuses to point a service at one ("use Infrastructure as Code
instead"), and the successor — `.railway/railway.ts` with `railway config
plan`/`apply` — needs the `railway` npm package, whose version check rejected
this CLI when it was tried on 16 September. So the settings above are the
record until that path works; check them against this list when anything about
the deployment changes.

1. **New project → Deploy from GitHub repo** `the-curb/CURB`, branch `main`,
   region `sfo` (US West), as the store is (§1) — they are created in the same
   project and region (§1). No build overrides; set the deploy settings above.
2. Variables on the app service (**Variables → Raw editor** takes the table
   as `KEY=value` lines):

   | Variable | Value |
   | --- | --- |
   | `CURB_POSTGRES_URL` | `${{Postgres.DATABASE_URL}}?sslmode=disable` — the reference to the Postgres service of §1, private network, no TLS |
   | `CURB_TICK_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `CURB_NETWORK` | `robinhood-mainnet` (the default; set it anyway so it is visible) |
   | `CURB_ALERT_WEBHOOK` | optional — a Discord or Slack incoming-webhook URL; see Alerting below |
   | `CURB_RPC_URL` | optional — the operator's own Robinhood Chain endpoint, measured first with `npm run probe:rpc` (set 13 September 2026 to a keyed dRPC endpoint: full archive state, `eth_getLogs` to 100,000 blocks). Unset, the public node. Set, both are used: `eth_getLogs` and state at a past block go to this endpoint first, reads at the head go to the public node first (see `CURB_RPC_ROUTE`), each with the other as its fallback. An endpoint that does not answer — the transport, a timeout on a state read, a quota, a spent balance (HTTP 402, "insufficient balance") — is passed over and not asked again for a minute; a log page that runs past its time is the reader's signal to halve, not a dead endpoint, and moves nothing |
   | `CURB_RPC_ROUTE` | optional — unset, the split above, so a paid balance is spent only on what the public node cannot serve (decided 21 September 2026, when the dRPC balance ran low). `all` sends every read to `CURB_RPC_URL` first, as before. Production runs `all` since 21 September 2026, after the balance was topped up |
   | `CURB_RPC_URL_ETHEREUM` | optional — the position product's Ethereum endpoint; unset, `ethereum-rpc.publicnode.com` |
   | `ANTHROPIC_API_KEY` | optional — the Gazette's narration; unset, the day is printed unnarrated |
   | `CURB_ONDO_API_KEY` | not held (register A8); the issuer's API answers ACCESS_DENIED without it and the page stays the source |
   | `CURB_CREDITS` | the credit desk, only after LAUNCH row 7 — the line the deployment tool prints; absent means NOT_CONFIGURED |

   A keyed URL is a secret: it lives on Railway and in the operator's
   `.env.local`, nowhere else, and is rotated at the provider when anyone who
   saw it leaves. `CURB_TICK_SECRET` is rotated by setting the new value on
   Railway (a variable change redeploys the service; the change is live when
   that deployment is), then setting the same value in the repository's
   secrets; the ticks between the redeploy and the second
   step fail with 401 and say so, and every secret's owner is the operator
   the policy names (register A4). Without `CURB_TICK_SECRET` the tick and the
   desk endpoint refuse in production (503) rather than run open.

   Do **not** set `CURB_DNS_OVER_HTTPS` on Railway. It exists for a local network
   whose resolver hijacks the RPC hostname. Railway's does not, and the plain
   `fetch` path is the one with the fewest moving parts.

3. **Settings → Networking → Generate domain** (`<service>.up.railway.app`;
   a custom domain is a CNAME to it, later). Deploy. Then confirm:

   ```bash
   curl -s https://<deployment>/api/state | jq '{state, store: .warden}'
   ```

   `state` must be `READ`. If it is `STORE_UNREADABLE` the connection string is
   wrong or the pooler is unreachable; the `reason` field says which.

4. Confirm the tick and the desk are protected — both write, both take the
   same secret:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<deployment>/api/tick
   # 401 — no secret, no run
   ```

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<deployment>/api/desk
   # 401 — the Surveyor runs on request, and the request carries the secret
   ```

5. The app must run next to the store: both services in the same Railway
   project and region, talking over the private network. This is not a
   preference. Every page reads the record on demand, so a page is a handful
   of round trips in sequence; measured across an ocean (the earlier Vercel
   deployment from Washington to a store in Singapore) that was 1.3 to 5
   seconds to first byte on every navigation; in-region it is the store's own
   time. The service's region is in its settings; the store's is in its own.
   (`vercel.json`, the earlier region pin, was removed at the cutover on 16 September 2026.)

**The tick holds a lock for its maintenance.** Alerts, retention, the
position product's backend and the credit desk run only when the tick held
the agents' run lock and can take a second one for this part; a tick that
overlaps another skips them and says so (`maintenance.state` in the
response), so no alert is delivered twice, no subscriber charged twice and
no top-up indexed by two runs at once.

## 3. Scheduler — GitHub Actions

`.github/workflows/tick.yml` calls `POST /api/tick` every five minutes.

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `CURB_TICK_URL` | `https://<service>.up.railway.app/api/tick` |
| `CURB_TICK_SECRET` | the same value as on Railway |
| (none) | the checks workflow's Postgres conformance job needs no secret: it runs against a Postgres of its own |

Then Actions → **tick** → **Run workflow** with *dry run* ticked. A dry run
takes no lock and writes nothing, so it proves the wiring without moving the
record. Then run it for real, and read the log: every agent, its outcome, and
whether its write was atomic.

GitHub's cron is best-effort: scheduled for every five minutes, it fired every
twelve to nineteen minutes on the first evening (measured), and can run later
under load. That is acceptable here: each agent decides its own due-ness from
its last heartbeat, so a late tick runs what is due, and two ticks that overlap
are refused by the run lock. The freshness thresholds (an agent's interval plus
two hours of grace) absorb it. If a tighter cadence ever matters, an outside
pinger calling POST /api/tick with the secret every five minutes is the fix;
nothing in the app assumes the caller is GitHub. Railway can be that pinger:
a second service from the same repository with a **cron schedule** of
`*/5 * * * *` and the start command
`curl -fsS -X POST -H "Authorization: Bearer $CURB_TICK_SECRET" "$CURB_TICK_URL"`
runs to completion on Railway's clock — but it shares no durable log with
the Actions run, so the GitHub workflow stays the record even if Railway
does the calling.

## What to watch

`/api/state` is the operator's page. Three numbers, printed even when bad:

- **sourcesReached / sourcesExpected** — what the last run of each agent
  actually reached. `20/20` is a healthy chain and a healthy store.
- **reportingLastHour** — how many agents ran. If this drops to zero the
  scheduler has stopped; the app will look fine and this number will not.
- **oldestInputAt** — the age of the oldest figure still behind a published
  number.

And on every tick response, `lock.renewalFault`: set when the lock could not be
renewed mid-run, which means the run may have overlapped another. It is reported
rather than hidden because "we held it the whole time" is a claim that field
exists to keep honest.

**How the store grows.** Heartbeats arrive at about three hundred rows a day
(the Bell every five minutes, mostly with nothing to say) and publications at a
few dozen — the Pillar files only when the book changes shape, the Tally and
the Warden hourly. That is on the order of 80 MB a year. Observations are held
for the retention horizon and then pruned, so they hold steady at roughly
half a million rows. The archive — heartbeats and publications — is the
record and is not pruned; when it outgrows a tier, the answer is a bigger
tier, not a shorter memory.

## The registries, and how to re-capture them

Two generated modules hold every address the agents read, and both were
verified on chain when they were written:

- `lib/chain/feed-directory.ts` — every Chainlink feed the vendor directory
  lists for Robinhood Chain (57 at capture: 35 tokenized equity, 22 crypto),
  each with the `description()` and `decimals()` the proxy actually answered.
- `lib/chain/stock-tokens.ts` — every stock and ETF token in the issuer's
  registry (194 at capture), each with the symbol, name, multiplier, beacon and
  code hash the chain answered, and the one shared beacon they all delegate to.

When either source changes, the system says so rather than drifting quietly.
The Registrar fetches both live sources once a day and diffs them against the
captures — tokens or feeds added, removed, or moved to another contract — in a
"THE CAPTURE, AGAINST THE WORLD" block, and the difference is an alert
condition (`capture:tokens:DRIFT`, `capture:feeds:DRIFT`, and
`capture:tokens:MOVED` when the capture points at the wrong contract). The
Pillar and the Registrar also catch a re-pointed proxy or a changed beacon on
chain. The fix is a re-capture, not a hand edit:

```bash
node --env-file-if-exists=.env.local scripts/capture-feeds.ts
```

```bash
node --env-file-if-exists=.env.local scripts/capture-stock-tokens.ts
```

Each is a dry run that prints what changed and writes nothing. Add `--write` to
regenerate the module, read the diff, and commit it. A capture that cannot
verify every entry on chain refuses to write.

## Alerting and retention

Both ride on the tick, and both are reported in its response.

- **Who reads it.** Treasury signers are recorded in the operator policy;
  the on-call reader, response time and escalation rota still need assignment.
  The tick's red runs are a second channel. The scheduler itself is GitHub's: a public repository
  with no commit for sixty days has its scheduled workflows disabled — the
  weekly fork-evidence commit keeps it alive, and `reportingLastHour` on
  `/api/state` falling to zero is a signal for monitoring. `watch.yml` already
  probes it on GitHub; a monitor on another platform is still required to
  detect a shared scheduler outage. Once a week:
  `npm run db:dump` to a directory off the provider.
- **Alerting.** Set `CURB_ALERT_WEBHOOK` to a Discord or Slack incoming-webhook
  URL. After each tick the active conditions — an agent absent, degraded or
  stale; the board's sample absent; a feed paused, drifted, or past its
  heartbeat while the exchange was open; the stock-token beacon changed — are
  compared with the set last delivered, and what was raised or cleared is posted
  once. A condition that persists is not re-sent. The current set is always
  visible at `/api/state` under `conditions`, with `alerting` saying whether a
  webhook is configured. Unconfigured is a reported state, not a silent one.
  One thing alerting cannot do is notice that the scheduler has stopped: no
  tick, no comparison, no message. That case is `reportingLastHour` going to
  zero on `/api/state`, and it needs a probe from outside — any uptime monitor
  that fetches the endpoint and checks the field.
- **Retention.** Once a UTC day the first tick prunes observations older than
  the horizon in `lib/store/retention.ts` and records what it removed. The
  tick response shows `retention` as PRUNED, ALREADY_DONE, or UNCONFIRMED — the
  last is a prune the store would not confirm, which is not a prune of zero.
  `npm run db:prune -- --apply` still works by hand.

## The position product's backend

It rides on the same tick and is reported in the response under `positions`.
Nothing in it depends on the desk's chain: it has its own network profile and
its own RPC override.

- **Network.** `CURB_POSITIONS_NETWORK` (default `ethereum-mainnet`) selects the
  profile; `CURB_RPC_URL_ETHEREUM` overrides its node. The desk's
  `CURB_RPC_URL` does not reach it, and every record either side writes
  carries its chain id, so Robinhood Chain data and Ethereum data cannot be
  merged by accident.
- **Evidence, once a UTC day.** The issuers' documented endpoints are fetched
  and archived as received: `evidence:<source>:latest` always moves, and a
  record not seen before is kept under `evidence:<source>:v:<sha256>`. The
  hash is the record's identity — for a parsed record, its parsed fields in
  canonical order (xStocks' body embeds the trading session and lists its
  deployments in varying order; a body that differs only there is the same
  record); for a document or a refusal, what was received. The raw body is
  kept beside it (`rawHash`). xStocks' public asset record parses; Ondo's
  addresses endpoint needs an `x-api-key` (`CURB_ONDO_API_KEY`) and without
  one records `ACCESS_DENIED` — that is the finding, and it stays on the
  record. Ondo's own product page for the asset (`app.ondo.finance/assets/
  aaplon`) carries the same record in its payload — deployments per network,
  decimals, the live shares-per-token figure — and is parsed as a source of
  its own; component B's candidate address comes from it. No address from an
  example in a specification is ever used. `POST /api/tick?daily=force` (or
  the tick workflow's *daily* input) runs the archive and verification now
  rather than once a day, for the operator after a source was added.
- **Verification, after the evidence.** Every EVM address the parsed evidence
  names on the positions network is read on chain: code and its hash,
  `symbol()`, `decimals()`, for a wrapper `asset()` against the raw token
  the issuer named beside it, the EIP-1967 implementation, admin and
  beacon slots — a proxy's code hash sleeps through an upgrade, the
  implementation slot does not, and a slot that moved is a DARK condition —
  and, for the raw token its corporate-action `multiplier()` and for a
  wrapper `convertToAssets(1e18)`: a move there is a corporate action,
  journalled and raised as a NOTE that says so, not a fault. The valuation
  uses the daily conversion when it is on record. The result is at
  `/api/positions/<series>/evidence` and on the series page. What it does not
  prove is listed with it.
- **Index and reconciliation, every tick — when a series is deployed.**
  `CURB_SERIES_DEPLOYMENTS` (JSON keyed by series id; see
  `.env.local.example`) is filled only from a reviewed deployment record.
  With it set, the tick reads the contract's events from `fromBlock` (idempotent
  on transaction hash and log index; block hashes kept for reorg rollback),
  replays them through the same ledger the simulation and tests use, and
  reconciles what the series owes against `balanceOf` on each component,
  read at the block the index reached so owed and held are measured at the
  same height: MATCHED, SURPLUS, SHORTFALL, or UNKNOWN (a node that no
  longer serves that block's state says so, and nothing is compared across
  heights). Without it, every read of a chain for that series is skipped
  and `/api/status` says `NOT_DEPLOYED`.
- **The series' own code, every tick — when a series is deployed.** The
  compiled runtime bytecode is committed with its commit
  (`contracts/evidence/CompanySeries.build.json`, written by `npm run
  record:build` and by the weekly workflow). On every tick the site reads the
  code at the deployment's address and compares it: equal outside the
  immutable slots, and the slots holding exactly the record's components,
  units per lot and cap. A mismatch is a DARK condition and the series page
  says so; no explorer is asked.
- **Documents watched.** The thirteen pages the issuers publish about the
  instruments are fetched on the same daily run and kept as the hash of their
  visible text — never read for meaning. A change raises a NOTE condition for
  two days; a page that stops answering raises a STALE one.
- **Conditions and alerts.** The position product feeds the same alerting as
  the desk: an issuer record or document that changed or stopped answering, a
  candidate address whose code hash, symbol, decimals, `asset()` or EIP-1967
  slots moved between daily runs, or a record that names a different address
  than it did the day before (T15 — DARK), a configured series held short of what it
  owes, a balance that could not be read, and an event the ledger model
  refuses. They appear on `/api/state` under `conditions` and on Chambers,
  and are posted to the webhook once when raised and once when cleared.
- **The Gazette's positions section.** Each day's edition carries the
  product's verified changes: a body first archived or changed (by the
  archive's version rows, dated when first seen) and an address that moved
  between verification runs (by the drift rows the verification writes under
  `positions:drift:<series>:<time>`), and a reconciliation finding that moved
  (by the rows the reconciliation writes under `positions:finding:<series>:<time>`). It is derived from those rows on every
  request and adds nothing to them; an empty day is printed as empty.
- **Fork evidence.** `contracts/evidence/<series>.fork.json` and
  `<series>.corporate-action.json` are written by `npm run test:fork` in
  `contracts/` (the second needs an archive endpoint in `ETH_RPC_URL`) and
  committed; the site reads them at request time and shows them dated. No
  file, no finding shown. `.github/workflows/fork-evidence.yml` reruns the
  fork tests every Monday against a public node and commits the record when
  it moved, so the block the page cites stays within the week; a node that
  does not answer leaves the last record in place and a red run.
- **Instrument file (R01).** `/api/positions/<series>/file` compiles, from the
  archive and the chain, what is known about each candidate component — the
  underlying and its ISIN as the issuer states them, the issuer record and its
  status, every address with code hash, symbol, decimals and `asset()`, the
  documents and their hashes, the related parties as the issuers' documents
  name them (R02) — and what is not known, for an admission review.
  Nothing in it is typed by hand and nothing in it admits a component.
- **Product API.** `/api/positions`, `/api/positions/<series>`,
  `/api/positions/<series>/evidence`, `/api/positions/<series>/file`, `/api/positions/<series>/preview-mint?lots=`,
  `/api/positions/<series>/preview-exit?lots=`, `/api/wallets/<address>/positions`,
  `/api/wallets/<address>/claims`, `/api/status`. Every amount is a string of
  integer base units. A preview sends nothing and estimates nothing; a value
  it does not have is `NOT_AVAILABLE` with a reason, never zero.
- **Indicative value.** The previews and the series page carry an indicative
  value in the mechanism's sense (§8): component A from the wrapper's
  conversion rate as the fork test read it (dated by block) and the Chainlink
  AAPL / USD reading the Pillar last sampled on Robinhood Chain (dated by the
  feed's own time and the sample time; withheld when the sample is past the
  desk's freshness, the feed drifted or is paused), with the assumption
  between them stated; component B `NOT_AVAILABLE` with its reason; the lot
  `INCOMPLETE` and never totalled while a component has no price. The series
  detail carries the valuation of one lot; `/api/wallets/<address>/positions`
  carries the value of that wallet's receipts from the same sources.
- **With the holder's wallet.** Once a deployment is configured, the series
  page shows "Form a position, claim components": the holder's own wallet
  (any EIP-1193 provider) signs and sends the prepared steps one by one —
  approvals then the mint, or the exit allocation then a claim per component;
  a wallet on another chain is refused before anything is sent; the receipt
  is read from the series contract through the wallet after the mint is
  mined; the index catches up on the next tick and is shown as the index.
  The site holds no key and sends nothing itself.
- **Sign it yourself.** Once a deployment is configured, the previews also
  return `signItYourself`: the two ERC-20 approvals and the series call
  (`mint`, or `allocateExit` and the two `claimComponent` calls) as `to` and
  `data` bytes, with selectors derived from the contract's signatures. They
  are for the holder's own wallet or script. The site holds no key, signs
  nothing and sends nothing; a mint prepared this way expires fifteen
  minutes after it was prepared.
- **The drill.** `contracts/evidence/drill-local.json` is written by the
  drill's site half (`tests/positions-drill.test.ts`, after
  `contracts/scripts/drill.ts` staged the incidents on a local node) and
  committed; the series page shows it dated, with every transaction hash,
  every revert name and what the index, the reconciliation and the
  conditions said. No file, nothing shown.
- **Rehearsal on a local chain.** The whole path — deployment record, index,
  ledger replay, reconciliation, wallet endpoints, prepared bytes — can be
  run against a Hardhat node on this machine, with the worked example sent as
  real transactions. `contracts/README.md` gives the three commands. It
  proves the plumbing, not a public deployment: chain id 31337 is refused by
  every profile but `hardhat-local`, which no production setting names. The
  checks workflow runs the rehearsal and the drill on every push, on a node
  it starts itself.

## The credit desk

The token's one function, decided (`docs/decisions/TOKEN.md`, on the site at
`/mechanism/decisions/token`): a CURB paid to the credit desk is a prepaid
unit of a service that exists, priced in dollars. It rides on the same tick
and is reported under `credits`. No token exists; in production it is
`NOT_CONFIGURED` and `/services` says so.

- **Configuration.** `CURB_CREDITS` is one JSON record — the network profile,
  the token, the desk contract (`contracts/src/CreditDesk.sol`), the treasury
  every top-up goes to (the operator multisig), the block the desk was
  created in, and the price source: a constant-product pool holding
  CURB and a quote asset, the quote taken as dollars (`usd-stable`) or
  priced by a Chainlink feed (`chainlink-feed`). Filled only from what was
  read from the chain after a launch; see `.env.local.example`. A record
  that does not parse is `CONFIG_INVALID` with its reason. A chain not in
  `lib/chain/networks.ts` is a reviewed code change first.
- **The chain.** The token record decides the launch for Robinhood Chain
  (chain id 4663): `network` is `robinhood-mainnet`, read through `CURB_RPC_URL`
  like the desk's own agents. Measured there on 12 September 2026: 0.103 s
  blocks; the public node serves state for about 6,200 blocks (ten minutes)
  and logs for 100,000 blocks in one query.
- **The rate, every tick.** The pool's `token0()`, `token1()` and its price —
  `getReserves()` for a pair, `slot0()` for a v3 pool, and for a v4 pool
  `StateView.getSlot0(id)` and `getLiquidity(id)` with the sides taken from
  the key the record carries (a v4 pool has no address and no `token0()`;
  the zero address is native ETH, eighteen decimals) — and the token's
  `decimals()` and `totalSupply()` are read at the head block; the market
  capitalisation is price × supply at that block. Recorded under
  `credits:rate` with the block, or as UNREAD with the reason (an empty pool
  side, a feed that answers nothing positive, a node that cannot serve the
  block). Nothing is quoted from an earlier read and nothing is typed in.
- **The desk's code, every tick.** The compiled runtime bytecode is committed
  with its commit (`contracts/evidence/CreditDesk.build.json`, written by
  `npm run record:build` beside the series' build). The tick reads the code
  at the desk's address and compares it: equal outside the two immutable
  slots, and the slots holding exactly the record's token and treasury. A
  mismatch — other code, or a desk paying somewhere else — is a DARK
  condition (`credits:code:MISMATCH`) and the services page says so.
- **Conditions.** The desk's last run is one row (`credits:run`) the
  conditions read: no rate on the last run is STALE, top-ups waiting to be
  credited are a NOTE, an index that could not read the head or a block
  range is STALE, an index held because the desk's code is not the record's
  is STALE (beside the DARK on the code), a subscriber webhook that failed
  is a NOTE. They appear on `/api/state` and
  Chambers with the desk's other conditions and go to the webhook.
- **Receipts.** `/api/credits` and `/services` carry the receipts — every
  top-up credited, summed: count, keys, CURB received, dollars credited,
  how many were priced at their own block — derived from the keys' rows on
  every request, never a second record. The token record promises the
  proceeds' budget before a launch and the receipts after; this is the after.
- **Top-ups, every tick.** `TopUp(bytes32 keyHash, address payer, uint256
  amount)` events from the desk since `fromBlock` (idempotent on transaction
  hash and log index; block hashes kept for reorg rollback, which also
  removes the credits of a rolled-back block; the last block of every sync
  is kept too, checked newest first). Each is priced at the rate at its own
  block — by state while the node serves it (`TOP_UP_BLOCK`), else from the
  pool's last `Sync` or `Swap` at or before it and, for a feed-priced quote,
  the aggregator's last `AnswerUpdated` (`TOP_UP_BLOCK_EVENTS`); at the head
  when indexed (`HEAD_AT_INDEXING`) only for a top-up at a block where the
  pool definitely had no price — created later (the record's
  `priceSource.fromBlock`, checked by the deployment tool against the
  pool's first log), no price event at or before it back to its creation
  (a v3 pool's `Initialize` counts once a `Mint` has followed; a v4
  pool's once a positive `ModifyLiquidity` has), no liquidity or an empty
  side — and never above the lowest price the pool showed in the window
  before it (the guard, about an hour, read from events page by page — a
  v4 pool's from the PoolManager by `[Swap, id]`, the hook's own swaps
  weighed like any other — the price standing at the window's opening
  included; more than sixty-four pages is a rate not stated; an
  `Initialize` counts inside the window too; a page the node does not
  answer in time, or gives up on with its own "log query timed out", is
  halved like one it refuses). The record's
  `priceSource.fromBlock` is checked against the pool's logs once per pool:
  on a node that serves any width, one query over the span before it; on
  one that caps a query's width, pages walked down from it, run by run,
  with a NOTE (`credits:pool:UNCHECKED`) until the span is covered — a log
  before `fromBlock` holds the index (nothing is credited) until the
  configuration is corrected. Before a pool is recorded nothing is tried
  and nothing counts as tried: every top-up waits in the first queue for
  the day the pool is, and is then priced fifty a run in chain order. Two
  queues:
  at most fifty never-tried top-ups per run — fresh ones and ones deferred
  for count or time — oldest first, so a burst drains at fifty a run; then
  at most ten tried-and-waiting ones, least-tried first, so a few that
  cannot be priced never starve the rest. One that cannot be priced waits,
  listed with how often it was tried, for a tick that can; a node that did
  not answer is waited out, never priced around. A sync reads at most
  100,000 blocks and keeps to the tick's remaining time; what it did not
  reach is next. Nothing is credited while the desk's code is not the
  record's.
- **Subscribers' messages.** Each subscription keeps the set of conditions it
  was last told of and is told exactly its own changes since — in the
  operator's form: raised, cleared, still active — so a subscriber's
  deliveries do not depend on the operator's webhook being reachable, and a
  change is charged once per subscription. The row is marked told before
  the charge, and both the mark and the charge are conditional writes
  (`writeSnapshotIf`: onto the row's version as read) — a cancellation
  landing meanwhile is never overwritten, and two charges on one key at
  once cannot lose each other. A delivery whose charge did not land is the
  desk's loss, counted in the run row and raised as a NOTE
  (`credits:fanout:UNCHARGED`) — to the operator's webhook and `/api/state`,
  never to the subscribers: the fan-out's own bookkeeping
  (`credits:fanout:*`) is not a change they pay to hear of. A subscription
  that cannot finish (lookup, post and store round trips) before the
  fan-out's deadline is not started; it is next in line. The caps (five
  live, twenty in all, one per URL) are enforced on a per-key ledger row by
  the same conditional write, so requests at once cannot pass them
  together. On the Postgres store a conditional write carries a token, so a
  statement resent after a dropped socket — or one that timed out after it
  committed — is found on the row by its token and reported written, never
  as a conflict that would charge twice for one answer; when even that read
  fails, the 503 says `charged: "UNKNOWN"` and the caller reads the balance
  before calling again. The `snapshots` table gained `version` and
  `write_token` columns for this on 13 September 2026: `npm run db:migrate`
  before deploying a build that has them.
- **Keys.** A key is thirty-two random bytes the caller makes (`/services`
  makes one in the browser; `POST /api/keys` makes one and stores nothing);
  its SHA-256 is what the chain credits and what the desk keeps rows by. The
  desk sees the key only in an `x-curb-key` header (or `Authorization:
  Bearer`). Charges go to
  `credits:spend:<keyHash>`, a separate row with a separate writer, so the
  indexer and a request never overwrite each other. A key opens at US$20.00
  credited, cumulatively. `GET /api/keys/<keyHash>` is the public balance.
- **Paid endpoints.** `/api/positions/<series>/evidence/versions?source=`,
  `/api/positions/<series>/journal?day=`, and webhook subscriptions
  (`/api/subscriptions`, charged per delivery of the same message the
  operator's webhook gets, once per transition, only when delivered, and
  only to a hostname that resolves to a public address when the post is
  made, within a twenty-second budget per tick and five seconds per
  webhook; the rest are next in line; a redirect is not followed). The
  prices are in `lib/credits/prices.ts` and on `/services` and
  `/api/credits`, nowhere else. A call is admitted first (configured, keyed,
  able to pay), answered, and charged only when there is an answer: a store
  that cannot answer costs nothing. 503 while unconfigured; 401 without a
  key; 402 with the figures and the top-up call when the key cannot pay.
  Every public endpoint stays free.
- **The multisig and the token's facts.** `contracts/scripts/plan-safe.ts` plans the
  operator's Safe on Robinhood Chain, unsigned and simulated; `contracts/scripts/safe-tx.ts`
  prints a Safe transaction's hash, approval and execution bytes so the
  quorum acts with ordinary transactions and no hosted interface;
  `contracts/scripts/record-token.ts` reads the token from the chain and writes the
  desk's record with the facts beside it (refused until reviewed). None
  holds a key. The checks workflow rehearses the Safe (with its code as
  Robinhood Chain has it) and the whole tool path on a local chain.
- **A plain token, or nothing.** The desk refuses a top-up that pays the
  treasury less than the amount (`DeltaWrong`); a fee-on-transfer token would
  make every top-up revert. The deployment plan has the operator make a
  small first top-up before the desk is announced.
- **Receipts by day.** The Gazette prints the day's credits under *Services ·
  receipts* — count, keys, dollars, CURB, and how each was priced — once a
  desk exists or a credit was ever made.
- **Deploying the desk.** `contracts/scripts/deploy-credit-desk.ts <record> [--dry-run] [--reviewed]`
  deploys the desk from a reviewed record (`contracts/records/credit-desk.example.json`
  shows the shape and is refused on purpose): it checks the chain id, the
  token's code and answers, the treasury's code on a public chain, the
  pool's code if named; the key comes from `DEPLOYER_PRIVATE_KEY` in the
  operator's shell; it prints the `CURB_CREDITS` line and writes the
  deployment record beside the evidence. The deployment plan has the steps.
- **Rehearsal on a local chain.** `contracts/scripts/credits-rehearsal.ts`
  deploys a mock CURB, a mock dollar, a mock pool and the desk on a Hardhat
  node, tops a key hash up twice at two prices, and prints the record;
  `tests/credits-rehearsal.test.ts` reads it back through the tick, finds
  the desk's code to be the build with the record's token and treasury,
  each top-up priced at its own block, the key open, and a call charged. The
  checks workflow runs it on every push.

## What is not covered here

- **The sequencer uptime feed.** The vendor directory lists none for this
  network. Unconfigured, the Pillar reports the sequencer as not checked, which
  is not the same as up. If one is published, set `CURB_SEQUENCER_FEED`.
- **Holder concentration and hourly flow totals.** This chain produces
  hundreds of transfers a second: an hour is far more logs than a run can read
  through the keyed endpoint, and the fallback public node refuses any query
  matching more than ten thousand. So the Tally measures a rate over a sample
  of about a minute and says so. Totals and concentration need an indexer this
  system does not have.
- **Prices for 159 of the 194 stock tokens.** The directory lists a feed for
  35. The rest are on the Registry roll with every measured column present and
  no price, and nothing on the site states one for them.
- **Logs and errors off the platform.** Railway keeps a deployment's build
  and runtime logs while the deployment exists, searchable in the dashboard;
  the tick's durable log is the GitHub Actions run (ninety days). A 500 on a
  page is in Railway's log and nowhere durable; a log drain to somewhere that
  outlives the deployment is not set up. Until it is, the tick's red runs,
  the watch workflow and `/api/state` are what there is.
- **A probe from outside, half of one.** `.github/workflows/watch.yml`
  fetches `/api/state` every half hour from a workflow of its own and turns
  red when the store did not answer, no agent reported in the last hour, the
  schema is behind, an agent is absent or a DARK condition stands — a stopped
  tick is a red run within the hour. It shares GitHub's scheduler with the
  tick, so a monitor on another platform (any uptime check that fetches the
  endpoint and reads `warden.reportingLastHour`) is still the other half.
- **The certificate of the store's connection.** `sslmode=require` encrypts
  the connection but does not verify the server's certificate; `verify-full`
  needs the provider's CA certificate on the deployment, which has not been
  set up (see the note in `.env.local.example`).
- **What it costs.** The token record has the desk's costs published and the
  policy has the treasury pay them monthly against the published figures; the
  tiers and quotas of Railway (the app and the Postgres service) and the RPC
  provider, and their monthly cost, are not on a page yet — they go into the token record's proceeds table
  after the actual plans, quotas, service volumes and budgets are measured
  and decided (LAUNCH row 8). Naming treasury signers did not measure these costs.

## Mainnet preparation and release records

The preparation dossier is [docs/mainnet/PREPARATION.md](docs/mainnet/PREPARATION.md).
`npm run mainnet:preflight` is an offline, read-only check of source identity,
evidence hashes and release-record completeness. Its default template deliberately
returns `HELD` (exit 2). It reads no `.env` files, signs nothing and does not
grant approval. Populate a copy of `docs/mainnet/readiness.example.json` only
from actual evidence and named reviews; pass its path as the command argument.
The output keeps token launch, paid beta and position pilot separate. Public
series gates and a dirty working tree also hold release status.

The checks workflow supports manual runs and `codex/**` branches and exposes
one aggregate `release checks` status covering site, store, contracts, local-chain
rehearsal and production HTTP/webhook acceptance. Configure repository rules and the hosting
deployment path to require that status for the exact commit. Adding the workflow
does not change the live Railway integration (its *Wait for CI* setting) or
branch rules by itself. Confirm those account settings before promoting a
release; retain a rollback deployment (Railway keeps earlier deployments and
can roll back to one from the dashboard).

Before changing production, run Postgres conformance against a disposable database,
not a URL loaded from `.env.local`. Use an explicit isolated `CURB_POSTGRES_URL`
with `node --test tests/store-postgres.test.ts`. The mainnet preparation report
records the actual test environment. Production certificate verification, provider
limits, off-provider backups and independent monitoring still require evidence
from the chosen deployment environment.

The reusable monitor command is `npm run monitor:health -- https://host/api/state`
or `node scripts/check-health.ts` with `CURB_HEALTH_URL`. GitHub watch uses that
same implementation. It performs one read-only request and fails for unread,
malformed or stale state, missing roster, absent agents, schema drift and DARK
conditions. Running it on an independently scheduled platform and assigning its
alerts remain operator setup tasks; committing the script does not install a monitor.

The [15 September execution decisions](docs/mainnet/EXECUTION-DECISIONS-2026-09-15.md)
record the selected funding calculation and the current PONS v2 compatibility hold.
Use `npm run rehearsal:local -- --postgres-url <numeric-loopback-admin-url>` for
the repeatable isolated payment/ledger/webhook run; see [its guide](scripts/REHEARSAL.md).
`npm run mainnet:budget` keeps unmeasured costs explicit and excludes reserved
liquidity/customer funding from proceeds. After committing the reviewed release,
`npm run review:package` exports its source and evidence with an archive hash.
