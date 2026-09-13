import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { AGENTS, AGENT_COUNTS } from '@/lib/agents/registry';
import { systemHealth, type AgentHealth } from '@/lib/agents/health';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { describeAge } from '@/lib/doctrine/reading';
import { FEED_COVERAGE, STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { composeBoard } from '@/lib/floor/board';
import { APPLE_S1, GATES, PROMISES, STEPS, WORKED_EXAMPLE } from '@/lib/positions/series';
import { getStoreAsync } from '@/lib/store';
import { launchStatus } from '@/lib/launch/status';
import { HeroSection } from './components/hero-figure';
import { StackSection } from './components/stack-figure';
import { CardsFigure, ClocksFigure, DotsFigure } from './components/figures';
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

const DISTRICTS = [
  { name: 'THE FLOOR', body: 'The session, and every tokenized-equity feed with two ages kept apart: since the oracle published, and since we read it. The issuer’s pause flag beside each.' },
  { name: 'THE REGISTRY', body: 'Every stock token the issuer lists, the one beacon they all delegate to, and shares-per-token — the on-chain record of every split and reinvested distribution.' },
  { name: 'THE VAULT', body: 'Transfer flow as an hourly rate sample, never as a total the public node cannot answer. Sending and receiving addresses counted apart.' },
  { name: 'CHAMBERS', body: 'The published terms, pointed at and watched for change without being read for meaning. And the three numbers the system cannot fake.' },
  { name: 'THE PRESS', body: 'One story a day, composed from the record. Its lede narrated by a model under the same policy gate as every agent.' },
  { name: 'THE CAGE', body: 'The declared promoter, kept apart, with its disclosure appended by code on every post it makes.' },
];

const PIPELINE = ['PRODUCE', 'PROVENANCE', 'POLICY', 'PUBLISH', 'HEARTBEAT'];

const EXAMPLE_ROWS: readonly { state: string; row: readonly [string, string, string, string, string] }[] = [
  { state: 'Before Alice exits', row: ['100', '1,000', '0', '2,000', '0'] },
  { state: 'After Alice allocates 25 lots', row: ['75', '750', '250', '1,500', '500'] },
  { state: 'A halts · Alice claims B', row: ['75', '750', '250', '1,500', '0'] },
  { state: 'Bob mints 10 lots', row: ['85', '850', '250', '1,700', '0'] },
];

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

export default async function Home() {
  const now = new Date();
  const store = await getStoreAsync();
  const [heartbeats, feeds, launch] = await Promise.all([store.latestHeartbeats(), store.snapshots('feed:'), launchStatus(store)]);
  const health = heartbeats.state === 'UNREAD' ? null : systemHealth(heartbeats.value, now);
  const board = feeds.state === 'UNREAD' ? null : composeBoard(feeds.value, now);
  const byId = new Map(health?.statuses.map((s) => [s.id, s]) ?? []);
  const gatesPassed = GATES.filter((g) => g.status === 'PASSED').length;
  const [a, b] = APPLE_S1.components;

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
        <HeroSection figure="position" caption={`one company · two issuers · ${WORKED_EXAMPLE.q.A} A + ${WORKED_EXAMPLE.q.B} B to a lot · claims per component`}>
          <div className="cells !border-t-0 grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="cell flex items-center p-6 sm:p-10 md:row-span-2">
              <h1 className="display text-[2.25rem] text-(--color-paper) sm:text-[2.6rem] md:text-[clamp(2.2rem,4.2vw,4.5rem)]">
                One company.
                <br />
                Multiple issuers.
                <br />
                <em className="text-(--color-paper-dim)">One position.</em>
              </h1>
            </div>
            <div className="cell p-6 sm:p-8">
              <p className="text-lg leading-relaxed text-(--color-paper)">
                {BRAND.name} is building a way to combine stock-token exposure from multiple issuers into one disclosed position,
                with the right to every component recorded and withdrawn <strong className="font-bold">component by component</strong>.
              </p>
              <p className="kicker mt-5" style={{ color: launch.step === 'NOTHING' ? 'var(--color-state-stale)' : 'var(--color-state-live)' }}>
                <b>Stage</b> · mainnet · {launch.chain}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-paper-dim)" title={launch.treasury === null ? undefined : `treasury ${launch.treasury.address}`}>
                {launch.line}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-paper-dim)">{APPLE_S1.stageLine} The deposit is in kind, the receipt cannot be transferred, and exit is per component.</p>
            </div>
            <div className="cell flex flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-6 sm:px-8">
              <Lead href={`/positions/${APPLE_S1.id}`}>Try the simulation</Lead>
              <Link href="/mechanism" className="kicker hover:text-(--color-paper)">
                Read the mechanism
              </Link>
            </div>
          </div>
        </HeroSection>

        {/* ── № 01 THE POSITION ────────────────────────────────────────────── */}
        <Kicker n="01" title="The position" note="Three steps, one ledger." />
        <section>
          <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="cell p-6 sm:p-8">
              <h2 className="display text-4xl text-(--color-paper) sm:text-5xl">
                A symbol names the company. <em className="text-(--color-paper-dim)">The issuer names the exposure.</em>
              </h2>
              <p className="mt-6 max-w-md text-base leading-relaxed text-(--color-paper-dim)">
                A stock-token holder chooses a company and, in the same act, a particular way of getting exposure to it. Behind
                similar symbols sit different issuers, contracts, corporate-action rules and exits. {BRAND.name} is where that
                second choice is made in the open: keep the company, split the position across issuers that are disclosed plainly.
              </p>
              <p className="mt-4 max-w-md text-base leading-relaxed text-(--color-paper-dim)">
                When one component is obstructed, the ledger still shows what can be transferred and what remains a claim. Every
                position still carries the risk of the company, the issuers and the contracts used.
              </p>
            </div>
            <div className="cells !border-0 grid-cols-1 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className="cell p-6 sm:p-8">
                  <span className="tabular text-sm text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="display mt-2 text-2xl text-(--color-paper)">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-paper-dim)">{step.body}</p>
                </div>
              ))}
              <div className="cell p-6 sm:col-span-3 sm:p-8">
                <div className="kicker">
                  <b>First series</b> · {APPLE_S1.company} · candidates, read on chain, not admitted
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {[a, b].map((c) => (
                    <div key={c.id} className="text-[13px] leading-relaxed">
                      <span className="tabular text-(--color-accent)">{c.id}</span>{' '}
                      <span className="text-(--color-paper)">{c.instrument.split(' — ')[0]}</span>
                      <span className="text-(--color-paper-faint)">
                        {' '}
                        · {c.issuer.split(' — ')[0]} · {c.chain}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                  <Link href={`/positions/${APPLE_S1.id}`} className="kicker hover:text-(--color-paper)">
                    See the components →
                  </Link>
                  <span className="tabular text-[11px] text-(--color-paper-faint)">
                    gates passed {gatesPassed} / {GATES.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── № 02 THE LEDGER ──────────────────────────────────────────────── */}
        <Kicker n="02" title="The ledger" note="Rights are counted in units, not priced." />
        <section>
          <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="cell p-6 sm:p-8">
              <div className="kicker">
                The worked example · illustrative units · one lot = {WORKED_EXAMPLE.q.A} A + {WORKED_EXAMPLE.q.B} B
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="tabular w-full min-w-[34rem] border-collapse text-[12px]">
                  <thead>
                    <tr className="kicker text-left">
                      <th className="pb-2 pr-4 font-normal">State</th>
                      <th className="pb-2 pr-4 text-right font-normal">Receipts</th>
                      <th className="pb-2 pr-4 text-right font-normal">A active</th>
                      <th className="pb-2 pr-4 text-right font-normal">A reserved</th>
                      <th className="pb-2 pr-4 text-right font-normal">B active</th>
                      <th className="pb-2 text-right font-normal">B reserved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_ROWS.map((r) => (
                      <tr key={r.state} className="border-t border-(--color-rule)">
                        <td className="py-2 pr-4 text-(--color-paper)">{r.state}</td>
                        {r.row.map((v, i) => (
                          <td key={i} className="py-2 pr-4 text-right text-(--color-paper-dim) last:pr-0">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-(--color-paper-dim)">
                Bob’s deposit backs Bob’s lots. Alice keeps her claim on 250 A while A is halted, and her B has already left.
                While A is halted Bob cannot deposit A, so his mint fails whole — the last row happens only once A moves again.
                The same table is reproduced, row by row, by the tests in the repository.
              </p>
            </div>
            <div className="cell flex flex-col justify-between gap-8 p-6 sm:p-8">
              <div>
                <h2 className="display text-4xl text-(--color-paper) sm:text-5xl">
                  Both arrive, <em className="text-(--color-paper-dim)">or neither does.</em>
                </h2>
                <ul className="mt-6 space-y-2">
                  {APPLE_S1.rules.slice(1, 6).map((r) => (
                    <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                      <span className="text-(--color-accent)">—</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Lead href={`/positions/${APPLE_S1.id}`}>Run the ledger yourself</Lead>
            </div>
          </div>
        </section>

        {/* ── № 03 WHAT WE SAY ─────────────────────────────────────────────── */}
        <Kicker n="03" title="What we will say" note="And the baseline this has to beat." />
        <section>
          <div className="cells grid-cols-1 md:grid-cols-3">
            <div className="cell p-6 sm:p-8">
              <div className="kicker">
                <b>Testable</b> · promised
              </div>
              <ul className="mt-3 space-y-3">
                {PROMISES.testable.map((r) => (
                  <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-base leading-relaxed text-(--color-paper)">
                    <span className="text-(--color-accent)">—</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="cell p-6 sm:p-8">
              <div className="kicker">
                <b>Unsupported</b> · never said
              </div>
              <ul className="mt-3 space-y-1.5">
                {PROMISES.unsupported.map((r) => (
                  <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-faint)">
                    <span>×</span>
                    <span className="line-through decoration-(--color-rule-2)">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="cell p-6 sm:p-8">
              <div className="kicker">
                <b>The baseline</b> · two tokens in one wallet
              </div>
              <p className="mt-3 text-base leading-relaxed text-(--color-paper-dim)">
                Holding token A and token B yourself already splits issuer exposure, with no Curb contract in between. That is
                a valid alternative, and it is the comparison every test is run against. A receipt has to earn its place with
                something measurable: consistent lots, a ledger another application can read, fewer steps, or an integration
                that can accept one position.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-(--color-paper-faint)">
                If people prefer the two tokens after full information, the receipt thesis stops. That outcome is written into
                the plan, not around it.
              </p>
            </div>
          </div>
        </section>

        {/* ── № 04 THE DESK ────────────────────────────────────────────────── */}
        <Kicker n="04" title="The desk beneath it" note={BRAND.desk.line} />
        <section>
          <div className="cells grid-cols-1">
            <div className="cell ledger relative hidden overflow-hidden sm:block" style={{ height: 'clamp(200px, 26vw + 60px, 400px)' }}>
              <ClocksFigure ease={1} />
              <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">
                24 hours of chain · 6½ hours of exchange · drawn solid
              </div>
            </div>
            <div className="cells !border-0 grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="cell p-6 sm:p-8">
                <h2 className="display text-4xl text-(--color-paper) sm:text-5xl">
                  A price <em className="text-(--color-paper-dim)">has an age.</em>
                </h2>
              </div>
              <div className="cell p-6 sm:p-8">
                <p className="text-base leading-relaxed text-(--color-paper-dim)">
                  Every component a series would hold is a stock token with conditions around it: an oracle that published at some
                  moment, an exchange that was open or closed, a pause flag, a multiplier, a registry that can move. A desk of
                  nine agents already reads Robinhood Chain and two published registries on a schedule and prints what it
                  measured — <strong className="font-bold text-(--color-paper)">with a source and a time on every figure</strong>, and an
                  honest absence where it could not look. It is the evidence layer the position would stand on; for a new chain it
                  needs new sources and new tests, and it says so.
                </p>
                <p className="tabular mt-4 text-[12px] text-(--color-paper-faint)">{liveLine}</p>
                <div className="mt-6">
                  <Lead href="/floor">Open the Floor</Lead>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── № 05 THE DISTRICTS ───────────────────────────────────────────── */}
        <Kicker n="05" title="The districts" note="Six parts of one record." />
        <StackSection
          aside={
            <div className="cells !border-t-0 grid-cols-1">
              <div className="cell p-6 sm:p-8">
                <h2 className="display text-5xl text-(--color-paper) sm:text-6xl">
                  Reading the <em className="text-(--color-paper-dim)">conditions.</em>
                </h2>
                <p className="mt-6 max-w-md text-base leading-relaxed text-(--color-paper-dim)">
                  As stock tokens move on chain, what a price means depends on conditions nobody prints. The desk keeps six parts
                  of one record so those conditions are in view, and says when they are not.
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

        {/* ── № 06 THE REGISTRIES ──────────────────────────────────────────── */}
        <Kicker n="06" title="The registries" note="Captured with a hash and a block." />
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
                  The vendor’s feed directory and the issuer’s asset registry are captured with a hash and a block, and every
                  entry is verified on chain before it is read by anyone: {FEED_COVERAGE.listedByDirectory} feeds,{' '}
                  {STOCK_TOKEN_COVERAGE.tokensInRegistry} stock tokens, one beacon behind all of them.
                </p>
                <p className="mt-4 text-base leading-relaxed text-(--color-paper-dim)">
                  When the world moves on from the capture, the Registrar says so the same day — and the remedy is a re-capture,
                  never a hand edit. The same discipline is what a series’ components would be admitted under.
                </p>
              </div>
              <div className="cell flex items-center justify-center px-10 py-8 text-(--color-accent)">
                <Mark size={96} />
              </div>
            </div>
          </div>
        </section>

        {/* ── № 07 THE PRESS ───────────────────────────────────────────────── */}
        <Kicker n="07" title="The press" note={BRAND.paper.cadence} />
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
              <div className="kicker">The desk sheet · as of {now.toISOString().slice(11, 16)} UTC</div>
              <ul className="tabular mt-5 text-[12px]">
                <li className="leader py-2">
                  <span className="text-(--color-paper)">PIPELINE</span>
                  <span className="text-(--color-paper-dim)">{PIPELINE.join(' → ')}</span>
                </li>
                {AGENTS.map((agent) => {
                  const st = byId.get(agent.id);
                  const light = st ? st.health : 'NOT_OBSERVED';
                  return (
                    <li key={agent.id} className="py-2">
                      <div className="leader">
                        <span className="text-(--color-paper)">{agent.name}</span>
                        <span className="flex items-center gap-2 text-(--color-paper-dim)">
                          <span style={{ color: LIGHT[light] }} aria-hidden="true">
                            ●
                          </span>
                          {light.toLowerCase().replace('_', ' ')}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-(--color-paper-faint)">{agent.role}</div>
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
              <p className="mt-4 text-[12px] leading-relaxed text-(--color-paper-faint)">
                {AGENT_COUNTS.measure} measure. {AGENT_COUNTS.promote} promotes, and says so on every post. {AGENT_COUNTS.execute}{' '}
                execute — nothing here touches a venue or places an order.
              </p>
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
