import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { AGENTS, AGENT_COUNTS } from '@/lib/agents/registry';
import { systemHealth, type AgentHealth } from '@/lib/agents/health';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { describeAge } from '@/lib/doctrine/reading';
import { FEED_COVERAGE, STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { composeBoard } from '@/lib/floor/board';
import { getStoreAsync } from '@/lib/store';
import { HeroSection } from './components/hero-figure';
import { StackSection } from './components/stack-figure';
import { CardsFigure, CityFigure, DotsFigure, WavesFigure } from './components/figures';
import { Mark } from './components/mark';
import { Tape } from './components/tape';

export const dynamic = 'force-dynamic';

const LIGHT: Record<AgentHealth, string> = {
  LIVE: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  DEGRADED: 'var(--color-state-degraded)',
  ABSENT: 'var(--color-state-dark)',
  ON_REQUEST: 'var(--color-state-request)',
  NOT_OBSERVED: 'var(--color-state-fog)',
};

const RULES = [
  { title: 'Three states, not two', body: 'A reading is verified, stale, or unread with a reason. An unread figure renders as an absence — never as zero.' },
  { title: 'Absence is not the middle', body: 'Below a stated minimum of sources the answer is unknown, never neutral. Neutral is a measurement; unknown is the lack of one.' },
  { title: 'One interval, three consequences', body: 'Each agent declares one cadence. Freshness, absence, and the promise the site makes all derive from it.' },
  { title: 'Policy is code, not a prompt', body: `${RULE_COUNT} rules run ahead of every filing. A number without a source, a forecast, a verdict, a piece of advice — stopped, and kept as an event.` },
  { title: 'Code computes, the model narrates', body: 'The paper’s lede is written by a model that may repeat the record’s figures and may not add one. It passes the same gate.' },
];

const DISTRICTS = [
  { name: 'THE FLOOR', body: 'The session, and every tokenized-equity feed with two ages kept apart: since the oracle published, and since we read it. The issuer’s pause flag beside each.' },
  { name: 'THE REGISTRY', body: 'Every stock token the issuer lists, the one beacon they all delegate to, and shares-per-token — the on-chain record of every split and reinvested distribution.' },
  { name: 'THE VAULT', body: 'Transfer flow as an hourly rate sample, never as a total the public node cannot answer. Sending and receiving addresses counted apart.' },
  { name: 'CHAMBERS', body: 'The published terms, pointed at and watched for change without being read for meaning. And the three numbers the system cannot fake.' },
  { name: 'THE PRESS', body: 'One story a day, composed from the record. Its lede narrated by a model under the same policy gate as every agent.' },
  { name: 'THE CAGE', body: 'The declared promoter, kept apart, with its disclosure appended by code on every post it makes.' },
];

const PIPELINE = ['PRODUCE', 'PROVENANCE', 'POLICY', 'PUBLISH', 'HEARTBEAT'];

/** A section's running head: its numeral in the second ink, its title, and a note in the serif. */
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

/** A text link set in the serif, ruled in the second ink. */
function Lead({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="display inline-block text-2xl text-(--color-paper) underline decoration-(--color-accent) decoration-1 underline-offset-[10px] hover:text-(--color-accent) sm:text-3xl">
      {children} →
    </Link>
  );
}

export default async function Home() {
  const now = new Date();
  const store = await getStoreAsync();
  const [heartbeats, feeds] = await Promise.all([store.latestHeartbeats(), store.snapshots('feed:')]);
  const health = heartbeats.state === 'UNREAD' ? null : systemHealth(heartbeats.value, now);
  const board = feeds.state === 'UNREAD' ? null : composeBoard(feeds.value, now);
  const byId = new Map(health?.statuses.map((s) => [s.id, s]) ?? []);

  const liveLine =
    board === null
      ? 'The record could not be read for this page; nothing is inferred from that.'
      : board.sampleState === 'NONE'
        ? 'No feed has been sampled into the record yet.'
        : `${board.counts.priced} of ${board.counts.equity} tokenized-equity feeds priced, sampled ${board.sampleAgeSeconds === null ? 'at an unknown time' : `${describeAge(board.sampleAgeSeconds)} ago`}; ${board.counts.pastHeartbeat} past heartbeat, ${board.counts.paused} paused.`;

  return (
    <main>
      <Tape board={board} />

      <div className="px-3 sm:px-4">
        {/* ── THE FRONT ────────────────────────────────────────────────────── */}
        <HeroSection>
          <div className="cells !border-t-0 grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="cell flex items-center p-6 sm:p-10 md:row-span-2">
              <h1 className="display text-[2.25rem] text-(--color-paper) sm:text-[2.6rem] md:text-[clamp(2.2rem,4.2vw,4.5rem)]">
                The ticker tells you the exposure.
                <br />
                <em className="text-(--color-paper-dim)">The Curb tells you the conditions.</em>
              </h1>
            </div>
            <div className="cell p-6 sm:p-8">
              <p className="text-lg leading-relaxed text-(--color-paper)">
                A desk of nine agents reads Robinhood Chain and two published registries on a schedule, and prints what it
                measured — <strong className="font-bold">with a source and a time on every figure</strong>, and an honest absence where
                it could not look.
              </p>
              <p className="tabular mt-4 text-[12px] text-(--color-paper-faint)">{liveLine}</p>
            </div>
            <div className="cell flex flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-6 sm:px-8">
              <Lead href="/doctrine">Read the doctrine</Lead>
              <Link href="/floor" className="kicker hover:text-(--color-paper)">
                Open the Floor
              </Link>
            </div>
          </div>
        </HeroSection>

        {/* ── № 01 THE DISTRICTS ───────────────────────────────────────────── */}
        <Kicker n="01" title="The districts" note="Six parts of one record." />
        <StackSection
          aside={
            <div className="cells !border-t-0 grid-cols-1">
              <div className="cell p-6 sm:p-8">
                <h2 className="display text-5xl text-(--color-paper) sm:text-6xl">
                  Reading the <em className="text-(--color-paper-dim)">conditions.</em>
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-(--color-paper-dim)">
                  As stock tokens move on chain, what a price means depends on conditions nobody prints. {BRAND.name} keeps six
                  parts of one record so those conditions are in view, and says when they are not.
                </p>
              </div>
            </div>
          }
        >
          <div className="cells !border-b-0 grid-cols-1">
            {DISTRICTS.map((d, i) => (
              <div key={d.name} className="cell grid grid-cols-[3rem_minmax(0,1fr)] gap-4 p-6 sm:p-8">
                <span className="tabular pt-1 text-sm text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="kicker" style={{ color: 'var(--color-paper)' }}>
                    {d.name}
                  </h3>
                  <p className="mt-2 max-w-md text-base leading-relaxed text-(--color-paper-dim)">{d.body}</p>
                </div>
              </div>
            ))}
          </div>
        </StackSection>

        {/* ── № 02 THE PROBLEM ─────────────────────────────────────────────── */}
        <Kicker n="02" title="The problem" note="A number, without its time." />
        <section>
          <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="cell overflow-hidden lg:row-span-2" style={{ minHeight: '40vh' }}>
              <WavesFigure />
            </div>
            <div className="cell p-6 sm:p-8">
              <h2 className="display text-4xl text-(--color-paper) sm:text-5xl">
                A price <em className="text-(--color-paper-dim)">has an age.</em>
              </h2>
              <p className="mt-6 text-base leading-relaxed text-(--color-paper-dim)">
                The number you are shown for a stock token was published by an oracle at some moment, while the exchange was open
                or closed, with the issuer&rsquo;s pause flag set or clear. Most places print the number and hide the rest.
              </p>
            </div>
            <div className="cell flex flex-col justify-between gap-8 p-6 sm:p-8">
              <p className="text-base leading-relaxed text-(--color-paper)">
                {BRAND.name} exists to print the rest, because{' '}
                <strong className="font-bold">a figure that cannot carry its source and its time does not go out.</strong>
              </p>
              <Lead href="/floor">Open the Floor</Lead>
            </div>
          </div>
        </section>

        {/* ── № 03 THE RULES ───────────────────────────────────────────────── */}
        <Kicker n="03" title="The rules" note="Every one of them is code." />
        <section>
          <div className="cells grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,5fr)]">
            <div className="cell p-6 sm:p-8">
              <h2 className="display text-5xl text-(--color-paper) sm:text-6xl">
                Nine agents,
                <br />
                <em className="text-(--color-paper-dim)">one gate.</em>
              </h2>
              <p className="mt-8 text-base leading-relaxed text-(--color-paper-dim)">
                {AGENT_COUNTS.measure} measure. {AGENT_COUNTS.promote} promotes, and says so on every post. {AGENT_COUNTS.execute}{' '}
                execute — nothing here touches a venue or places an order. Every filing travels one pipeline, and every rule in it
                is code.
              </p>
            </div>
            <div className="cell p-6 sm:p-8">
              <ol className="space-y-7">
                {RULES.map((r, i) => (
                  <li key={r.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3">
                    <span className="tabular pt-1 text-sm text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <h3 className="text-lg font-bold leading-tight text-(--color-paper)">{r.title}</h3>
                      <p className="mt-2 text-base leading-relaxed text-(--color-paper-dim)">{r.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="cell hidden overflow-hidden lg:block">
              <CityFigure />
            </div>
          </div>
        </section>

        {/* ── № 04 THE REGISTRIES ──────────────────────────────────────────── */}
        <Kicker n="04" title="The registries" note="Captured with a hash and a block." />
        <section>
          <div className="cells grid-cols-1">
            <div className="cell hidden overflow-hidden sm:block" style={{ height: '34vh' }}>
              <CardsFigure />
            </div>
            <div className="cells !border-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="cell p-6 sm:p-8">
                <h2 className="display text-4xl text-(--color-paper) sm:text-5xl">
                  Two registries,
                  <br />
                  <em className="text-(--color-paper-dim)">verified on chain.</em>
                </h2>
              </div>
              <div className="cell p-6 sm:p-8">
                <p className="text-base leading-relaxed text-(--color-paper-dim)">
                  The vendor&rsquo;s feed directory and the issuer&rsquo;s asset registry are captured with a hash and a block, and
                  every entry is verified on chain before it is read by anyone: {FEED_COVERAGE.listedByDirectory} feeds,{' '}
                  {STOCK_TOKEN_COVERAGE.tokensInRegistry} stock tokens, one beacon behind all of them.
                </p>
                <p className="mt-4 text-base leading-relaxed text-(--color-paper-dim)">
                  When the world moves on from the capture, the Registrar says so the same day — and the remedy is a re-capture,
                  never a hand edit.
                </p>
              </div>
              <div className="cell flex items-center justify-center px-10 py-8 text-(--color-accent)">
                <Mark size={96} />
              </div>
            </div>
          </div>
        </section>

        {/* ── № 05 THE PRESS ───────────────────────────────────────────────── */}
        <Kicker n="05" title="The press" note={BRAND.paper.cadence} />
        <section>
          <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="cell relative overflow-hidden" style={{ minHeight: '52vh' }}>
              <DotsFigure total={STOCK_TOKEN_COVERAGE.tokensInRegistry} withFeed={STOCK_TOKEN_COVERAGE.withFeed} />
              <div className="boxed absolute bottom-5 left-5 max-w-xs border-y border-(--color-rule) bg-(--color-ink)">
                <div className="kicker border-b border-(--color-rule) px-4 py-2" style={{ color: 'var(--color-paper)' }}>
                  {BRAND.paper.name}
                </div>
                <p className="display px-4 py-3 text-2xl leading-tight text-(--color-paper)">
                  One story a day.
                  <br />
                  Every claim sourced.
                  <br />
                  <em className="text-(--color-paper-dim)">Every absence named.</em>
                </p>
              </div>
            </div>
            <div className="cell p-6 sm:p-8">
              <div className="kicker">
                The desk sheet · as of {now.toISOString().slice(11, 16)} UTC
              </div>
              <ul className="tabular mt-5 text-[12px]">
                <li className="leader py-2">
                  <span className="text-(--color-paper)">PIPELINE</span>
                  <span className="text-(--color-paper-dim)">{PIPELINE.join(' → ')}</span>
                </li>
                {AGENTS.map((a) => {
                  const st = byId.get(a.id);
                  const light = st ? st.health : 'NOT_OBSERVED';
                  return (
                    <li key={a.id} className="py-2">
                      <div className="leader">
                        <span className="text-(--color-paper)">{a.name}</span>
                        <span className="flex items-center gap-2 text-(--color-paper-dim)">
                          <span style={{ color: LIGHT[light] }} aria-hidden="true">
                            ●
                          </span>
                          {light.toLowerCase().replace('_', ' ')}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-(--color-paper-faint)">{a.role}</div>
                    </li>
                  );
                })}
                <li className="leader py-2">
                  <span className="text-(--color-paper)">THE GATE</span>
                  <span className="text-(--color-paper-dim)">{RULE_COUNT} rules, code, ahead of every post</span>
                </li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-(--color-paper-faint)">
                {(Object.keys(LIGHT) as AgentHealth[]).map((h) => (
                  <span key={h} className="flex items-center gap-1.5">
                    <span style={{ color: LIGHT[h] }}>●</span>
                    {h.toLowerCase().replace('_', ' ')}
                  </span>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
                <Lead href="/gazette">Read today&rsquo;s edition</Lead>
                <Link href="/agents" className="kicker hover:text-(--color-paper)">
                  Meet the agents
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="h-8 sm:h-10" />
      </div>
    </main>
  );
}
