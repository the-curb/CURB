import { AGENT_BY_ID } from '@/lib/agents/registry';
import { PRODUCERS } from '@/lib/agents/producers';
import { runAgent } from '@/lib/agents/runtime';
import { getStore } from '@/lib/store/fs';

/**
 * The desk — an on-request agent, answered here.
 *
 * The Surveyor declares no interval. It is never due, never scheduled, and never
 * counted as a failure for staying quiet; the only way it runs is because
 * somebody asked. That is what "on request" means, and this route is the asking.
 *
 * It still travels the full pipeline. Being asked for is not a reason to skip a
 * gate, so provenance and policy run exactly as they do on a scheduled agent.
 */
export async function GET(request: Request): Promise<Response> {
  const spec = AGENT_BY_ID.surveyor;
  const producer = PRODUCERS.surveyor;

  if (!producer) {
    return Response.json(
      { error: 'the surveyor is described in the registry but has no producer wired' },
      { status: 501 },
    );
  }

  const dryRun = new URL(request.url).searchParams.get('dry') === '1';
  const run = await runAgent(spec, producer, { dryRun });
  const store = getStore();

  // Three outcomes, not two: no publication, the publication, or a store that
  // would not say. The last one must not be served as the first.
  let publication = null;
  let publicationUnread: string | null = null;
  if (run.publicationId !== null) {
    const recent = await store.recentPublications(5);
    if (recent.state === 'UNREAD') {
      publicationUnread = `${recent.reason}${recent.detail ? `: ${recent.detail}` : ''}`;
    } else {
      publication = recent.value.find((p) => p.id === run.publicationId) ?? null;
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
