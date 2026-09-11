# Deploying

The system is three parts with three different owners: the app on Vercel, the
store on Supabase, and the scheduler on GitHub. They are separate on purpose.
The app can be redeployed without touching the record; the record can be
inspected without the app; and the scheduler can stop without the app looking
healthy — the Warden's "agents reporting in the last hour" goes to zero and says
so.

## Before anything: what the build has to be

`next build` must show `/` as **ƒ (Dynamic)**. If it says `○ (Static)`, the
dashboard was prerendered with whatever the store held at build time and will
serve that forever. `app/page.tsx` sets `dynamic = 'force-dynamic'` for this
reason; do not remove it.

```
Route (app)
┌ ƒ /              ← must be ƒ
├ ƒ /api/desk
├ ƒ /api/session
├ ƒ /api/state
└ ƒ /api/tick
```

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

4. Confirm the tick is protected:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<deployment>/api/tick
   # 401 — no secret, no run
   ```

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

GitHub's cron is best-effort and runs late under load. That is acceptable here:
each agent decides its own due-ness from its last heartbeat, so a late tick
runs what is due, and two ticks that overlap are refused by the run lock.

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

## The registries, and how to re-capture them

Two generated modules hold every address the agents read, and both were
verified on chain when they were written:

- `lib/chain/feed-directory.ts` — every Chainlink feed the vendor directory
  lists for Robinhood Chain (57 at capture: 35 tokenized equity, 22 crypto),
  each with the `description()` and `decimals()` the proxy actually answered.
- `lib/chain/stock-tokens.ts` — every stock and ETF token in the issuer's
  registry (194 at capture), each with the symbol, name, multiplier, beacon and
  code hash the chain answered, and the one shared beacon they all delegate to.

When either source changes — a new feed, a new token, a re-pointed proxy — the
Pillar and the Registrar will say so in their filings (identity drift, a beacon
implementation that differs from the recorded one). The fix is a re-capture,
not a hand edit:

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
