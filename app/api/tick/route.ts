import { PRODUCERS } from '@/lib/agents/producers';
import { tick } from '@/lib/agents/runtime';
import { describeStore, getStoreAsync } from '@/lib/store';
import { narrateClosedDay, yesterdayOf } from '@/lib/gazette/narrate';

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

  const dryRun = new URL(request.url).searchParams.get('dry') === '1';
  const store = await getStoreAsync();
  const result = await tick(PRODUCERS, { dryRun, store });

  // Yesterday's edition is closed and stable; narrate it once. A dry run does
  // not, because a narration is a write. Never today: its record is still moving.
  const narration = dryRun ? null : await narrateClosedDay(store, yesterdayOf(new Date()));

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
