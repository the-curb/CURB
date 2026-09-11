import { BRAND } from '@/lib/brand';
import { AGENT_BY_ID, AGENT_COUNTS } from '@/lib/agents/registry';
import { systemHealth, type AgentHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { getStoreAsync } from '@/lib/store';
import { FEED_COVERAGE } from '@/lib/chain/feeds';
import { describePriceAge, phaseLabel, readSession } from '@/lib/market/session';

/**
 * Rendered on every request, never prerendered.
 *
 * Without this, `next build` executed the page once, read the store at build
 * time, and baked that reading into static HTML — a publication headline from
 * the build machine, served forever as if it were current. A dashboard that
 * shows a frozen moment while claiming to be live is the exact lie this page
 * exists to refuse, and the build output said "static" in plain text.
 */
export const dynamic = 'force-dynamic';

/**
 * Six states, six meanings. Fog and darkness are not the same colour, because
 * "we never looked" and "it was expected and never arrived" are not the same
 * fact — and a dashboard that paints them alike is the specific lie this whole
 * system was built to stop telling.
 */
const LIGHTS: Record<AgentHealth, { colour: string; means: string }> = {
  LIVE: { colour: 'var(--color-state-live)', means: 'ran within its interval' },
  STALE: { colour: 'var(--color-state-stale)', means: 'ran, but past its freshness threshold' },
  DEGRADED: { colour: 'var(--color-state-degraded)', means: 'ran, produced nothing publishable' },
  ABSENT: { colour: 'var(--color-state-dark)', means: 'expected, and never arrived' },
  ON_REQUEST: { colour: 'var(--color-state-request)', means: 'no interval — never a fault for staying quiet' },
  NOT_OBSERVED: { colour: 'var(--color-state-fog)', means: 'never looked at — not the same as absent' },
};

function Light({ health }: { health: AgentHealth }) {
  return (
    <span
      className="text-[10px] uppercase tracking-[0.16em] whitespace-nowrap"
      style={{ color: LIGHTS[health].colour }}
      title={LIGHTS[health].means}
    >
      ● {health.replace(/_/g, ' ')}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-[--color-rule] py-2.5 first:border-t-0">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[--color-paper-faint]">
        {label}
      </span>
      <span className="text-sm text-right">{children}</span>
    </div>
  );
}

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12 border border-[--color-rule] bg-[--color-ink-2] p-6 sm:p-8">
      <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">{title}</h2>
      {note ? (
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[--color-paper-dim]">{note}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default async function Home() {
  const now = new Date();
  const session = readSession(now);
  const store = await getStoreAsync();

  const [heartbeatsRead, publicationsRead, blocksRead] = await Promise.all([
    store.latestHeartbeats(),
    store.recentPublications(6),
    store.recentBlocks(5),
  ]);

  /**
   * Null means the store would not answer. Rendering an empty roster here would
   * paint nine agents as never-observed, which reads as a young system rather
   * than a blind one — the exact substitution this page exists to refuse.
   */
  const heartbeats = heartbeatsRead.state === 'UNREAD' ? null : heartbeatsRead.value;
  const publications = publicationsRead.state === 'UNREAD' ? null : publicationsRead.value;
  const blocks = blocksRead.state === 'UNREAD' ? null : blocksRead.value;
  const health = heartbeats === null ? null : systemHealth(heartbeats, now);
  const storeFault =
    heartbeatsRead.state === 'UNREAD'
      ? `${heartbeatsRead.reason}${heartbeatsRead.detail ? ` — ${heartbeatsRead.detail}` : ''}`
      : null;
  const priceAge = describePriceAge(null, session, now);
  const closed = session.phase === 'CLOSED';

  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="mb-14">
        <div className="tracking-mark text-xs text-[--color-brass] sm:text-sm">{BRAND.name}</div>
        <h1 className="mt-8 max-w-3xl text-2xl leading-snug text-[--color-paper] sm:text-4xl sm:leading-tight">
          {BRAND.thesis}
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-[--color-paper-dim]">
          {BRAND.descriptor} {AGENT_COUNTS.measure} agents measure, {AGENT_COUNTS.promote}{' '}
          promotes and declares it, {AGENT_COUNTS.execute} execute. Nothing here places an order.
        </p>
      </header>

      {/* ── THE BELL ──────────────────────────────────────────────────────── */}
      <section className="mb-12 border border-[--color-rule] bg-[--color-ink-2] p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">
            The Bell · session
          </h2>
          <span
            className="text-[11px] uppercase tracking-[0.18em]"
            style={{ color: closed ? 'var(--color-state-closed)' : 'var(--color-state-live)' }}
          >
            ● {phaseLabel(session.phase)}
          </span>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[--color-paper-dim]">
          The chain never closes. The exchange does. Those are not the same clock — and a price
          carried across a closed market is a memory, not a quote.
        </p>

        <div className="mt-6 grid gap-x-12 sm:grid-cols-2">
          <div>
            <Row label="Exchange day (ET)">
              <span className="tabular">{session.calendarDay}</span>
            </Row>
            <Row label="Trading day">{session.isTradingDay ? 'yes' : 'no'}</Row>
            <Row label="Non-trading reason">
              {session.holiday ?? <Absent why="a trading day — no reason to give" />}
            </Row>
            <Row label="Early close">{session.earlyClose ? '13:00 ET' : 'no'}</Row>
          </div>
          <div>
            <Row label="Closed for">
              {session.secondsSinceRegularClose === null ? (
                <Absent why="the market is open — there is no time since close" />
              ) : (
                <span className="tabular">{describeAge(session.secondsSinceRegularClose)}</span>
              )}
            </Row>
            <Row label="Next regular open">
              {session.nextRegularOpenUtc ? (
                <span className="tabular text-xs">{session.nextRegularOpenUtc}</span>
              ) : (
                <Absent why="could not be determined" />
              )}
            </Row>
            <Row label="Last equity price read">
              <Absent why="SOURCE_NOT_CONNECTED — no equity feed address captured" />
            </Row>
            <Row label="Price verdict">
              <span className="text-xs">{priceAge.kind.replace(/_/g, ' ').toLowerCase()}</span>
            </Row>
          </div>
        </div>

        <div className="mt-6 border-t border-[--color-rule] pt-5">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[--color-paper-faint]">
            Declared blind spots
          </div>
          <ul className="space-y-1.5">
            {session.blindSpots.map((spot) => (
              <li key={spot} className="text-xs leading-relaxed text-[--color-paper-faint]">
                — {spot}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── THE WARDEN ────────────────────────────────────────────────────── */}
      <Panel
        title="The Warden · operations"
        note="Three numbers that cannot be faked, printed when they look bad. Sources reached counts what answered on the last run of each agent, against what a healthy run expects."
      >
        {health === null ? (
          <p
            className="text-sm leading-relaxed"
            style={{ color: 'var(--color-state-stale)' }}
          >
            The heartbeat store could not be read ({storeFault}). No agent state is shown, and
            none should be inferred — an unreadable record is not a system where nothing has run.
          </p>
        ) : (
          <>
        <div className="grid gap-x-12 sm:grid-cols-2">
          <div>
            <Row label="Sources reached">
              <span className="tabular">
                {health.sourcesReached} / {health.sourcesExpected}
              </span>
            </Row>
            <Row label="Agents reporting, last hour">
              <span className="tabular">
                {health.reportingLastHour} / {health.agentsTotal}
              </span>
            </Row>
          </div>
          <div>
            <Row label="Oldest input">
              {health.oldestInputAt ? (
                <span className="tabular text-xs">{health.oldestInputAt}</span>
              ) : (
                <Absent why="nothing has been read yet — reported as absent, not as an age of zero" />
              )}
            </Row>
            <Row label="Blocked outputs kept">
              {blocks === null ? (
                <Absent why="the block log could not be read — this is not a count of zero" />
              ) : (
                <span className="tabular">{blocks.length}</span>
              )}
            </Row>
          </div>
        </div>

        <div className="mt-7 border-t border-[--color-rule] pt-5">
          {health.statuses.map((status) => {
            const spec = AGENT_BY_ID[status.id];
            const wired = PRODUCERS[status.id] !== undefined;
            return (
              <div
                key={status.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[--color-rule] py-3 last:border-b-0"
              >
                <div className="min-w-[10rem]">
                  <span className="text-sm tracking-[0.1em] text-[--color-paper]">
                    {status.name}
                  </span>
                  {!wired ? (
                    <span className="ml-3 text-[10px] uppercase tracking-[0.14em] text-[--color-state-fog]">
                      not wired
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-[--color-paper-faint]">{spec.role}</span>
                <span className="tabular text-xs text-[--color-paper-faint]">
                  {status.sourcesReached === null ? (
                    <Absent why="never ran" />
                  ) : (
                    `${status.sourcesReached}/${status.sourcesExpected}`
                  )}
                  {status.dataAgeSeconds === null
                    ? ''
                    : ` · ${describeAge(status.dataAgeSeconds)} ago`}
                </span>
                <Light health={status.health} />
              </div>
            );
          })}
        </div>

        <div className="mt-6 border-t border-[--color-rule] pt-5">
          <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[--color-paper-faint]">
            What the lights mean
          </div>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {(Object.keys(LIGHTS) as AgentHealth[]).map((state) => (
              <div key={state} className="flex items-baseline gap-3 text-xs">
                <span style={{ color: LIGHTS[state].colour }}>●</span>
                <span className="w-28 shrink-0 uppercase tracking-[0.12em] text-[--color-paper-dim]">
                  {state.replace(/_/g, ' ')}
                </span>
                <span className="text-[--color-paper-faint]">{LIGHTS[state].means}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[--color-paper-faint]">
            A reading we could not take goes into fog, never into darkness. Dark already means
            expected and never arrived.
          </p>
        </div>
          </>
        )}
      </Panel>

      {/* ── THE WIRE ──────────────────────────────────────────────────────── */}
      <Panel
        title="The wire · what the agents published"
        note="Every line below passed provenance and policy before it was written. Nothing is summarised here; this is the output itself."
      >
        {publications === null ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
            The publication log could not be read. Nothing is shown, and nothing should be read
            into that — this is not a wire with no traffic on it.
          </p>
        ) : publications.length === 0 ? (
          <p className="text-sm text-[--color-paper-faint]">
            Nothing published yet. That is an absence of output, not an absence of agents — the
            lights above say which.
          </p>
        ) : (
          <div className="space-y-6">
            {publications.map((pub) => (
              <article key={pub.id} className="border-t border-[--color-rule] pt-5 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-sm tracking-[0.1em] text-[--color-brass]">{pub.headline}</h3>
                  <span className="tabular text-[10px] text-[--color-paper-faint]">
                    {AGENT_BY_ID[pub.agentId].name} · {pub.publishedAt}
                  </span>
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[--color-paper-dim]">
                  {pub.body}
                </pre>
                {pub.figures.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-[--color-paper-faint]">
                      {pub.figures.length} declared figures, with provenance
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {pub.figures.map((f) => (
                        <li key={`${f.token}-${f.source}`} className="tabular text-[11px] text-[--color-paper-faint]">
                          {f.token} — {f.source} @ {f.retrievedAt}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Panel>

      {/* ── COVERAGE ──────────────────────────────────────────────────────── */}
      <Panel
        title="Coverage · what is not here"
        note="Stated so it cannot be mistaken for completeness. A registry that shows only what it holds looks finished; this one shows the gap."
      >
        <Row label="Price feeds in the vendor directory">
          <span className="tabular">{FEED_COVERAGE.listedByDirectory}</span>
        </Row>
        <Row label="Feeds captured here">
          <span className="tabular">{FEED_COVERAGE.capturedHere}</span>
        </Row>
        <Row label="Tokenized-equity feeds captured">
          <Absent why="SOURCE_NOT_CONNECTED — no equity feed address has been read from the directory" />
        </Row>
        <Row label="Sequencer uptime check">
          <Absent why="no sequencer feed configured — not checked, which is not the same as up" />
        </Row>
        <Row label="Agents wired">
          <span className="tabular">
            {Object.keys(PRODUCERS).length} / {AGENT_COUNTS.total}
          </span>
        </Row>
      </Panel>

      <footer className="border-t border-[--color-rule] pt-6 text-xs leading-relaxed text-[--color-paper-faint]">
        <p>
          A figure that could not be read is shown as absent, with its reason — never as zero.
          Below a stated minimum of sources no reading is declared at all: that is unknown, and it
          is not the same as neutral. {RULE_COUNT} publication rules run in code before anything
          reaches a channel, not asked for in a prompt.
        </p>
        <p className="mt-4">
          Nothing here is investment, legal or tax advice. No agent touches a venue and none of
          them places an order.
        </p>
      </footer>
    </main>
  );
}
