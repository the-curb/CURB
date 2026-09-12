import { checkBearer } from '@/lib/ops/bearer';
import { PRODUCERS } from '@/lib/agents/producers';
import { tick } from '@/lib/agents/runtime';
import { describeStore, getStoreAsync } from '@/lib/store';
import { narrateClosedDay, yesterdayOf } from '@/lib/gazette/narrate';
import { runAlerts } from '@/lib/ops/alerts';
import { maintainRetention } from '@/lib/ops/maintenance';
import { positionsMaintenance } from '@/lib/positions/maintenance';
import { runCredits } from '@/lib/credits/maintenance';

/**
 * A tick with the Tally, the Archivist and a narration due together runs thirty to forty seconds; the platform default of ten would kill it mid-run with the lock held and half the records written. The run lock TTL is 120 s, so a run that does overrun this limit is released within two minutes rather than never.
 */
export const maxDuration = 60;

/**
 * The scheduler's entry point.
 *
 * It is triggered from outside the hosting platform on purpose: a schedule that
 * has been silently downgraded to once a day is worse than no schedule at all,
 * and a platform cron that quietly stops is indistinguishable from an agent that
 * had nothing to say — which is the one confusion this system exists to remove.
 *
 * `?dry=1` rehearses without writing. A rehearsal that moves the state you use to
 * judge production is not a rehearsal.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const bearer = checkBearer(request);
  if (!bearer.ok) return Response.json({ error: bearer.error, detail: bearer.detail }, { status: bearer.status });

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') === '1';
  // `?daily=force` runs the position product's daily archive and verification
  // now rather than once a day — for the operator, after a source was added.
  const forceDaily = url.searchParams.get('daily') === 'force';
  const store = await getStoreAsync();
  const result = await tick(PRODUCERS, { dryRun, store });

  // Yesterday's edition is closed and stable; narrate it once. A dry run does
  // not, because a narration is a write. Never today: its record is still moving.
  const narration = dryRun ? null : await narrateClosedDay(store, yesterdayOf(new Date()));

  // Operations ride on the same tick: what changed that a person should know,
  // the once-a-day prune, the position product's backend and the credit desk.
  // None runs on a rehearsal, because all of them write — and none runs
  // unless this tick held the run lock and can hold it again for this part:
  // two ticks that overlap must not both deliver an alert, charge a
  // subscriber, or index the same top-ups. The agents' lock is released when
  // tick() returns, so the maintenance takes its own, under the same holder.
  const now = new Date();
  let alerts: Awaited<ReturnType<typeof runAlerts>> | null = null;
  let retention: Awaited<ReturnType<typeof maintainRetention>> | null = null;
  let positions: Awaited<ReturnType<typeof positionsMaintenance>> | null = null;
  let credits: Awaited<ReturnType<typeof runCredits>> | null = null;
  let maintenance: { state: 'RAN' | 'SKIPPED' | 'NOT_ON_A_REHEARSAL'; detail: string | null } = { state: 'NOT_ON_A_REHEARSAL', detail: null };
  if (!dryRun) {
    const holder = `${result.lock?.state === 'ACQUIRED' ? result.lock.holder : 'tick'}:maintenance`;
    const held = result.lock?.state === 'ACQUIRED' ? await store.acquireRunLock(holder, 120) : null;
    if (held?.state === 'ACQUIRED') {
      try {
        alerts = await runAlerts(store, now);
        // The desk's subscribers are each told their own changes since their own last delivery.
        // What is left of the function's sixty seconds, less a margin to answer.
        credits = await runCredits(store, now, alerts.conditions, startedAt + (maxDuration - 8) * 1000);
        retention = await maintainRetention(store, now);
        // The position product's backend: issuer evidence and on-chain verification
        // once a day, the series index and reconciliation every run — or
        // NOT_DEPLOYED, said plainly, while no reviewed deployment exists.
        positions = await positionsMaintenance(store, now, { forceDaily });
        maintenance = { state: 'RAN', detail: null };
      } finally {
        await store.releaseRunLock(holder);
      }
    } else {
      maintenance = { state: 'SKIPPED', detail: result.lock?.state !== 'ACQUIRED' ? `the run lock was ${result.lock?.state ?? 'not taken'}; another tick is running` : `the maintenance lock was ${held?.state ?? 'not taken'}` };
    }
  }

  return Response.json(
    {
      at: result.at,
      dryRun,
      ran: result.ran.map((r) => ({
        agentId: r.agentId,
        outcome: r.outcome,
        publicationId: r.publicationId,
        sourcesReached: r.heartbeat.sourcesReached,
        sourcesExpected: r.heartbeat.sourcesExpected,
        detail: r.heartbeat.detail,
        breaches: r.breaches,
        persisted: r.persisted,
        /** What the store did. `atomic: false` means the pair could disagree. */
        storage: r.storage,
      })),
      /** Named, never hidden: these are described in the registry but not wired. */
      notImplemented: result.notImplemented,
      notDue: result.notDue,
      /**
       * Agents whose due-ness could not be decided because the store would not
       * say when they last ran. Nothing was run for them, and the reason is
       * given per agent rather than folded into notDue.
       */
      undetermined: result.undetermined,
      /**
       * Whether this tick held the run lock. Null on a rehearsal, which takes
       * none. Anything other than ACQUIRED means nothing ran.
       */
      lock: result.lock,
      /** Which store answered — a deployment on the wrong one should be visible. */
      store: describeStore(),
      /** The store's schema against this build: a migration not yet run is said here, not found in a driver's message. */
      storeSchema: await store.schemaStatus(),
      /**
       * What became of yesterday's lede. ALREADY_DONE is the usual answer;
       * ATTEMPTED carries the outcome, including a refusal or a policy block.
       */
      narration,
      /**
       * Conditions raised and cleared since the last tick, and whether a human
       * was told. NOT_CONFIGURED is reported, not silent: an operator who
       * believes they would be paged can see here that they would not.
       */
      alerts,
      /** The once-a-day prune: done today already, done now, or not confirmed. */
      retention,
      /** The position product's backend: evidence, verification, index, reconciliation. */
      positions,
      /** The credit desk: the rate, the top-ups credited, the subscribers told. */
      credits,
      /** Whether the maintenance above ran at all: skipped when another tick held the lock. */
      maintenance,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/** Convenience for local development only; production should POST with the secret. */
export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'use POST' }, { status: 405 });
  }
  return POST(request);
}
