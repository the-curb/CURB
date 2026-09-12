# Deploying

The system is three parts with three different owners: the app on Vercel, the
store on Supabase, and the scheduler on GitHub. They are separate on purpose.
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
├ ƒ /api/desk
├ ƒ /api/floor      the Floor board as data
├ ƒ /api/registry   the Registry roll as data
├ ƒ /api/positions  the series, their evidence, previews — the product API
├ ƒ /api/session
├ ƒ /api/state      the desk's operator page
├ ƒ /api/status     the position product's status
├ ƒ /api/tick
├ ƒ /api/wallets    a wallet's receipts and claims, from the index
├ ƒ /chambers       the terms watched, the conditions, the three numbers
├ ƒ /doctrine
├ ƒ /floor          the session, the book, the Warden, the wire
├ ƒ /gazette
├ ƒ /mechanism      MECHANISM.md, rendered from the file
├ ƒ /positions      the series in design, and /positions/[series] with the ledger simulation
├ ƒ /registry
└ ƒ /vault          flow as an hourly rate sample
```

`/api/tick` and `/api/desk` declare `maxDuration = 60`. A tick with the Tally,
the Archivist and a narration due together runs thirty to forty seconds, and a
platform default of ten would kill it mid-run with the lock held. Sixty is
within the Hobby plan's ceiling; the run lock's 120-second TTL is what frees a
run that overruns even that.

## 1. Store — Supabase

Done once.

1. Create a project. Any region; Singapore is closest to the chain's RPC.
2. Dashboard → **Connect** → **Transaction pooler**. Copy it. Port **6543**,
   username `postgres.<project-ref>`, host `aws-<n>-<region>.pooler.supabase.com`.
   Not the direct connection (IPv6, runs out of slots), not session mode.
3. Locally, with that string in `.env.local` as `CURB_POSTGRES_URL`:

   ```bash
   npm run db:migrate     # applies lib/store/schema.sql, idempotent
   npm run verify:store   # the store contract in a schema of its own; every case must pass
   ```

   The verification creates and drops `curb_conformance`; it never touches
   `public`. Do not deploy against a store that has not passed it.

## 2. App — Vercel

1. Import the repository. Framework: Next.js. No build overrides.
2. Environment variables, **Production**:

   | Variable | Value |
   | --- | --- |
   | `CURB_POSTGRES_URL` | the transaction-pooler string from step 1 |
   | `CURB_TICK_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `CURB_NETWORK` | `robinhood-mainnet` (the default; set it anyway so it is visible) |
   | `CURB_ALERT_WEBHOOK` | optional — a Discord or Slack incoming-webhook URL; see Alerting below |

   Do **not** set `CURB_DNS_OVER_HTTPS` on Vercel. It exists for a local network
   whose resolver hijacks the RPC hostname. Vercel's does not, and the plain
   `fetch` path is the one with the fewest moving parts.

3. Deploy. Then confirm:

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

5. The functions must run next to the store. `vercel.json` pins them to
   `sin1` because the Supabase project is in `ap-southeast-1`; if the store is
   ever created elsewhere, change the region to match it, not the other way
   round. This is not a preference. Every page reads the record on demand
   through a pool of one connection, so a page is a handful of round trips in
   sequence, and the connection itself is three or four more the first time.
   Measured from Washington (`iad1`, the default) to Singapore that was 1.3 to
   5 seconds to first byte on every navigation; in-region it is the store's
   own time. `curl -sI https://<deployment>/api/state | grep x-vercel-id` shows
   the region that served the request as the second segment.

## 3. Scheduler — GitHub Actions

`.github/workflows/tick.yml` calls `POST /api/tick` every five minutes.

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `CURB_TICK_URL` | `https://<deployment>/api/tick` |
| `CURB_TICK_SECRET` | the same value as on Vercel |

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
nothing in the app assumes the caller is GitHub.

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
  the issuer named beside it, and the EIP-1967 implementation, admin and
  beacon slots — a proxy's code hash sleeps through an upgrade, the
  implementation slot does not, and a slot that moved is a DARK condition. The result is at
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
  `INCOMPLETE` and never totalled while a component has no price.
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
  every profile but `hardhat-local`, which no production setting names.

## What is not covered here

- **The sequencer uptime feed.** The vendor directory lists none for this
  network. Unconfigured, the Pillar reports the sequencer as not checked, which
  is not the same as up. If one is published, set `CURB_SEQUENCER_FEED`.
- **Holder concentration and hourly flow totals.** The public node refuses any
  log query matching more than ten thousand entries and this chain produces
  hundreds of transfers a second, so the Tally measures a rate over a sample
  of about a minute and says so. Totals and concentration need an indexer this
  system does not have.
- **Prices for 159 of the 194 stock tokens.** The directory lists a feed for
  35. The rest are on the Registry roll with every measured column present and
  no price, and nothing on the site states one for them.
