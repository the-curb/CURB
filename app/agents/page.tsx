import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { AGENTS, AGENT_COUNTS } from '@/lib/agents/registry';
import { systemHealth, type AgentHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The agents' };

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
        <div className="tracking-mark text-xs text-(--color-brass)">THE AGENTS</div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">
          {AGENT_COUNTS.total} agents, one job each. What each refuses to do is as defined as what it does.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-(--color-paper-dim)">
          {AGENT_COUNTS.measure} measure. {AGENT_COUNTS.promote} promotes, and says so in every post.
          {' '}{AGENT_COUNTS.execute} execute — nothing here touches a venue or places an order.
          None of them answers outside its own trade.
        </p>
        {health === null ? (
          <p className="mt-4 text-xs" style={{ color: 'var(--color-state-stale)' }}>
            The heartbeat store could not be read, so no light is shown. That is not a roster of
            idle agents.
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
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.id}`}
                    className="group block bg-(--color-ink-2) p-5 transition-colors hover:bg-(--color-ink-3)"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm tracking-[0.14em] text-(--color-paper) group-hover:text-(--color-brass)">
                        {agent.name}
                      </h3>
                      {status ? (
                        <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: LIGHT[status.health] }}>
                          ● {status.health.replace(/_/g, ' ')}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-(--color-paper-faint)">
                      {agent.role}
                      {!wired ? ' · not wired' : ''}
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
