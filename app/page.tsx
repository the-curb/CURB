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
  { title: 'Three States, Not Two', body: 'A reading is verified, stale, or unread with a reason. An unread figure renders as an absence — never as zero.' },
  { title: 'Absence Is Not The Middle', body: 'Below a stated minimum of sources the answer is unknown, never neutral. Neutral is a measurement; unknown is the lack of one.' },
  { title: 'One Interval, Three Consequences', body: 'Each agent declares one cadence. Freshness, absence, and the promise the site makes all derive from it.' },
  { title: 'Policy Is Code, Not A Prompt', body: `${RULE_COUNT} rules run ahead of every filing. A number without a source, a forecast, a verdict, a piece of advice — stopped, and kept as an event.` },
  { title: 'Code Computes, The Model Narrates', body: 'The paper’s lede is written by a model that may repeat the record’s figures and may not add one. It passes the same gate.' },
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

  let line = 0;
  const num = () => String(++line).padStart(2, '0');

  return (
    <main className="px-3 sm:px-4">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <HeroSection>
        <div className="cells !border-t-0 grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="cell flex items-center p-6 sm:p-10 md:row-span-2">
            <h1 className="display text-4xl text-[--color-paper] md:text-[clamp(2rem,4.4vw,4.5rem)]">
              The Ticker Tells You &gt;&gt;&gt;
              <br />
              &gt;&gt;&gt;The Exposure.
            </h1>
          </div>
          <div className="cell p-6 sm:p-8">
            <p className="text-lg leading-relaxed text-[--color-paper]">
              The Curb Tells You The Conditions. A Desk Of Nine Agents Reads Robinhood Chain And Two Published
              Registries On A Schedule, And Prints What It Measured — <strong className="font-bold">With A Source And A Time On Every Figure</strong>,
              And An Honest Absence Where It Could Not Look.
            </p>
            <p className="tabular mt-4 text-[12px] text-[--color-paper-faint]">{liveLine}</p>
          </div>
          <Link href="/doctrine" className="cell cell-invert flex items-center justify-center p-6 text-2xl sm:text-3xl">
            Read The Doctrine
          </Link>
        </div>
      </HeroSection>

      {/* ── THE DISTRICTS ────────────────────────────────────────────────── */}
      <div className="mt-3 sm:mt-4">
        <StackSection
          aside={
            <div className="cells !border-x-0 !border-t-0 grid-cols-1">
              <div className="cell overflow-hidden whitespace-nowrap px-4 py-3 text-2xl leading-none tracking-[-0.1em] text-[--color-paper-faint]" aria-hidden="true">
                ›››››››››››››››››››››››››››››››››››››››››››››››››››››››››››››››››››››››
              </div>
              <div className="cell p-6 sm:p-8">
                <h2 className="display text-5xl text-[--color-paper] sm:text-6xl">
                  Reading
                  <br />
                  The -
                  <br />
                  Conditions
                </h2>
              </div>
            </div>
          }
        >
          <div className="cells !border-x-0 !border-b-0 grid-cols-1">
            <div className="cell p-6 sm:p-8">
              <p className="text-base font-bold leading-relaxed text-[--color-paper]">
                As Stock Tokens Move On Chain <span className="text-[--color-paper-faint]">XXXXXXXXXXXXXXXXXXXXXXXX</span> What The Price Means Depends On Conditions Nobody Prints.{' '}
                <span className="text-[--color-paper-faint]">XXXXXXXXXXXXX</span>
              </p>
              <p className="mt-4 text-base leading-relaxed text-[--color-paper-dim]">
                {BRAND.name} keeps six parts of one record so those conditions are in view, and says when they are not.
              </p>
            </div>
            {DISTRICTS.map((d) => (
              <div key={d.name} className="cell p-6 sm:p-8">
                <h3 className="text-base font-bold text-[--color-paper]">{d.name}</h3>
                <p className="mt-2 max-w-md text-base leading-relaxed text-[--color-paper-dim]">{d.body}</p>
              </div>
            ))}
          </div>
        </StackSection>
      </div>

      {/* ── THE PROBLEM ──────────────────────────────────────────────────── */}
      <section className="mt-3 sm:mt-4">
        <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)_auto]">
          <div className="cell overflow-hidden lg:row-span-3" style={{ minHeight: '40vh' }}>
            <WavesFigure />
          </div>
          <div className="cell p-6 sm:p-8">
            <h2 className="display text-4xl text-[--color-paper] sm:text-5xl">
              A Price
              <br />
              Has An Age.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-[--color-paper-dim]">
              Today, The Number You Are Shown For A Stock Token Was Published By An Oracle At Some Moment, While The Exchange Was Open Or Closed, With The Issuer&rsquo;s Pause Flag Set Or Clear. Most Places Print The Number And Hide The Rest.
            </p>
          </div>
          <div className="cell cell-invert row-span-3 hidden items-center justify-center px-3 py-6 lg:flex">
            <span className="edge-label text-sm">The Problem We&rsquo;re Solving</span>
          </div>
          <div className="cell p-6 sm:p-8">
            <p className="text-base leading-relaxed text-[--color-paper]">
              {BRAND.name} Exists To Print The Rest, Because <strong className="font-bold">A Figure That Cannot Carry Its Source And Its Time Does Not Go Out.</strong>
            </p>
          </div>
          <Link href="/floor" className="cell cell-invert flex items-center justify-center p-6 text-2xl sm:text-3xl">
            Open The Floor
          </Link>
        </div>
      </section>

      {/* ── THE RULES ────────────────────────────────────────────────────── */}
      <section className="mt-3 sm:mt-4">
        <div className="cells grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_minmax(0,6fr)]">
          <div className="cell p-6 sm:p-8">
            <h2 className="display text-5xl uppercase leading-[1.05] text-[--color-paper] sm:text-6xl">
              Nine
              <br />
              Agents
              <br />
              One
              <br />
              Gate
            </h2>
            <p className="mt-8 text-base leading-relaxed text-[--color-paper-dim]">
              {AGENT_COUNTS.measure} Measure. {AGENT_COUNTS.promote} Promotes, And Says So On Every Post. {AGENT_COUNTS.execute} Execute — Nothing Here Touches A Venue Or Places An Order. Every Filing Travels One Pipeline, And Every Rule In It Is Code.
            </p>
          </div>
          <div className="cell p-6 sm:p-8">
            <ul className="space-y-7">
              {RULES.map((r) => (
                <li key={r.title}>
                  <h3 className="text-lg font-bold leading-tight text-[--color-paper]">{r.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-[--color-paper-dim]">{r.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="cell hidden overflow-hidden lg:block">
            <CityFigure />
          </div>
        </div>
      </section>

      {/* ── THE REGISTRIES ───────────────────────────────────────────────── */}
      <section className="mt-3 sm:mt-4">
        <div className="cells grid-cols-1">
          <div className="cell hidden overflow-hidden sm:block" style={{ height: '34vh' }}>
            <CardsFigure />
          </div>
          <div className="cells !border-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="cell p-6 sm:p-8">
              <h2 className="display text-4xl text-[--color-paper] sm:text-5xl">
                Two Registries,
                <br />
                Verified On Chain
              </h2>
            </div>
            <div className="cell p-6 sm:p-8">
              <p className="text-base leading-relaxed text-[--color-paper-dim]">
                The Vendor&rsquo;s Feed Directory And The Issuer&rsquo;s Asset Registry Are Captured With A Hash And A Block, And Every Entry Is Verified On Chain Before It Is Read By Anyone: {FEED_COVERAGE.listedByDirectory} Feeds, {STOCK_TOKEN_COVERAGE.tokensInRegistry} Stock Tokens, One Beacon Behind All Of Them.
              </p>
              <p className="mt-4 text-base leading-relaxed text-[--color-paper-dim]">
                When The World Moves On From The Capture, The Registrar Says So The Same Day — And The Remedy Is A Re-Capture, Never A Hand Edit.
              </p>
            </div>
            <div className="cell flex items-center justify-center px-10 py-8 text-[--color-paper]">
              <Mark size={96} />
            </div>
          </div>
        </div>
      </section>

      {/* ── THE PRESS ────────────────────────────────────────────────────── */}
      <section className="mt-3 sm:mt-4">
        <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="cell relative overflow-hidden" style={{ minHeight: '52vh' }}>
            <DotsFigure total={STOCK_TOKEN_COVERAGE.tokensInRegistry} withFeed={STOCK_TOKEN_COVERAGE.withFeed} />
            <div className="absolute bottom-5 left-5 max-w-xs border border-[--color-rule] bg-[--color-ink]">
              <div className="cell-invert px-4 py-2 text-base">{BRAND.paper.name}</div>
              <p className="px-4 py-3 text-lg leading-snug text-[--color-paper]">
                One Story A Day.
                <br />
                Every Claim Sourced.
                <br />
                Every Absence Named.
              </p>
            </div>
          </div>
          <div className="cell p-5 sm:p-6">
            <pre className="tabular overflow-x-auto text-[11px] leading-[1.7] text-[--color-paper-dim] xl:text-[12px]">
              {`${num()} ${'-'.repeat(44)}
${num()} <PIPELINE  every filing, in order
${PIPELINE.map((step) => `${num()} /          ${step}`).join('\n')}
${num()} ${'-'.repeat(44)}
${num()} <AGENTS    as of ${now.toISOString().slice(11, 16)} UTC
${AGENTS.map((a) => {
  const st = byId.get(a.id);
  const light = st ? st.health : 'NOT_OBSERVED';
  return `${num()} / ${a.name.padEnd(14)} ${light.toLowerCase().replace('_', ' ').padEnd(12)} ${a.role}`;
}).join('\n')}
${num()} ${'-'.repeat(44)}
${num()} <GATE      ${RULE_COUNT} rules, code, ahead of every post
${num()} /          forecast · advice · verdict · unsourced figure
${num()} ${'-'.repeat(44)}`}
            </pre>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[--color-paper-faint]">
              {(Object.keys(LIGHT) as AgentHealth[]).map((h) => (
                <span key={h} className="flex items-center gap-1.5">
                  <span style={{ color: LIGHT[h] }}>●</span>
                  {h.toLowerCase().replace('_', ' ')}
                </span>
              ))}
            </div>
            <div className="mt-6 cells !border-0 grid-cols-2">
              <Link href="/gazette" className="cell cell-invert flex items-center justify-center px-4 py-4 text-base">
                Read Today&rsquo;s Edition
              </Link>
              <Link href="/agents" className="cell flex items-center justify-center px-4 py-4 text-base text-[--color-paper] hover:bg-[--color-ink-3]">
                Meet The Agents
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="h-3 sm:h-4" />
    </main>
  );
}
