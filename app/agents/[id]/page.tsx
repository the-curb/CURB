import { DeskNav } from '../../components/desk-nav';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { AGENT_BY_ID, absenceLabel, type AgentId } from '@/lib/agents/registry';
import { statusOf, type AgentHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { getStoreAsync } from '@/lib/store';
import type { RunOutcome } from '@/lib/store/types';
import { AGENTS_COPY, agentsLine } from '@/lib/copy/agents';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

const C = AGENTS_COPY.page;

const LIGHT: Record<AgentHealth, string> = {
  LIVE: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  DEGRADED: 'var(--color-state-degraded)',
  ABSENT: 'var(--color-state-dark)',
  ON_REQUEST: 'var(--color-state-request)',
  NOT_OBSERVED: 'var(--color-state-fog)',
};

const OUTCOME_COLOUR: Record<RunOutcome, string> = {
  PUBLISHED: 'var(--color-state-live)',
  NOTHING_TO_SAY: 'var(--color-paper-faint)',
  COVERAGE_BELOW_MINIMUM: 'var(--color-state-degraded)',
  PROVENANCE_INCOMPLETE: 'var(--color-state-degraded)',
  POLICY_BLOCKED: 'var(--color-state-stale)',
  PRODUCER_FAILED: 'var(--color-state-dark)',
};

function isAgentId(id: string): id is AgentId {
  return id in AGENT_BY_ID;
}

export async function generateMetadata(props: { params: Params }) {
  const { id } = await props.params;
  return { title: isAgentId(id) ? AGENT_BY_ID[id].name : 'Not here' };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-(--color-rule) py-2.5 first:border-t-0">
      <span className="text-[11px] uppercase tracking-[0.16em] text-(--color-paper-faint)">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
      <h2 className="mb-5 text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">{title}</h2>
      {children}
    </section>
  );
}

/**
 * One agent: what it will not do, how it runs, its last run, where it reads,
 * its recent runs, and its recent filings. The refusal is the specification
 * and goes first. Every filing is printed word for word, folded under its
 * headline so the page reads as a page and not as eight reports in a row.
 */
export default async function AgentPage(props: { params: Params }) {
  const { id } = await props.params;
  if (!isAgentId(id)) notFound();

  const agent = AGENT_BY_ID[id];
  const now = new Date();
  const store = await getStoreAsync();
  const [latest, publications, runs] = await Promise.all([store.latestHeartbeat(id), store.publicationsByAgent(id, 8), store.heartbeatsByAgent(id, 40)]);

  const status = latest.state === 'UNREAD' ? null : statusOf(agent, latest.value, now);
  const wired = PRODUCERS[id] !== undefined;

  const outcomes = runs.state === 'UNREAD' ? null : runs.value;
  const tally = outcomes
    ? outcomes.reduce<Partial<Record<RunOutcome, number>>>((acc, h) => {
        acc[h.outcome] = (acc[h.outcome] ?? 0) + 1;
        return acc;
      }, {})
    : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <div className="flex flex-wrap items-baseline gap-4">
          <DeskNav current="THE AGENTS" />
          <div className="kicker mt-3">{agent.district}</div>
          {status ? (
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: LIGHT[status.health] }}>
              ● {AGENTS_COPY.health[status.health]}
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-state-stale)' }}>
              ● {C.unreadable}
            </span>
          )}
        </div>
        <h1 className="display mt-4 text-5xl tracking-[0.08em] text-(--color-paper) sm:text-6xl">{agent.name}</h1>
        <p className="mt-2 text-sm uppercase tracking-[0.14em] text-(--color-paper-faint)">{agent.role}</p>
        <p className="mt-6 max-w-2xl text-lg italic leading-relaxed text-(--color-paper-dim)">“{agent.line}”</p>
      </header>

      {/* The refusal is the specification. It goes first. */}
      <section className="mb-10 border-l-2 border-(--color-brass) py-1 pl-5">
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-(--color-brass)">{C.refusal}</div>
        <p className="max-w-2xl text-base leading-relaxed text-(--color-paper)">{agent.refusal}</p>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-(--color-paper-faint)">{C.enforced}</p>
      </section>

      <div className="grid gap-x-8 md:grid-cols-2">
        <Panel title={C.how}>
          <Row label={C.rows.posture}>
            <span style={{ color: agent.posture === 'PROMOTES' ? 'var(--color-brass)' : undefined }}>{C.posture[agent.posture]}</span>
          </Row>
          <Row label={C.rows.cadence}>{absenceLabel(agent)}</Row>
          <Row label={C.rows.sources}>
            <span className="tabular">{agent.sourcesExpected}</span>
          </Row>
          <Row label={C.rows.minimum}>
            <span className="tabular">{agent.minimumSources}</span>
          </Row>
          <Row label={C.rows.producer}>{wired ? C.wired : <span className="absent">{C.notWired}</span>}</Row>
        </Panel>

        <Panel title={C.last}>
          {status === null ? (
            <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
              {C.lastUnread}
            </p>
          ) : status.lastRunAt === null ? (
            <p className="text-sm text-(--color-paper-faint)">{agent.intervalSeconds === null ? C.onRequest : C.neverSeen}</p>
          ) : (
            <>
              <Row label={C.lastRows.ran}>
                <span className="tabular text-xs">{status.lastRunAt}</span>
              </Row>
              <Row label={C.lastRows.age}>
                <span className="tabular">{status.dataAgeSeconds === null ? ABSENT_GLYPH : describeAge(status.dataAgeSeconds)}</span>
              </Row>
              <Row label={C.lastRows.outcome}>
                <span style={{ color: status.lastOutcome ? OUTCOME_COLOUR[status.lastOutcome] : undefined }}>{status.lastOutcome ? AGENTS_COPY.outcome[status.lastOutcome] : ABSENT_GLYPH}</span>
              </Row>
              <Row label={C.lastRows.reached}>
                <span className="tabular">{status.sourcesReached === null ? ABSENT_GLYPH : `${status.sourcesReached} / ${status.sourcesExpected}`}</span>
              </Row>
              {status.detail ? <p className="mt-3 text-xs leading-relaxed text-(--color-paper-faint)">{status.detail}</p> : null}
            </>
          )}
        </Panel>
      </div>

      <Panel title={C.reads}>
        <ul className="space-y-2">
          {agent.reads.map((source) => (
            <li key={source} className="flex gap-3 text-sm text-(--color-paper-dim)">
              <span className="text-(--color-paper-faint)">›</span>
              <span>{source}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={outcomes ? `${C.runs} · ${agentsLine(C.runsLast, { n: outcomes.length })}` : C.runs}>
        {outcomes === null ? (
          <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
            {C.runsUnread}
          </p>
        ) : outcomes.length === 0 ? (
          <p className="text-sm text-(--color-paper-faint)">{C.runsNone}</p>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {(Object.entries(tally ?? {}) as [RunOutcome, number][]).map(([o, n]) => (
                <span key={o}>
                  <span style={{ color: OUTCOME_COLOUR[o] }}>●</span> <span className="uppercase tracking-[0.1em] text-(--color-paper-faint)">{AGENTS_COPY.outcome[o]}</span>{' '}
                  <span className="tabular text-(--color-paper)">{n}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" title="newest first">
              {outcomes.map((h) => (
                <span key={h.runAt} title={`${h.runAt} · ${AGENTS_COPY.outcome[h.outcome]}${h.detail ? ` · ${h.detail}` : ''}`} className="h-3 w-3" style={{ background: OUTCOME_COLOUR[h.outcome] }} />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-(--color-paper-faint)">{C.runsNote}</p>
          </>
        )}
      </Panel>

      <Panel title={C.filings}>
        {publications.state === 'UNREAD' ? (
          <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
            {C.filingsUnread}
          </p>
        ) : publications.value.length === 0 ? (
          <p className="text-sm text-(--color-paper-faint)">{C.filingsNone}</p>
        ) : (
          <div className="divide-y divide-(--color-rule)">
            {publications.value.map((pub) => (
              <details key={pub.id} className="group py-4 first:pt-0">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                  <span className="text-sm tracking-[0.06em] text-(--color-brass) group-open:text-(--color-paper)">{pub.headline}</span>
                  <span className="tabular text-[10px] text-(--color-paper-faint)">{pub.publishedAt.slice(0, 16).replace('T', ' ')} UTC</span>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-(--color-paper-dim)">{pub.body}</pre>
                <Link href={`/gazette/${pub.publishedAt.slice(0, 10)}`} className="mt-2 inline-block text-[11px] text-(--color-paper-faint) underline decoration-(--color-rule) underline-offset-4 hover:text-(--color-paper)">
                  {C.edition} ›
                </Link>
              </details>
            ))}
          </div>
        )}
      </Panel>

      <footer className="border-t border-(--color-rule) pt-6 text-[11px] leading-relaxed text-(--color-paper-faint)">
        {BRAND.name} · {agentsLine(C.footer, { name: agent.name })}
      </footer>
    </main>
  );
}
