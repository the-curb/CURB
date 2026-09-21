import { DeskNav } from '../components/desk-nav';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { AGENTS, AGENT_COUNTS } from '@/lib/agents/registry';
import { systemHealth, type AgentHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { getStoreAsync } from '@/lib/store';
import { AGENTS_COPY as C, agentsLine } from '@/lib/copy/agents';

export const dynamic = 'force-dynamic';
export const metadata = { title: C.index.title, description: C.index.description };

const LIGHT: Record<AgentHealth, string> = {
  LIVE: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  DEGRADED: 'var(--color-state-degraded)',
  ABSENT: 'var(--color-state-dark)',
  ON_REQUEST: 'var(--color-state-request)',
  NOT_OBSERVED: 'var(--color-state-fog)',
};

export default async function AgentsIndex() {
  const now = new Date();
  const store = await getStoreAsync();
  const heartbeats = await store.latestHeartbeats();
  const health = heartbeats.state === 'UNREAD' ? null : systemHealth(heartbeats.value, now);
  const statusOf = (id: string) => health?.statuses.find((s) => s.id === id) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-12">
        <DeskNav current="THE AGENTS" />
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{agentsLine(C.index.headline, { total: AGENT_COUNTS.total })}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">
          {agentsLine(C.index.sub, { measure: AGENT_COUNTS.measure, promote: AGENT_COUNTS.promote })}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-paper-faint)">{C.index.refusals}</p>
        {health === null ? (
          <p className="mt-4 text-xs" style={{ color: 'var(--color-state-stale)' }}>
            {C.index.unread}
          </p>
        ) : null}
      </header>

      {BRAND.universe.districts.map((district) => {
        const here = AGENTS.filter((a) => a.district === district.name);
        if (here.length === 0) return null;
        return (
          <section key={district.id} className="mb-10">
            <div className="mb-3 flex items-baseline gap-4">
              <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-brass)">{district.name}</h2>
              <span className="text-[10px] text-(--color-paper-faint)">{district.holds}</span>
            </div>
            <div className="grid gap-px border border-(--color-rule) bg-(--color-rule) sm:grid-cols-2">
              {here.map((agent) => {
                const status = statusOf(agent.id);
                const wired = PRODUCERS[agent.id] !== undefined;
                return (
                  <Link key={agent.id} href={`/agents/${agent.id}`} className="group block bg-(--color-ink-2) p-5 transition-colors hover:bg-(--color-ink-3)">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm tracking-[0.14em] text-(--color-paper) group-hover:text-(--color-brass)">{agent.name}</h3>
                      {status ? (
                        <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: LIGHT[status.health] }}>
                          ● {C.health[status.health]}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-(--color-paper-faint)">
                      {agent.role}
                      {!wired ? ` · ${C.index.notWired}` : ''}
                    </p>
                    <p className="mt-3 text-sm italic leading-relaxed text-(--color-paper-dim)">“{agent.line}”</p>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
