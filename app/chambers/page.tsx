import { DeskNav } from '../components/desk-nav';
import { systemHealth } from '@/lib/agents/health';
import { NEVER_DETERMINED } from '@/lib/chain/terms';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { deriveConditions, type Condition } from '@/lib/ops/alerts';
import { composeWatchTable, type WatchTable } from '@/lib/terms/table';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chambers' };

/**
 * CHAMBERS — eligibility, rights, change control. Two desks share the room:
 * Counsel, which points at the published terms and watches them for change
 * without reading them for meaning, and the Warden, which prints the three
 * numbers it cannot fake and the conditions a person should know about.
 */

const STATE: Record<WatchTable['sampleState'], { colour: string; label: string; means: string }> = {
  VERIFIED: { colour: 'var(--color-state-live)', label: 'current', means: 'Counsel fetched the pages within its interval' },
  STALE: { colour: 'var(--color-state-stale)', label: 'stale', means: 'Counsel has not fetched within its freshness threshold' },
  ABSENT: { colour: 'var(--color-state-dark)', label: 'counsel absent', means: 'Counsel was expected and has not reported' },
  NONE: { colour: 'var(--color-state-fog)', label: 'not yet watched', means: 'Counsel has never written a watch to this store' },
};

const SEVERITY: Record<Condition['severity'], string> = {
  DARK: 'var(--color-state-dark)',
  STALE: 'var(--color-state-stale)',
  NOTE: 'var(--color-state-request)',
};

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-(--color-rule) py-2.5 first:border-t-0">
      <span className="text-[11px] uppercase tracking-[0.16em] text-(--color-paper-faint)">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

export default async function ChambersPage() {
  const now = new Date();
  const store = await getStoreAsync();
  const [terms, heartbeats, feeds, registrar, head, drift, positionSnaps, evidenceSnaps, creditsRun, creditsCode, tokenSnaps] = await Promise.all([
    store.snapshots('terms:'),
    store.latestHeartbeats(),
    store.snapshots('feed:'),
    store.publicationsByAgent('registrar', 1),
    store.snapshots('chain:head'),
    store.snapshots('capture:drift'),
    store.snapshots('positions:'),
    store.snapshots('evidence:'),
    store.snapshots('credits:run'),
    store.snapshots('credits:code'),
    store.snapshots('token:'),
  ]);

  const table = terms.state === 'UNREAD' ? null : composeWatchTable(terms.value, now);
  const health = heartbeats.state === 'UNREAD' ? null : systemHealth(heartbeats.value, now);
  const conditions = deriveConditions({
    heartbeats: heartbeats.state === 'UNREAD' ? null : heartbeats.value,
    feedSnapshots: feeds.state === 'UNREAD' ? null : feeds.value,
    feedSnapshotsFault: feeds.state === 'UNREAD' ? `${feeds.reason}${feeds.detail ? ` — ${feeds.detail}` : ''}` : null,
    lastRegistrar: registrar.state === 'UNREAD' ? null : (registrar.value[0] ?? null),
    headSnapshot: head.state === 'UNREAD' ? null : (head.value.find((s) => s.key === 'chain:head') ?? null),
    driftSnapshot: drift.state === 'UNREAD' ? null : (drift.value.find((s) => s.key === 'capture:drift') ?? null),
    tokenSnapshots: tokenSnaps.state === 'UNREAD' ? null : tokenSnaps.value,
    positionSnapshots: [
      ...(positionSnaps.state === 'UNREAD' ? [] : positionSnaps.value),
      ...(evidenceSnaps.state === 'UNREAD' ? [] : evidenceSnaps.value.filter((s) => s.key.endsWith(':latest'))),
      ...(creditsRun.state === 'UNREAD' ? [] : creditsRun.value),
      ...(creditsCode.state === 'UNREAD' ? [] : creditsCode.value),
    ],
    now,
  });
  const alerting = process.env.CURB_ALERT_WEBHOOK ? 'configured' : 'not configured';
  const state = table === null ? null : STATE[table.sampleState];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">

      <header className="mb-10">
        <DeskNav current="CHAMBERS" />
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">
          The terms, pointed at and watched. The system, with its three numbers showing.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-(--color-paper-dim)">
          Counsel can read you the terms; it cannot tell you they apply to you. What it can do is fetch each page every day,
          hash its visible text, and say whether that hash changed. What changed is the page to read.
        </p>
      </header>

      {/* ── THE TERMS ─────────────────────────────────────────────────────── */}
      <section className="mb-10 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">The register, watched</h2>
          {state && table ? (
            <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: state.colour }} title={state.means}>
              ● {state.label}
              {table.sampleAgeSeconds === null ? '' : ` · fetched ${describeAge(table.sampleAgeSeconds)} ago`}
            </span>
          ) : null}
        </div>
        {table === null ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--color-state-stale)' }}>
            The watch store could not be read ({terms.state === 'UNREAD' ? terms.reason : ''}). No table is drawn.
          </p>
        ) : (
          <>
            <p className="mt-4 tabular text-[11px] text-(--color-paper-faint)">
              {table.counts.read} read for meaning · {table.counts.linkOnly} held as links · {table.counts.watched} watched ·{' '}
              {table.counts.changed} changed since first seen
            </p>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
                    <th className="pb-2 pr-4 font-normal">Page</th>
                    <th className="pb-2 pr-4 font-normal">Authority for</th>
                    <th className="pb-2 pr-4 font-normal">Register</th>
                    <th className="pb-2 pr-4 font-normal">First seen</th>
                    <th className="pb-2 pr-4 font-normal">Last changed</th>
                    <th className="pb-2 pr-4 text-right font-normal">Chars</th>
                    <th className="pb-2 text-right font-normal">Fetched</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row.source.key} className="border-t border-(--color-rule)">
                      <td className="py-2 pr-4 align-baseline">
                        <a href={row.source.url} className="text-sm text-(--color-paper) hover:text-(--color-brass)" rel="noopener noreferrer" target="_blank">
                          {row.source.title}
                        </a>
                      </td>
                      <td className="py-2 pr-4 align-baseline text-xs text-(--color-paper-dim)">{row.source.covers}</td>
                      <td className="py-2 pr-4 align-baseline text-xs">
                        {row.source.state === 'READ' ? (
                          <span className="text-(--color-paper-dim)" title={`recorded ${row.source.readAt}: ${row.source.recorded}`}>read {row.source.readAt?.slice(0, 10)}</span>
                        ) : (
                          <span className="text-(--color-paper-faint)">link only</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 align-baseline text-xs text-(--color-paper-dim)">
                        {row.watch === null ? <Absent why={row.unreadBecause ?? 'not watched'} /> : <span className="tabular">{row.watch.firstSeenAt.slice(0, 10)}</span>}
                      </td>
                      <td className="py-2 pr-4 align-baseline text-xs">
                        {row.watch === null ? (
                          <Absent why={row.unreadBecause ?? 'not watched'} />
                        ) : row.watch.lastChangedAt === null ? (
                          <span className="text-(--color-paper-faint)">unchanged</span>
                        ) : (
                          <span className="tabular" style={{ color: 'var(--color-brass)' }} title={`${row.watch.changes} change(s) seen`}>
                            {row.watch.lastChangedAt.slice(0, 10)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-faint)">
                        {row.watch === null ? <Absent why={row.unreadBecause ?? 'not watched'} /> : <span className="tabular">{row.watch.chars.toLocaleString('en-US')}</span>}
                      </td>
                      <td className="py-2 text-right align-baseline text-xs text-(--color-paper-faint)">
                        {row.sampleAgeSeconds === null ? <Absent why="not yet fetched" /> : <span className="tabular">{describeAge(row.sampleAgeSeconds)} ago</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="mt-6 border-t border-(--color-rule) pt-5">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">Never determined here</div>
          <ul className="space-y-1.5">
            {NEVER_DETERMINED.map((line) => (
              <li key={line} className="text-xs leading-relaxed text-(--color-paper-faint)">
                — {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── THE WARDEN ────────────────────────────────────────────────────── */}
      <section className="mb-10 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">Change control · what a person should know now</h2>
        {health === null ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--color-state-stale)' }}>
            The heartbeat store could not be read. No numbers are shown, and none should be inferred.
          </p>
        ) : (
          <div className="mt-6 grid gap-x-12 sm:grid-cols-2">
            <div>
              <Row label="Sources reached">
                <span className="tabular">{health.sourcesReached} / {health.sourcesExpected}</span>
              </Row>
              <Row label="Agents reporting, last hour">
                <span className="tabular">{health.reportingLastHour} / {health.agentsTotal}</span>
              </Row>
            </div>
            <div>
              <Row label="Oldest input">
                {health.oldestInputAt ? <span className="tabular text-xs">{health.oldestInputAt}</span> : <Absent why="nothing has been read yet" />}
              </Row>
              <Row label="Alert delivery">
                <span className="text-xs">{alerting}</span>
              </Row>
            </div>
          </div>
        )}
        <div className="mt-6 border-t border-(--color-rule) pt-5">
          <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">
            Active conditions · {conditions.length === 0 ? 'none — every condition was checked' : conditions.length}
          </div>
          {conditions.length > 0 ? (
            <ul className="space-y-2">
              {conditions.map((c) => (
                <li key={c.id} className="flex items-baseline gap-3 text-xs leading-relaxed">
                  <span style={{ color: SEVERITY[c.severity] }}>●</span>
                  <span className="text-(--color-paper-dim)">
                    <span className="tabular text-(--color-paper-faint)">{c.id}</span> — {c.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed text-(--color-paper-faint)">
            The same set is derived after every tick and compared with the set last delivered; what was raised or cleared is
            posted once to the webhook when one is configured. A condition that persists is not re-sent. What alerting cannot
            notice is a scheduler that has stopped: that is the reporting count above going to zero, watched from outside.
          </p>
        </div>
      </section>
    </main>
  );
}
