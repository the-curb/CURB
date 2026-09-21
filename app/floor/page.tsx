import { DeskNav } from '../components/desk-nav';
import { AGENT_BY_ID, AGENT_COUNTS } from '@/lib/agents/registry';
import { systemHealth, type AgentHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { getStoreAsync } from '@/lib/store';
import { FEED_COVERAGE, SEQUENCER_FEED, STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { describePriceAge, readSession, type SessionPhase } from '@/lib/market/session';
import { composeBoard } from '@/lib/floor/board';
import { FLOOR } from '@/lib/copy/floor';
import { FloorBoard } from '../components/floor-board';

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
export const metadata = { title: FLOOR.title };

/**
 * The Floor opens on the board, because the board is what a reader came for.
 * Every word is from `lib/copy/floor.ts`; every figure is from the record,
 * with its age, and a dash when it was not read. The agents' filings are kept
 * word for word, one click away, rather than printed in full in the way.
 */

/**
 * Six states, six meanings. Fog and darkness are not the same colour, because
 * "we never looked" and "it was expected and never arrived" are not the same
 * fact — and a dashboard that paints them alike is the specific lie this whole
 * system was built to stop telling.
 */
const LIGHTS: Record<AgentHealth, { colour: string; means: string }> = {
  LIVE: { colour: 'var(--color-state-live)', means: 'ran on schedule' },
  STALE: { colour: 'var(--color-state-stale)', means: 'ran, but later than it should' },
  DEGRADED: { colour: 'var(--color-state-degraded)', means: 'ran, but had nothing it could publish' },
  ABSENT: { colour: 'var(--color-state-dark)', means: 'expected, and did not run' },
  ON_REQUEST: { colour: 'var(--color-state-request)', means: 'runs only when asked' },
  NOT_OBSERVED: { colour: 'var(--color-state-fog)', means: 'never seen yet — not the same as absent' },
};

const PHASE_WORDS: Record<SessionPhase, string> = { REGULAR: 'open', PRE: 'pre-market', POST: 'after hours', CLOSED: 'closed' };

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const NBSP = ' ';
const etTime = (iso: string) => `${ET.format(new Date(iso)).replace(/ /g, NBSP)}${NBSP}ET`;

function Light({ health }: { health: AgentHealth }) {
  return (
    <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.16em]" style={{ color: LIGHTS[health].colour }} title={LIGHTS[health].means}>
      ● {health.replace(/_/g, ' ')}
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

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function Panel({ id, title, note, children }: { id?: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
      <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">{title}</h2>
      {note ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">{note}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default async function FloorPage() {
  const now = new Date();
  const session = readSession(now);
  const store = await getStoreAsync();

  const [heartbeatsRead, publicationsRead, countsRead, feedSnapshots, headSnapshots, poolSnapshots] = await Promise.all([
    store.latestHeartbeats(),
    store.recentPublications(6),
    // The store's own count of blocked outputs, not the length of a bounded
    // read: a window of five is five forever once the record passes it, and
    // printing that under "three numbers that cannot be faked" would be
    // publishing a floor as a total.
    store.recordCounts(),
    store.snapshots('feed:'),
    store.snapshots('chain:head'),
    store.snapshots('pool:'),
  ]);
  // The chain head as the Pillar last read it. Checked field by field: it is stored JSON.
  const headRow = headSnapshots.state === 'UNREAD' ? null : (headSnapshots.value.find((sn) => sn.key === 'chain:head') ?? null);
  const chainHead =
    headRow && typeof headRow.payload.number === 'number' && typeof headRow.payload.ageSeconds === 'number'
      ? {
          number: headRow.payload.number,
          ageSeconds: headRow.payload.ageSeconds,
          stalled: headRow.payload.stalled === true,
          sampleAgeSeconds: Math.max(0, Math.round((now.getTime() - new Date(headRow.observedAt).getTime()) / 1000)),
        }
      : null;

  /**
   * Null means the store would not answer. Rendering an empty roster here would
   * paint every agent as never-observed, which reads as a young system rather
   * than a blind one — the exact substitution this page exists to refuse.
   */
  const heartbeats = heartbeatsRead.state === 'UNREAD' ? null : heartbeatsRead.value;
  const publications = publicationsRead.state === 'UNREAD' ? null : publicationsRead.value;
  const counts = countsRead.state === 'UNREAD' ? null : countsRead.value;
  const health = heartbeats === null ? null : systemHealth(heartbeats, now);
  const storeFault = heartbeatsRead.state === 'UNREAD' ? `${heartbeatsRead.reason}${heartbeatsRead.detail ? ` — ${heartbeatsRead.detail}` : ''}` : null;
  const board = feedSnapshots.state === 'UNREAD' ? null : composeBoard(feedSnapshots.value, now, poolSnapshots.state === 'UNREAD' ? [] : poolSnapshots.value);
  const boardFault = feedSnapshots.state === 'UNREAD' ? `${feedSnapshots.reason}${feedSnapshots.detail ? ` — ${feedSnapshots.detail}` : ''}` : null;
  // The freshest equity sample on the board is the last equity price this
  // system read. Its verdict is judged against the session, like every price.
  const freshestEquity =
    board?.equity
      .filter((r) => r.price !== null)
      .reduce<(typeof board.equity)[number] | null>((best, r) => (best === null || r.sampleAgeSeconds < best.sampleAgeSeconds ? r : best), null) ?? null;
  const priceAge = describePriceAge(freshestEquity ? new Date(freshestEquity.sampledAt) : null, session, now);
  const closed = session.phase === 'CLOSED';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
      <div className="mb-8">
        <DeskNav current="THE FLOOR" />
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{FLOOR.headline}</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-(--color-paper-dim)">{FLOOR.sub}</p>
        <p className="tabular mt-4 text-[12px]" style={{ color: closed ? 'var(--color-state-closed)' : 'var(--color-state-live)' }}>
          ● US stock market: {PHASE_WORDS[session.phase]}
          {session.nextRegularOpenUtc && closed ? (
            <>
              {' · '}
              <span className="whitespace-nowrap">opens {etTime(session.nextRegularOpenUtc)}</span>
            </>
          ) : null}
        </p>
      </div>

      {/* ── THE BOARD ─────────────────────────────────────────────────────── */}
      <section id="floor" className="mb-10 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
        {closed ? <p className="mb-5 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">{FLOOR.closedNote}</p> : null}
        <FloorBoard board={board} unreadable={boardFault} />

        <div className="mt-8 border-t border-(--color-rule) pt-6">
          <div className="text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">{FLOOR.legend.kicker}</div>
          <dl className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {FLOOR.legend.items.map((item) => (
              <div key={item.term}>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-(--color-paper)">{item.term}</dt>
                <dd className="mt-0.5 text-[13px] leading-relaxed text-(--color-paper-dim)">{item.means}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-(--color-paper-faint)">{FLOOR.legend.star}</p>
        </div>
      </section>

      {/* ── THE BELL ──────────────────────────────────────────────────────── */}
      <Panel title={FLOOR.bell.kicker} note={FLOOR.bell.intro}>
        <div className="grid gap-x-12 sm:grid-cols-2">
          <div>
            <Row label={FLOOR.bell.rows.day}>
              <span className="tabular">{session.calendarDay}</span>
            </Row>
            <Row label={FLOOR.bell.rows.tradingDay}>{session.isTradingDay ? 'yes' : 'no'}</Row>
            <Row label={FLOOR.bell.rows.why}>{session.holiday ?? <Absent why="A trading day, so there is no reason to give." />}</Row>
            <Row label={FLOOR.bell.rows.earlyClose}>{session.earlyClose ? '13:00 ET' : 'no'}</Row>
          </div>
          <div>
            <Row label={FLOOR.bell.rows.closedFor}>
              {session.secondsSinceRegularClose === null ? <Absent why="The market is open." /> : <span className="tabular">{describeAge(session.secondsSinceRegularClose)}</span>}
            </Row>
            <Row label={FLOOR.bell.rows.opens}>
              {session.nextRegularOpenUtc ? <span className="tabular text-xs">{etTime(session.nextRegularOpenUtc)}</span> : <Absent why="Could not be worked out." />}
            </Row>
            <Row label={FLOOR.bell.rows.lastRead}>
              {freshestEquity === null ? (
                <Absent why={board === null ? 'The record could not be read.' : 'No stock price has been read yet.'} />
              ) : (
                <span className="tabular text-xs">
                  {freshestEquity.label} · {describeAge(freshestEquity.sampleAgeSeconds)} ago
                </span>
              )}
            </Row>
            <Row label={FLOOR.bell.rows.status}>
              <span className="text-xs">{FLOOR.bell.status[priceAge.kind]}</span>
            </Row>
          </div>
        </div>
        <details className="mt-6 border-t border-(--color-rule) pt-4">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">
            {FLOOR.bell.blindSpots} · {session.blindSpots.length}
          </summary>
          <ul className="mt-3 space-y-1.5">
            {session.blindSpots.map((spot) => (
              <li key={spot} className="text-xs leading-relaxed text-(--color-paper-faint)">
                — {spot}
              </li>
            ))}
          </ul>
        </details>
      </Panel>

      {/* ── THE WARDEN ────────────────────────────────────────────────────── */}
      <Panel title={FLOOR.warden.kicker} note={FLOOR.warden.intro}>
        {health === null ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }} title={storeFault ?? undefined}>
            {FLOOR.warden.unreadable}
          </p>
        ) : (
          <>
            <div className="grid gap-x-12 sm:grid-cols-2">
              <div>
                <Row label={FLOOR.warden.rows.sources}>
                  <span className="tabular">
                    {health.sourcesReached} / {health.sourcesExpected}
                  </span>
                </Row>
                <Row label={FLOOR.warden.rows.reporting}>
                  <span className="tabular">
                    {health.reportingLastHour} / {health.agentsTotal}
                  </span>
                </Row>
              </div>
              <div>
                <Row label={FLOOR.warden.rows.oldest}>
                  {health.oldestInputAt ? <span className="tabular text-xs">{health.oldestInputAt}</span> : <Absent why="Nothing has been read yet." />}
                </Row>
                <Row label={FLOOR.warden.rows.held}>
                  {counts === null ? <Absent why="The record count could not be read. This is not zero." /> : <span className="tabular">{counts.blocks.toLocaleString('en-US')}</span>}
                </Row>
              </div>
            </div>

            <div className="mt-7 border-t border-(--color-rule) pt-5">
              {health.statuses.map((status) => {
                const spec = AGENT_BY_ID[status.id];
                const wired = PRODUCERS[status.id] !== undefined;
                return (
                  <div key={status.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-(--color-rule) py-3 last:border-b-0">
                    <div className="min-w-[10rem]">
                      <span className="text-sm tracking-[0.1em] text-(--color-paper)">{status.name}</span>
                      {!wired ? <span className="ml-3 text-[10px] uppercase tracking-[0.14em] text-(--color-state-fog)">not wired</span> : null}
                    </div>
                    <span className="text-xs text-(--color-paper-faint)">{spec.role}</span>
                    <span className="tabular text-xs text-(--color-paper-faint)">
                      {status.sourcesReached === null ? <Absent why="Never ran." /> : `${status.sourcesReached}/${status.sourcesExpected}`}
                      {status.dataAgeSeconds === null ? '' : ` · ${describeAge(status.dataAgeSeconds)} ago`}
                    </span>
                    <Light health={status.health} />
                  </div>
                );
              })}
            </div>

            <details className="mt-6 border-t border-(--color-rule) pt-4">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">{FLOOR.warden.lights}</summary>
              <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {(Object.keys(LIGHTS) as AgentHealth[]).map((state) => (
                  <div key={state} className="flex items-baseline gap-3 text-xs">
                    <span style={{ color: LIGHTS[state].colour }}>●</span>
                    <span className="w-28 shrink-0 uppercase tracking-[0.12em] text-(--color-paper-dim)">{state.replace(/_/g, ' ')}</span>
                    <span className="text-(--color-paper-faint)">{LIGHTS[state].means}</span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </Panel>

      {/* ── THE WIRE ──────────────────────────────────────────────────────── */}
      <Panel title={FLOOR.wire.kicker} note={FLOOR.wire.intro}>
        {publications === null ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
            {FLOOR.wire.unreadable}
          </p>
        ) : publications.length === 0 ? (
          <p className="text-sm text-(--color-paper-faint)">{FLOOR.wire.empty}</p>
        ) : (
          <div className="space-y-4">
            {publications.map((pub) => (
              <article key={pub.id} className="border-t border-(--color-rule) pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-sm tracking-[0.1em] text-(--color-brass)">{pub.headline}</h3>
                  <span className="tabular text-[10px] text-(--color-paper-faint)">
                    {AGENT_BY_ID[pub.agentId].name} · {pub.publishedAt}
                  </span>
                </div>
                {/* Kept word for word, not summarised: the filing is the record. It is folded, not cut. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">{FLOOR.wire.open}</summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-(--color-paper-dim)">{pub.body}</pre>
                  {pub.figures.length > 0 ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
                        {pub.figures.length} {FLOOR.wire.figures}
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {pub.figures.map((f, i) => (
                          <li key={`${i}-${f.token}`} className="tabular text-[11px] text-(--color-paper-faint)">
                            {f.token} — {f.source} @ {f.retrievedAt}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </details>
              </article>
            ))}
          </div>
        )}
      </Panel>

      {/* ── COVERAGE ──────────────────────────────────────────────────────── */}
      <Panel title={FLOOR.coverage.kicker} note={FLOOR.coverage.intro}>
        <Row label={FLOOR.coverage.rows.listed}>
          <span className="tabular">{FEED_COVERAGE.listedByDirectory}</span>
        </Row>
        <Row label={FLOOR.coverage.rows.checked}>
          <span className="tabular">
            {FEED_COVERAGE.capturedHere} / {FEED_COVERAGE.verifiedOnChain}
          </span>
        </Row>
        <Row label={FLOOR.coverage.rows.equity}>
          <span className="tabular">{FEED_COVERAGE.equity}</span>
        </Row>
        <Row label={FLOOR.coverage.rows.tokens}>
          <span className="tabular">{STOCK_TOKEN_COVERAGE.tokensInRegistry}</span>
        </Row>
        <Row label={FLOOR.coverage.rows.noFeed}>
          <span className="tabular">{STOCK_TOKEN_COVERAGE.withoutFeed}</span>
        </Row>
        <Row label={FLOOR.coverage.rows.uptime}>
          <Absent why={SEQUENCER_FEED.reason} />
        </Row>
        <Row label={FLOOR.coverage.rows.head}>
          {chainHead === null ? (
            <Absent why="The chain head has not been read yet." />
          ) : (
            <span className="tabular text-xs" style={{ color: chainHead.stalled ? 'var(--color-state-dark)' : undefined }}>
              block {chainHead.number.toLocaleString('en-US')} · read {describeAge(chainHead.sampleAgeSeconds)} ago
            </span>
          )}
        </Row>
        <Row label={FLOOR.coverage.rows.agents}>
          <span className="tabular">
            {Object.keys(PRODUCERS).length} / {AGENT_COUNTS.total}
          </span>
        </Row>
        <p className="mt-4 text-[11px] leading-relaxed text-(--color-paper-faint)">
          Chainlink directory read {FEED_COVERAGE.observedAt}, checked on chain at block {FEED_COVERAGE.observedAtBlock.toLocaleString('en-US')}. Robinhood registry read{' '}
          {STOCK_TOKEN_COVERAGE.observedAt}.
        </p>
      </Panel>

      <footer className="border-t border-(--color-rule) pt-6 text-xs leading-relaxed text-(--color-paper-faint)">
        {FLOOR.footer.map((line) => (
          <p key={line} className="mt-2 first:mt-0">
            {line}
          </p>
        ))}
      </footer>
    </main>
  );
}
