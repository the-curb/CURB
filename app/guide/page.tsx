import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { creditsStatus } from '@/lib/credits/config';
import { confirmationsFor } from '@/lib/credits/indexer';
import { MINIMUM_OPEN_CENTS, SERVICES } from '@/lib/credits/prices';
import { launchStatus, shortAddress, type LaunchStep } from '@/lib/launch/status';
import { deploymentOf } from '@/lib/positions/deployments';
import { APPLE_S1 } from '@/lib/positions/series';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'How to use it',
  description: 'What a visitor can do at THE CURB today, step by step, and what waits on the record — read from the configuration at request time.',
};

/**
 * The instructions. Every step is either something a visitor can do now or
 * something that waits on a rung of the launch ladder, and the page decides
 * which from the same configuration the product runs on — the credits
 * status, the series deployment, the launch record — so it cannot describe
 * a desk that is open while /services says NOT_CONFIGURED, or the reverse.
 * Nothing here is a promise of a date; the record says what is next.
 */

const dollars = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

function State({ tone, children }: { tone: 'live' | 'wait' | 'fog'; children: React.ReactNode }) {
  const color = tone === 'live' ? 'var(--color-state-live)' : tone === 'wait' ? 'var(--color-state-stale)' : 'var(--color-state-fog)';
  return (
    <span className="tabular text-[10px] uppercase tracking-[0.16em]" style={{ color }}>
      {children}
    </span>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith('http');
  const className = 'text-(--color-paper) underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-accent)';
  return external ? (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-sm bg-(--color-ink-3) px-1 py-0.5 font-mono text-[0.85em] text-(--color-paper)">{children}</code>;
}

function Block({ children }: { children: string }) {
  return (
    <pre className="tabular mt-3 overflow-x-auto border border-(--color-rule) bg-(--color-ink) p-4 text-xs leading-relaxed text-(--color-paper)">
      {children}
    </pre>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="mt-6 space-y-5">{children}</ol>;
}

function Step({ n, title, state, children }: { n: number; title: string; state?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 border-t border-(--color-rule) pt-4 first:border-t-0 first:pt-0">
      <span className="tabular text-lg text-(--color-accent)">{String(n).padStart(2, '0')}</span>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-base text-(--color-paper)">{title}</h3>
          {state}
        </div>
        <div className="mt-2 max-w-2xl space-y-2 text-sm leading-relaxed text-(--color-paper-dim)">{children}</div>
      </div>
    </li>
  );
}

function Section({ id, title, lede, state, children }: { id: string; title: string; lede: string; state: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">{title}</h2>
        {state}
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">{lede}</p>
      {children}
    </section>
  );
}

const LADDER: ReadonlyArray<readonly [LaunchStep, string]> = [
  ['TREASURY_RECORDED', 'The treasury: a 2-of-3 Safe on Robinhood Chain, its creation read back from the chain.'],
  ['DESK_CONFIGURED', 'The token launched at the decided venue and the credit desk deployed pointing at it and the treasury; both recorded from the chain.'],
  ['CODE_VERIFIED', "The desk's code read from the chain and matched against the build, its two immutables checked."],
  ['RATE_READ', 'The pool recorded and a rate read from it at a block; the desk quotes.'],
  ['TOP_UP_RECORDED', "One small top-up by the operator to their own key, indexed and credited — the last rung before anyone else's."],
];

export default async function GuidePage() {
  const store = await getStoreAsync();
  const [credits, launch] = [creditsStatus(), await launchStatus(store)];
  const deployment = deploymentOf(APPLE_S1.id);
  const deskOpen = credits.state === 'CONFIGURED';
  const seriesLive = deployment.state === 'CONFIGURED';
  const origin = BRAND.origin;
  const stepIndex = LADDER.findIndex(([s]) => s === launch.step);
  const call = SERVICES.find((s) => s.id === 'evidence-versions');
  const journal = SERVICES.find((s) => s.id === 'journal-day');
  const alert = SERVICES.find((s) => s.id === 'alert-delivery');

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <div className="kicker">
          <b>The desk</b> · How to use it
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">
          What you can do here today, step by step. What waits, and on what.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-(--color-paper-dim)">
          Every step below is marked from the configuration the product runs on, at the moment you opened this page: the
          desk is open or it is not, a series is deployed or it is not. Nothing here is a date. The three parts, in the
          order a visitor meets them:
        </p>
        <ul className="mt-6 grid gap-px border border-(--color-rule) bg-(--color-rule) sm:grid-cols-3">
          {[
            ['The desk', 'Read it. Take its data.', <State key="d" tone="live">open · no key needed</State>],
            ['The services', 'Prepaid credit, paid in CURB.', deskOpen ? <State key="s" tone="live">open</State> : <State key="s" tone="wait">not yet · no token, no desk</State>],
            ['The position', 'One company, several issuers.', seriesLive ? <State key="p" tone="live">a series is deployed</State> : <State key="p" tone="wait">simulation only · not deployed</State>],
          ].map(([name, what, state], i) => (
            <li key={i} className="bg-(--color-ink-2) p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-(--color-paper)">{name}</span>
                {state}
              </div>
              <p className="mt-1 text-xs text-(--color-paper-faint)">{what}</p>
            </li>
          ))}
        </ul>
      </header>

      {/* ── 1 · Read the desk ─────────────────────────────────────────── */}
      <Section
        id="read"
        title="1 · Read the desk"
        lede="Ten agents read Robinhood Chain, the pools trading on it and two published registries on a schedule and publish what they measured. Each page is one district of the record; every figure carries where it came from and when it was read, and a figure that could not be read is shown as an absence — never as zero."
        state={<State tone="live">open · no key, no wallet, no account</State>}
      >
        <Steps>
          <Step n={1} title="Start on The Floor: the session and every price with its age">
            <p>
              <A href="/floor">The Floor</A> opens on the Bell&rsquo;s session: whether the exchange is open, on the exchange&rsquo;s own clock (ET), beside
              the chain&rsquo;s, which never closes. Below it, every tokenized-equity feed on the chain with two ages kept apart — how long since the
              oracle published the price, and how long since the desk read it. A price older than its heartbeat is marked stale; a price carried
              across a closed market is a memory, and the page says so.
            </p>
          </Step>
          <Step n={2} title="Check a token in The Registry">
            <p>
              <A href="/registry">The Registry</A> lists every stock token the issuer publishes — {launch.chain}, one beacon they all delegate to — with the
              shares-per-token multiplier read from the chain and any staged change to it. A token whose multiplier is not exactly one is listed as
              such, with the multiplier, not judged. Nothing here says a token is backed, safe, or a scam, in either direction.
            </p>
          </Step>
          <Step n={3} title="See the flow in The Vault">
            <p>
              <A href="/vault">The Vault</A> shows transfer flow as an hourly rate from a sample of blocks — the public node refuses any query that
              matches more than ten thousand logs, so an hour is never totalled; each bar is one sample, and a sample is a rate.
            </p>
          </Step>
          <Step n={4} title="Read the terms and the Warden in Chambers">
            <p>
              <A href="/chambers">Chambers</A> points at the issuers&rsquo; published terms and watches them for change without reading them for meaning, and
              prints the Warden&rsquo;s numbers — sources reached, agents reporting, the oldest input — even when they look bad.
            </p>
          </Step>
          <Step n={5} title="Open the day's Gazette">
            <p>
              <A href="/gazette">The Curb Gazette</A> is composed from the record once a UTC day: what each agent filed, what could not be read and
              why, what the policy gate stopped and kept. The edition for today grows until midnight UTC; a past edition is closed. What a model
              wrote is marked as such and can be absent; the paper&rsquo;s own count never is.
            </p>
          </Step>
          <Step n={6} title="Know the three states">
            <p>
              Every reading is <span className="text-(--color-paper)">verified</span>, <span className="text-(--color-paper)">stale</span>, or{' '}
              <span className="text-(--color-paper)">unread</span> with a reason. The rules that decide which are in the <A href="/doctrine">doctrine</A>,
              each naming the file that enforces it; the agents and what each refuses to say are at <A href="/agents">the agents</A>.
            </p>
          </Step>
        </Steps>
      </Section>

      {/* ── 2 · Take the data ─────────────────────────────────────────── */}
      <Section
        id="api"
        title="2 · Take the data"
        lede="Everything the pages show is served as JSON from the same record, with no key and no account. Each response carries the time it was composed and, on every figure, the source and the time it was read."
        state={<State tone="live">open · no key needed</State>}
      >
        <Steps>
          <Step n={1} title="Ask for the record">
            <p>The whole desk in one read: agent health, the chain head, the policy conditions, the counts.</p>
            <Block>{`curl -s ${origin}/api/state`}</Block>
          </Step>
          <Step n={2} title="Ask a district">
            <p>The Floor, the Registry and the positions each have their own endpoint; the Gazette is addressed by UTC day.</p>
            <Block>{`curl -s ${origin}/api/floor\ncurl -s ${origin}/api/registry\ncurl -s ${origin}/api/positions\ncurl -s ${origin}/api/gazette/2026-09-17`}</Block>
          </Step>
          <Step n={3} title="Read a figure the way the desk does">
            <p>
              A price comes with <Code>updatedAt</Code> (when the oracle published it) and <Code>retrievedAt</Code> (when the desk read it). Treat the
              older of the two as the age. A field that is <Code>null</Code> was not read; the reason is beside it. No endpoint here interpolates,
              forecasts or rounds a number it did not read.
            </p>
          </Step>
        </Steps>
      </Section>

      {/* ── 3 · The position ──────────────────────────────────────────── */}
      <Section
        id="position"
        title="3 · The position"
        lede="One company, several issuers, one position — the composition inspectable, the right to every component recorded, each component withdrawn on its own. The mechanism is written; the ledger that implements it is tested against the blueprint's cases; the contract is a prototype exercised on forks."
        state={seriesLive ? <State tone="live">a series is deployed</State> : <State tone="wait">simulation only · no series deployed</State>}
      >
        <Steps>
          <Step n={1} title="Run the simulation" state={<State tone="live">open</State>}>
            <p>
              <A href={`/positions/${APPLE_S1.id}`}>{APPLE_S1.name}</A> walks one position through its life in illustrative units — no prices, no
              chain: form lots from two components, see the claims per component, exit one component while the other stays. The units are
              labelled illustrative wherever they are shown.
            </p>
          </Step>
          <Step n={2} title="Read the mechanism and the decisions" state={<State tone="live">open</State>}>
            <p>
              <A href="/mechanism">The mechanism</A> is the blueprint the product is built to, rendered from the file. The choices it asks to be
              written down are the <A href="/mechanism/decisions">decision records</A>: six design records and an operator policy, marked proposed
              until a named person decides, and the token record, decided.
            </p>
          </Step>
          <Step n={3} title="Look up an address" state={seriesLive ? <State tone="live">open</State> : <State tone="wait">answers empty · no series</State>}>
            <p>
              Paste an address on the series page, or ask the API: what the index holds for it — active receipts, entitled units, open exit
              claims per component. Nothing is connected and nothing is sent.
            </p>
            <Block>{`curl -s ${origin}/api/wallets/0x…/positions\ncurl -s ${origin}/api/wallets/0x…/claims`}</Block>
            {seriesLive ? null : (
              <p>
                Today the answer is empty for every address: {deployment.state === 'NOT_DEPLOYED' ? deployment.detail : 'the deployment configuration is invalid'}.
                The index and the reconciliation exist and are exercised against a local chain; they read a real series the day one is configured.
              </p>
            )}
          </Step>
          <Step n={4} title="Form a position, exit a component" state={seriesLive ? <State tone="live">open</State> : <State tone="wait">not yet</State>}>
            <p>
              When a series is deployed, a holder deposits the components in the series&rsquo; proportion and receives a non-transferable receipt for the
              lot; exit is per component, and a component that cannot yet be transferred stays as a recorded claim that is never erased. What is
              required before that day is on the record, gate by gate: identities and the dependency map, a written rights review, permitted
              acquisition, an independent review of the contract, the series operator, the actual lot and its cost — none decided by a model,
              each by a named person.
            </p>
          </Step>
        </Steps>
      </Section>

      {/* ── 4 · The services ──────────────────────────────────────────── */}
      <Section
        id="services"
        title="4 · Use a service"
        lede="Free to use. Every service answers an ordinary request and nothing is charged for any of them. A key is still made in your browser and never sent, but it is only a name: it says whose webhook a subscription is, so the right changes reach the right place. It needs no top-up and nothing about it is looked up on chain."
        state={<State tone="live">open · free</State>}
      >
        <Steps>
          <Step n={1} title="Make a key" state={<State tone="live">works today</State>}>
            <p>
              On <A href="/services">Services</A>, press <em>Make a key</em>: thirty-two random bytes from your browser, shown once as{' '}
              <Code>curb_…</Code>, and its SHA-256 hash. Copy the key. The desk stores neither, and while it is free a lost key costs
              nothing — raise another. Without a browser: <Code>POST {origin}/api/keys</Code> returns a fresh pair and records nothing.
            </p>
          </Step>
          <Step n={2} title="Get a quote" state={deskOpen ? <State tone="live">open</State> : <State tone="wait">no pool to read</State>}>
            <p>
              Type an amount in dollars; the page answers how much CURB that is at the last rate the desk read from the pool, at the block it read
              it, with a margin for the price moving before your transaction lands. The opening minimum is {dollars(MINIMUM_OPEN_CENTS)}, cumulative,
              retained as credit balance — decided by the product owner on 12 September 2026.
            </p>
          </Step>
          <Step n={3} title="Top up from any wallet" state={deskOpen ? <State tone="live">open</State> : <State tone="wait">no desk deployed</State>}>
            <p>
              Approve the desk to move that much CURB, then call <Code>topUp(keyHash, amount)</Code> on it — the page composes the calldata beside the
              desk&rsquo;s address, read from the configuration and checked against the code on chain every tick. The CURB goes to the published
              treasury{launch.treasury ? ` (${shortAddress(launch.treasury.address)}, a 2-of-3 Safe)` : ''}; the desk holds nothing and has no admin. Your
              top-up is credited after {confirmationsFor(4663)} confirmations, at the rate read at its block; until then it shows on the balance page as
              read, with why it waits.
            </p>
          </Step>
          <Step n={4} title="Call a paid endpoint" state={deskOpen ? <State tone="live">open</State> : <State tone="wait">nothing credited yet</State>}>
            <p>
              Send the key as <Code>x-curb-key</Code> (or <Code>Authorization: Bearer</Code>). {call?.title} — {call?.what.toLowerCase()} — is{' '}
              {dollars(call?.cents ?? 0)} a call; {journal?.title.toLowerCase()} — {journal?.what.toLowerCase()} — is {dollars(journal?.cents ?? 0)} a call. The
              response says what it charged and what is left.
            </p>
            <Block>{`curl -s -H "x-curb-key: curb_…" \\\n  "${origin}${call?.path.replace('<series>', APPLE_S1.id).replace('<id>', 'xstocks-terms') ?? ''}"\n# → x-curb-charged-cents: ${call?.cents}   x-curb-balance-cents: …`}</Block>
          </Step>
          <Step n={5} title="Register a webhook for alerts" state={deskOpen ? <State tone="live">open</State> : <State tone="wait">nothing credited yet</State>}>
            <p>
              Name a webhook and the tokens you hold (or none, for every token). You are told when one of them has a multiplier
              change staged and when it takes effect, when its issuer sets the pause flag, when its price is past heartbeat while
              the exchange is open — and of the issuer&rsquo;s and the chain&rsquo;s events, which concern every token: the beacon moving,
              the registry drifting, a terms page changing, the head stalling. Once when raised, once when cleared.{' '}
              {dollars(alert?.cents ?? 0)} a delivery; registering and cancelling are free. The catalogue is on the{' '}
              <A href="/services#alerts">services page</A>.
            </p>
            <Block>{`curl -s -X POST -H "x-curb-key: curb_…" -H "content-type: application/json" \\\n  -d '{"url":"https://example.com/curb","tokens":["AAPL","TSLA"]}' ${origin}/api/subscriptions`}</Block>
          </Step>
          <Step n={6} title="Check a balance" state={<State tone="live">works today</State>}>
            <p>
              <Code>GET {origin}/api/keys/&lt;hash&gt;</Code> shows what the chain credited to a hash and how many calls consumed it — public, since the
              top-ups are on chain. The charges themselves, with their references, are returned only to a request that carries the key.
            </p>
          </Step>
          <Step n={7} title="Know what a credit is">
            <p>
              A credit is a prepaid unit of service: not a deposit, not an investment, not a claim on anything, and not refundable in dollars or in
              CURB — the contract has no refund path and the desk offers none. Credits do not expire while the service they can buy is offered; a
              service closes, or a price changes, with thirty days&rsquo; notice on the services page and in the journal. The whole term is in{' '}
              <A href="/mechanism/decisions/token">the token record</A>.
            </p>
          </Step>
        </Steps>
      </Section>

      {/* ── 5 · What waits, and on what ───────────────────────────────── */}
      <Section
        id="ladder"
        title="5 · What waits, and on what"
        lede={launch.line}
        state={<State tone={launch.step === 'TOP_UP_RECORDED' ? 'live' : 'fog'}>rung {Math.max(stepIndex + 1, 0)} of {LADDER.length}</State>}
      >
        <ol className="mt-6 space-y-3">
          {LADDER.map(([step, what], i) => {
            const done = i <= stepIndex;
            const next = i === stepIndex + 1;
            return (
              <li key={step} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 border-t border-(--color-rule) pt-3 first:border-t-0 first:pt-0">
                <span className="tabular text-lg" style={{ color: done ? 'var(--color-state-live)' : next ? 'var(--color-state-stale)' : 'var(--color-state-fog)' }}>
                  {done ? '✓' : String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">{what}</p>
                  {done ? <State tone="live">on the record</State> : next ? <State tone="wait">next</State> : <State tone="fog">after that</State>}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">
          The rungs are people&rsquo;s decisions, recorded when made: the venue&rsquo;s terms read by counsel, the sender named, the budget approved, the
          independent review closed. Each is listed with what it needs in <A href="/mechanism/decisions/launch">the launch checklist</A>; the desk
          reports what is on the record and authorizes nothing. Nothing is sold until the last rung; when it is, this page changes with the
          configuration, not before.
        </p>
        {launch.faults.length > 0 ? (
          <p className="mt-4 max-w-2xl text-xs leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
            Read with a fault: {launch.faults.join('; ')}.
          </p>
        ) : null}
      </Section>
    </main>
  );
}
