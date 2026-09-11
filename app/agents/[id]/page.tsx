import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { AGENTS, AGENT_BY_ID, absenceLabel, type AgentId } from '@/lib/agents/registry';
import { statusOf, type AgentHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { getStoreAsync } from '@/lib/store';
import type { RunOutcome } from '@/lib/store/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

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
    <div className="flex items-baseline justify-between gap-6 border-t border-[--color-rule] py-2.5 first:border-t-0">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[--color-paper-faint]">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 border border-[--color-rule] bg-[--color-ink-2] p-6 sm:p-8">
      <h2 className="mb-5 text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">{title}</h2>
      {children}
    </section>
  );
}

export default async function AgentPage(props: { params: Params }) {
  const { id } = await props.params;
  if (!isAgentId(id)) notFound();

  const agent = AGENT_BY_ID[id];
  const now = new Date();
  const store = await getStoreAsync();
  const [latest, publications, runs] = await Promise.all([
    store.latestHeartbeat(id),
    store.publicationsByAgent(id, 8),
    store.heartbeatsByAgent(id, 40),
  ]);

  const status = latest.state === 'UNREAD' ? null : statusOf(agent, latest.value, now);
  const wired = PRODUCERS[id] !== undefined;
  const index = AGENTS.findIndex((a) => a.id === id);
  const prev = AGENTS[(index - 1 + AGENTS.length) % AGENTS.length]!;
  const next = AGENTS[(index + 1) % AGENTS.length]!;

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
          <div className="tracking-mark text-xs text-[--color-brass]">{agent.district}</div>
          {status ? (
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: LIGHT[status.health] }}>
              ● {status.health.replace(/_/g, ' ')}
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-state-stale)' }}>
              ● state unreadable
            </span>
          )}
        </div>
        <h1 className="mt-4 text-3xl tracking-[0.12em] text-[--color-paper] sm:text-4xl">{agent.name}</h1>
        <p className="mt-2 text-sm uppercase tracking-[0.14em] text-[--color-paper-faint]">{agent.role}</p>
        <p className="mt-6 max-w-2xl text-lg italic leading-relaxed text-[--color-paper-dim]">“{agent.line}”</p>
      </header>

      {/* The refusal is the specification. It goes first. */}
      <section className="mb-10 border-l-2 border-[--color-brass] py-1 pl-5">
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[--color-brass]">What it will not do</div>
        <p className="max-w-2xl text-base leading-relaxed text-[--color-paper]">{agent.refusal}</p>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[--color-paper-faint]">
          Enforced in code before publication, not asked for in a prompt. An output that breaks it is
          stopped and kept as an event, and this agent&apos;s heartbeat records the block.
        </p>
      </section>

      <div className="grid gap-x-8 md:grid-cols-2">
        <Panel title="Specification">
          <Row label="Posture">
            <span style={{ color: agent.posture === 'PROMOTES' ? 'var(--color-brass)' : undefined }}>{agent.posture}</span>
          </Row>
          <Row label="Cadence">{absenceLabel(agent)}</Row>
          <Row label="Sources expected">
            <span className="tabular">{agent.sourcesExpected}</span>
          </Row>
          <Row label="Declares unknown below">
            <span className="tabular">{agent.minimumSources}</span>
          </Row>
          <Row label="Producer">{wired ? 'wired' : <span className="absent">not wired</span>}</Row>
        </Panel>

        <Panel title="Last run">
          {status === null ? (
            <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>
              The heartbeat store could not be read. Nothing here is inferred from that.
            </p>
          ) : status.lastRunAt === null ? (
            <p className="text-sm text-[--color-paper-faint]">
              {agent.intervalSeconds === null
                ? 'On request. It has not been asked yet — which is not a fault.'
                : 'Never observed. Not the same as absent: it was never looked at.'}
            </p>
          ) : (
            <>
              <Row label="Ran">
                <span className="tabular text-xs">{status.lastRunAt}</span>
              </Row>
              <Row label="Age">
                <span className="tabular">{status.dataAgeSeconds === null ? ABSENT_GLYPH : describeAge(status.dataAgeSeconds)}</span>
              </Row>
              <Row label="Outcome">
                <span style={{ color: status.lastOutcome ? OUTCOME_COLOUR[status.lastOutcome] : undefined }}>
                  {status.lastOutcome?.replace(/_/g, ' ') ?? ABSENT_GLYPH}
                </span>
              </Row>
              <Row label="Sources reached">
                <span className="tabular">
                  {status.sourcesReached === null ? ABSENT_GLYPH : `${status.sourcesReached} / ${status.sourcesExpected}`}
                </span>
              </Row>
              {status.detail ? (
                <p className="mt-3 text-xs leading-relaxed text-[--color-paper-faint]">{status.detail}</p>
              ) : null}
            </>
          )}
        </Panel>
      </div>

      <Panel title="Reads from">
        <ul className="space-y-2">
          {agent.reads.map((source) => (
            <li key={source} className="flex gap-3 text-sm text-[--color-paper-dim]">
              <span className="text-[--color-paper-faint]">›</span>
              <span>{source}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`Recent runs${outcomes ? ` · last ${outcomes.length}` : ''}`}>
        {outcomes === null ? (
          <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>The run history could not be read.</p>
        ) : outcomes.length === 0 ? (
          <p className="text-sm text-[--color-paper-faint]">No runs recorded.</p>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {(Object.entries(tally ?? {}) as [RunOutcome, number][]).map(([o, n]) => (
                <span key={o}>
                  <span style={{ color: OUTCOME_COLOUR[o] }}>●</span>{' '}
                  <span className="uppercase tracking-[0.1em] text-[--color-paper-faint]">{o.replace(/_/g, ' ').toLowerCase()}</span>{' '}
                  <span className="tabular text-[--color-paper]">{n}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" title="newest first">
              {outcomes.map((h) => (
                <span
                  key={h.runAt}
                  title={`${h.runAt} · ${h.outcome}${h.detail ? ` · ${h.detail}` : ''}`}
                  className="h-3 w-3"
                  style={{ background: OUTCOME_COLOUR[h.outcome] }}
                />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-[--color-paper-faint]">
              One square per run, newest first. Every outcome is here, including the ones that produced nothing — an agent that fails quietly must not look like one with nothing to say.
            </p>
          </>
        )}
      </Panel>

      <Panel title="Recent filings">
        {publications.state === 'UNREAD' ? (
          <p className="text-sm" style={{ color: 'var(--color-state-stale)' }}>The filings could not be read.</p>
        ) : publications.value.length === 0 ? (
          <p className="text-sm text-[--color-paper-faint]">Nothing filed yet.</p>
        ) : (
          <div className="space-y-6">
            {publications.value.map((pub) => (
              <article key={pub.id} className="border-t border-[--color-rule] pt-5 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-sm tracking-[0.1em] text-[--color-brass]">{pub.headline}</h3>
                  <Link href={`/gazette/${pub.publishedAt.slice(0, 10)}`} className="tabular text-[10px] text-[--color-paper-faint] hover:text-[--color-paper]">
                    {pub.publishedAt} › edition
                  </Link>
                </div>
                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[--color-paper-dim]">{pub.body}</pre>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <footer className="border-t border-[--color-rule] pt-6 text-[11px] leading-relaxed text-[--color-paper-faint]">
        {BRAND.name} · {agent.name} answers only within its own trade. Ask it about something else and it
        sends you to the agent whose trade that is.
      </footer>
    </main>
  );
}
