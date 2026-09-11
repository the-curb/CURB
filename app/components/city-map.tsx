import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { AGENTS } from '@/lib/agents/registry';
import type { AgentHealth } from '@/lib/agents/health';

/**
 * The city, as a map. Six districts, each holding a part of the record; the
 * agents that work there; where to go to read it. A district's light is the
 * worst light of any agent in it — a district with one absent agent is not a
 * district where everything is fine.
 */

const WHERE: Record<string, string> = {
  floor: '/#floor',
  registry: '/registry',
  vault: '/vault',
  chambers: '/chambers',
  press: '/gazette',
  cage: '/agents/herald',
};

const SEVERITY: Record<AgentHealth, number> = {
  LIVE: 0,
  ON_REQUEST: 0,
  STALE: 1,
  DEGRADED: 2,
  NOT_OBSERVED: 2,
  ABSENT: 3,
};

const COLOUR: Record<AgentHealth, string> = {
  LIVE: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  DEGRADED: 'var(--color-state-degraded)',
  ABSENT: 'var(--color-state-dark)',
  ON_REQUEST: 'var(--color-state-request)',
  NOT_OBSERVED: 'var(--color-state-fog)',
};

export function CityMap({ healthById }: { healthById: Readonly<Record<string, AgentHealth>> | null }) {
  return (
    <section className="mb-12">
      <div className="mb-3 flex items-baseline gap-4">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">{BRAND.universe.city} · the districts</h2>
        <span className="text-[10px] text-[--color-paper-faint]">six parts of one record</span>
      </div>
      <div className="grid gap-px border border-[--color-rule] bg-[--color-rule] sm:grid-cols-3">
        {BRAND.universe.districts.map((district) => {
          const here = AGENTS.filter((a) => a.district === district.name);
          const worst =
            healthById === null
              ? null
              : here.reduce<AgentHealth | null>((acc, a) => {
                  const h = healthById[a.id];
                  if (!h) return acc;
                  return acc === null || SEVERITY[h] > SEVERITY[acc] ? h : acc;
                }, null);
          return (
            <Link
              key={district.id}
              href={WHERE[district.id] ?? '/'}
              className="group block bg-[--color-ink-2] p-5 transition-colors hover:bg-[--color-ink-3]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] uppercase tracking-[0.24em] text-[--color-brass]">{district.name}</span>
                {here.length === 0 ? (
                  <span className="text-[10px] text-[--color-paper-faint]" title="no agent works here; this district is composed from the record">○</span>
                ) : worst === null ? (
                  <span className="text-[10px] text-[--color-state-fog]" title="the heartbeat store could not be read">●</span>
                ) : (
                  <span className="text-[10px]" style={{ color: COLOUR[worst] }} title={`worst light in the district: ${worst.replace(/_/g, ' ').toLowerCase()}`}>
                    ●
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[--color-paper-dim]">{district.holds}</p>
              <p className="mt-3 text-[10px] uppercase tracking-[0.14em] text-[--color-paper-faint]">
                {here.length === 0 ? 'composed from the record · narrated under the same gate' : here.map((a) => a.name).join(' · ')}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
