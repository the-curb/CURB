import { PRODUCERS } from '@/lib/agents/producers';
import { tick } from '@/lib/agents/runtime';
import { describeStore, getStoreAsync } from '@/lib/store';
import { narrateClosedDay, yesterdayOf } from '@/lib/gazette/narrate';
import { runAlerts } from '@/lib/ops/alerts';
import { maintainRetention } from '@/lib/ops/maintenance';
import { positionsMaintenance } from '@/lib/positions/maintenance';

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
  const secret = process.env.CURB_TICK_SECRET;
  if (secret) {
    const offered = request.headers.get('authorization');
    if (offered !== `Bearer ${secret}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

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
  // and the once-a-day prune. Neither runs on a rehearsal, because both write.
  const now = new Date();
  const alerts = dryRun ? null : await runAlerts(store, now);
  const retention = dryRun ? null : await maintainRetention(store, now);
  // The position product's backend rides on the same tick: issuer evidence and
  // on-chain verification once a day, the series index and reconciliation every
  // run — or NOT_DEPLOYED, said plainly, while no reviewed deployment exists.
  const positions = dryRun ? null : await positionsMaintenance(store, now, { forceDaily });

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
