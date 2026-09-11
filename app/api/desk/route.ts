import { AGENT_BY_ID } from '@/lib/agents/registry';
import { PRODUCERS } from '@/lib/agents/producers';
import { runAgent } from '@/lib/agents/runtime';
import { getStoreAsync } from '@/lib/store';

/**
 * The Surveyor reads a series per feed before it measures; give it the same room as a tick.
 */
export const maxDuration = 60;

/**
 * The desk — an on-request agent, answered here.
 *
 * The Surveyor declares no interval. It is never due, never scheduled, and never
 * counted as a failure for staying quiet; the only way it runs is because
 * somebody asked. That is what "on request" means, and this route is the asking.
 *
 * It still travels the full pipeline. Being asked for is not a reason to skip a
 * gate, so provenance and policy run exactly as they do on a scheduled agent.
 *
 * And the asking is a write: a run leaves a heartbeat and may leave a filing.
 * So it is protected the way the tick is — the same bearer secret, POST in
 * production — because a public GET that publishes is a wire anyone can fill.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CURB_TICK_SECRET;
  if (secret) {
    const offered = request.headers.get('authorization');
    if (offered !== `Bearer ${secret}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const spec = AGENT_BY_ID.surveyor;
  const producer = PRODUCERS.surveyor;

  if (!producer) {
    return Response.json(
      { error: 'the surveyor is described in the registry but has no producer wired' },
      { status: 501 },
    );
  }

  const dryRun = new URL(request.url).searchParams.get('dry') === '1';
  const store = await getStoreAsync();
  const run = await runAgent(spec, producer, { dryRun, store });

  // Three outcomes, not two: no publication, the publication, or a store that
  // would not say. The last one must not be served as the first.
  let publication = null;
  let publicationUnread: string | null = null;
  if (run.publicationId !== null) {
    // Its own filings, so a busy wire cannot push the row just written out of
    // the window before it is read back.
    const mine = await store.publicationsByAgent('surveyor', 5);
    if (mine.state === 'UNREAD') {
      publicationUnread = `${mine.reason}${mine.detail ? `: ${mine.detail}` : ''}`;
    } else {
      publication = mine.value.find((p) => p.id === run.publicationId) ?? null;
    }
  }

  return Response.json(
    {
      agent: spec.name,
      outcome: run.outcome,
      dryRun,
      /** Null is a real answer here: too few observations to measure anything. */
      publication,
      /** Set only when the store refused to hand back what was just written. */
      publicationUnread,
      breaches: run.breaches,
      heartbeat: run.heartbeat,
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
