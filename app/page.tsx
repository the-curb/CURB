import Link from 'next/link';
import { AGENTS } from '@/lib/agents/registry';
import { systemHealth } from '@/lib/agents/health';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { FEED_COVERAGE } from '@/lib/chain/feeds';
import { composeBoard, type BoardRow } from '@/lib/floor/board';
import { APPLE_S1, GATES } from '@/lib/positions/series';
import { getStoreAsync } from '@/lib/store';
import { launchStatus } from '@/lib/launch/status';
import { readSession, type SessionPhase } from '@/lib/market/session';
import { WIDE_BASIS_BPS } from '@/lib/ops/alerts';
import { HOME, MORE_LINKS, withBand } from '@/lib/copy/home';
import { ClocksFigure } from './components/figures';
import { Tape } from './components/tape';

export const dynamic = 'force-dynamic';

/**
 * The front page: what this is, the live numbers, and where to go next.
 *
 * Every word here comes from `lib/copy/home.ts`, which a test holds to short
 * sentences and to the same claim limits as any publication. Every number is
 * computed below from the record, carries its age, and renders as a dash when
 * it was not read. The long-form account of how the desk works — the six
 * districts, the registries, what the positions thesis will and will not say —
 * lives on the pages this one links to, not in the way of a first read.
 */

/** A section's running head: its numeral in the second ink, its title, and a note. */
function Kicker({ n, title, note }: { n: string; title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-1 pb-3 pt-8">
      <span className="kicker">
        <b>№ {n}</b> · {title}
      </span>
      {note ? <span className="hidden text-[13px] text-(--color-paper-faint) sm:inline">{note}</span> : null}
    </div>
  );
}

/** A text link ruled in the second ink. */
function Lead({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="display inline-block text-2xl text-(--color-paper) underline decoration-(--color-accent) decoration-1 underline-offset-[10px] hover:text-(--color-accent) sm:text-3xl">
      {children} →
    </Link>
  );
}

/** A figure, or the dash with its reason. Never a zero standing in for a reading. */
function Figure({ value, why }: { value: string | null; why: string }) {
  return value === null ? (
    <span className="absent text-(--color-paper-faint)" title={why}>
      {ABSENT_GLYPH}
    </span>
  ) : (
    <>{value}</>
  );
}

/** "−2.06%": a basis in plain percent, signed with a true minus. */
function percent(bps: number): string {
  const pct = Math.abs(bps) / 100;
  const sign = bps > 0 ? '+' : bps < 0 ? '−' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** The ticker a feed row names, whatever affixes the record carries. */
function ticker(row: BoardRow): string {
  return row.label.replace(/^RH-/i, '').replace(/-USD$/i, '');
}

const PHASE_WORDS: Record<SessionPhase, string> = {
  REGULAR: 'open',
  PRE: 'pre-market',
  POST: 'after hours',
  CLOSED: 'closed',
};

const ET_OPEN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** A space that does not break a line: "Mon 09:30 ET" is one thing to read. */
const NBSP = '\u00a0';

export default async function Home() {
  const now = new Date();
  const store = await getStoreAsync();
  const [heartbeats, feeds, pools, launch] = await Promise.all([store.latestHeartbeats(), store.snapshots('feed:'), store.snapshots('pool:'), launchStatus(store)]);
  const board = feeds.state === 'UNREAD' ? null : composeBoard(feeds.value, now, pools.state === 'UNREAD' ? [] : pools.value);
  const health = heartbeats.state === 'UNREAD' ? null : systemHealth(heartbeats.value, now);
  const session = readSession(now);

  // ── the live numbers, each from the record or absent ─────────────────────
  const priced = (board?.equity ?? []).filter((r) => r.market?.basisBps != null);
  const byGap = [...priced].sort((a, b) => Math.abs(b.market!.basisBps!) - Math.abs(a.market!.basisBps!));
  const widest = byGap[0] ?? null;
  const under = priced.filter((r) => r.market!.basisBps! < 0).length;
  const over = priced.filter((r) => r.market!.basisBps! > 0).length;

  const bothSides = board === null ? null : `${board.counts.withBasis} of ${board.counts.equity}`;
  const widestText = widest === null ? null : percent(widest.market!.basisBps!);
  const splitText = board === null || priced.length === 0 ? null : `${under} under · ${over} over`;

  const feedAge = board?.sampleAgeSeconds ?? null;
  const chainAge =
    board?.marketSampledAt == null ? null : Math.max(0, Math.round((now.getTime() - new Date(board.marketSampledAt).getTime()) / 1000));
  // "Mon 09:30 ET" stays on one line; a time split across two reads as two things.
  const nextOpen = session.phase === 'CLOSED' && session.nextRegularOpenUtc !== null ? ET_OPEN.format(new Date(session.nextRegularOpenUtc)).replace(/ /g, NBSP) + NBSP + 'ET' : null;

  const running = health === null ? null : health.statuses.filter((s) => s.health === 'LIVE' || s.health === 'ON_REQUEST').length;
  const gatesPassed = GATES.filter((g) => g.status === 'PASSED').length;
  const tokenLine = launch.step === 'NOTHING' || launch.step === 'TREASURY_RECORDED' ? HOME.token.notLaunched : launch.line;

  return (
    <main>
      <Tape board={board} />

      <div className="px-3 sm:px-4">
        {/* ── THE FRONT: what this is, and the numbers, on the first screen ── */}
        <section className="cells !border-t-0 grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="cell flex flex-col justify-center p-6 sm:p-10">
            <h1 className="display text-[2.1rem] leading-[1.08] text-(--color-paper) sm:text-[2.6rem] md:text-[clamp(2.3rem,4vw,4rem)]">
              {HOME.headline.line}
              <br />
              <em className="text-(--color-paper-dim)">{HOME.headline.emphasis}</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-(--color-paper-dim)">{HOME.subhead}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-10 gap-y-4">
              <Lead href="/floor">{HOME.primary}</Lead>
              <Link href="/guide" className="kicker hover:text-(--color-paper)">
                {HOME.secondary}
              </Link>
            </div>
          </div>

          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              <b>{HOME.now.kicker}</b>
            </div>
            <p className="tabular mt-1 text-[12px] text-(--color-paper-dim)">
              US stock market: {PHASE_WORDS[session.phase]}
              {nextOpen === null ? null : (
                <>
                  {' · '}
                  <span className="whitespace-nowrap">opens {nextOpen}</span>
                </>
              )}
            </p>
            <dl className="mt-5 space-y-5">
              <div>
                <dd className="display text-4xl text-(--color-paper)">
                  <Figure value={bothSides} why={HOME.now.unread} />
                </dd>
                <dt className="mt-1 text-[13px] leading-snug text-(--color-paper-dim)">{HOME.now.bothSides}</dt>
              </div>
              <div>
                <dd className="display text-4xl text-(--color-paper)">
                  <Figure value={widestText} why={HOME.now.unread} />
                  {widest === null ? null : <span className="ml-3 align-middle text-base text-(--color-paper-faint)">{ticker(widest)}</span>}
                </dd>
                <dt className="mt-1 text-[13px] leading-snug text-(--color-paper-dim)">{HOME.now.widest}</dt>
              </div>
              <div>
                <dd className="display text-4xl text-(--color-paper)">
                  <Figure value={splitText} why={HOME.now.unread} />
                </dd>
                <dt className="mt-1 text-[13px] leading-snug text-(--color-paper-dim)">{HOME.now.split}</dt>
              </div>
            </dl>
            <p className="tabular mt-5 text-[11px] text-(--color-paper-faint)">
              stock prices read {feedAge === null ? ABSENT_GLYPH : `${describeAge(feedAge)} ago`} · chain prices read{' '}
              {chainAge === null ? ABSENT_GLYPH : `${describeAge(chainAge)} ago`}
            </p>
            <p className="mt-4 text-[14px] leading-relaxed text-(--color-paper)">{HOME.now.explainer.join(' ')}</p>
            <p className="mt-2 text-[12px] text-(--color-paper-faint)">{HOME.now.notAdvice}</p>
          </div>
        </section>

        {/* ── № 01 THE BIGGEST GAPS ────────────────────────────────────────── */}
        <Kicker n="01" title={HOME.table.kicker} />
        <section className="cells grid-cols-1">
          <div className="cell p-6 sm:p-8">
            {byGap.length === 0 ? (
              <p className="text-sm text-(--color-paper-faint)">{HOME.table.empty}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
                      {HOME.table.columns.map((c, i) => (
                        <th key={c} className={`pb-2 pr-4 font-normal ${i === 0 ? '' : 'text-right'}`}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {byGap.slice(0, 5).map((row) => {
                      const m = row.market!;
                      const big = Math.abs(m.basisBps!) >= 100;
                      return (
                        <tr key={row.key} className="border-t border-(--color-rule)">
                          <td className="py-3 pr-4 text-sm tracking-[0.06em] text-(--color-paper)" title={row.name}>
                            {ticker(row)}
                          </td>
                          <td className="tabular py-3 pr-4 text-right text-sm text-(--color-paper-dim)">
                            <Figure value={row.price} why="the stock's last price was not read" />
                          </td>
                          <td className="tabular py-3 pr-4 text-right text-sm text-(--color-paper)" title={m.venueLabel ?? undefined}>
                            <Figure
                              value={m.priceUsd === null ? null : m.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              why="no price on this chain was read"
                            />
                          </td>
                          <td
                            className="tabular py-3 text-right text-sm"
                            style={{ color: big ? 'var(--color-state-stale)' : 'var(--color-paper-dim)' }}
                            title={`${Math.round(m.basisBps!)} basis points (100 bp = 1%)`}
                          >
                            {percent(m.basisBps!)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-6">
              <Link href="/floor" className="kicker hover:text-(--color-paper)">
                {HOME.table.all} · {FEED_COVERAGE.equity} →
              </Link>
            </div>
          </div>
        </section>

        {/* ── № 02 WHY THE PRICES DIFFER ───────────────────────────────────── */}
        <Kicker n="02" title={HOME.why.kicker} />
        <section className="cells grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="cell ledger relative flex items-center justify-center overflow-hidden" style={{ height: 'clamp(180px, 22vw, 320px)' }}>
            <ClocksFigure ease={1} />
            <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">{HOME.why.caption}</div>
          </div>
          <div className="cell flex flex-col justify-center p-6 sm:p-8">
            {HOME.why.body.map((line, i) => (
              <p key={line} className={`text-base leading-relaxed ${i === HOME.why.body.length - 1 ? 'mt-3 text-(--color-paper)' : 'text-(--color-paper-dim)'}`}>
                {line}
              </p>
            ))}
          </div>
        </section>

        {/* ── № 03 WHAT YOU CAN DO ─────────────────────────────────────────── */}
        <Kicker n="03" title={HOME.actions.kicker} note={HOME.actions.note} />
        <section className="cells grid-cols-1 md:grid-cols-3">
          {HOME.actions.items.map((item, i) => (
            <div key={item.title} className="cell flex flex-col p-6 sm:p-8">
              <span className="tabular text-sm text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
              <h2 className="display mt-2 text-3xl text-(--color-paper)">{item.title}</h2>
              <p className="mt-3 flex-1 text-base leading-relaxed text-(--color-paper-dim)">{withBand(item.body, WIDE_BASIS_BPS)}</p>
              <div className="mt-6">
                <Link href={item.href} className="kicker hover:text-(--color-paper)">
                  {item.cta} →
                </Link>
              </div>
            </div>
          ))}
        </section>

        {/* ── № 04 HOW TO READ IT ──────────────────────────────────────────── */}
        <Kicker n="04" title={HOME.trust.kicker} />
        <section className="cells grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="cell p-6 sm:p-8">
            <ul className="space-y-3">
              {HOME.trust.points.map((point) => (
                <li key={point} className="grid grid-cols-[1.25rem_minmax(0,1fr)] text-lg leading-relaxed text-(--color-paper)">
                  <span className="text-(--color-accent)">—</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3">
              <Link href="/doctrine" className="kicker hover:text-(--color-paper)">
                {HOME.trust.doctrine} →
              </Link>
              <Link href="/agents" className="kicker hover:text-(--color-paper)">
                {HOME.trust.agents} →
              </Link>
            </div>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="kicker">The desk</div>
            <p className="display mt-2 text-3xl text-(--color-paper)">
              <Figure value={running === null ? null : `${running} of ${AGENTS.length}`} why="the agents’ heartbeats could not be read" />
            </p>
            <p className="mt-1 text-[13px] text-(--color-paper-dim)">agents running on schedule</p>
            <p className="mt-6 text-[13px] leading-relaxed text-(--color-paper-faint)">{tokenLine}</p>
          </div>
        </section>

        {/* ── № 05 BEING BUILT ─────────────────────────────────────────────── */}
        <Kicker n="05" title={HOME.next.kicker} />
        <section className="cells grid-cols-1">
          <div className="cell flex flex-wrap items-end justify-between gap-x-10 gap-y-6 p-6 sm:p-8">
            <div className="max-w-2xl">
              <h2 className="display text-3xl text-(--color-paper) sm:text-4xl">{HOME.next.title}</h2>
              <p className="mt-3 text-base leading-relaxed text-(--color-paper-dim)">{HOME.next.body}</p>
              <p className="tabular mt-3 text-[11px] text-(--color-paper-faint)">
                {APPLE_S1.company} · gates passed {gatesPassed} / {GATES.length}
              </p>
            </div>
            <Lead href={`/positions/${APPLE_S1.id}`}>{HOME.next.cta}</Lead>
          </div>
        </section>

        {/* ── MORE ON THE DESK ─────────────────────────────────────────────── */}
        <div className="px-1 pb-3 pt-8">
          <span className="kicker">{HOME.more.kicker}</span>
        </div>
        <section className="cells grid-cols-2 md:grid-cols-4">
          {MORE_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="cell block p-5 hover:bg-(--color-ink-3)">
              <span className="kicker" style={{ color: 'var(--color-paper)' }}>
                {link.label} →
              </span>
              <span className="mt-1 block text-[12px] leading-snug text-(--color-paper-faint)">{link.what}</span>
            </Link>
          ))}
        </section>

        <div className="h-8 sm:h-10" />
      </div>
    </main>
  );
}
