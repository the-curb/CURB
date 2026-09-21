import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { isFree } from '@/lib/credits/access';
import { launchStatus, type LaunchStep } from '@/lib/launch/status';
import { deploymentOf } from '@/lib/positions/deployments';
import { APPLE_S1, GATES } from '@/lib/positions/series';
import { WIDE_BASIS_BPS } from '@/lib/ops/alerts';
import { getStoreAsync } from '@/lib/store';
import { GUIDE, withGuideBand, type GuideStep } from '@/lib/copy/guide';

export const dynamic = 'force-dynamic';
export const metadata = { title: GUIDE.title, description: GUIDE.description };

/**
 * The instructions. Every step is either something a visitor can do now or
 * something that waits, and the page decides which from the same state the
 * product runs on — the access mode the guard reads, the series deployment,
 * the launch record — so it cannot describe a desk, a price or a series that
 * is not the one actually running. Every word is from `lib/copy/guide.ts`.
 */

function State({ tone, children }: { tone: 'live' | 'wait' | 'fog'; children: React.ReactNode }) {
  const color = tone === 'live' ? 'var(--color-state-live)' : tone === 'wait' ? 'var(--color-state-stale)' : 'var(--color-state-fog)';
  return (
    <span className="tabular text-[10px] uppercase tracking-[0.16em]" style={{ color }}>
      {children}
    </span>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-(--color-paper) underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-accent)">
      {children}
    </Link>
  );
}

function Block({ children }: { children: string }) {
  return <pre className="tabular mt-3 overflow-x-auto border border-(--color-rule) bg-(--color-ink) p-4 text-xs leading-relaxed text-(--color-paper)">{children}</pre>;
}

function Section({ id, title, lede, state, children }: { id: string; title: string; lede: string; state: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 border border-(--color-rule) bg-(--color-ink-2) p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-(--color-paper-faint)">{title}</h2>
        {state}
      </div>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-(--color-paper)">{lede}</p>
      {children}
    </section>
  );
}

/** One numbered step: a title, a few short lines, an optional link and an optional block of code. */
function Step({ n, step, state, extra, band }: { n: number; step: GuideStep; state?: React.ReactNode; extra?: React.ReactNode; band: number }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 border-t border-(--color-rule) pt-4 first:border-t-0 first:pt-0">
      <span className="tabular text-lg text-(--color-accent)">{String(n).padStart(2, '0')}</span>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-base text-(--color-paper)">{step.title}</h3>
          {state}
        </div>
        <div className="mt-1.5 max-w-2xl space-y-1 text-sm leading-relaxed text-(--color-paper-dim)">
          {step.body.map((line) => (
            <p key={line}>{withGuideBand(line, band)}</p>
          ))}
          {step.href && step.link ? (
            <p className="pt-1">
              <A href={step.href}>{step.link} →</A>
            </p>
          ) : null}
        </div>
        {extra}
      </div>
    </li>
  );
}

const LADDER: readonly Exclude<LaunchStep, 'NOTHING'>[] = ['TREASURY_RECORDED', 'DESK_CONFIGURED', 'CODE_VERIFIED', 'RATE_READ', 'TOP_UP_RECORDED'];

export default async function GuidePage() {
  const store = await getStoreAsync();
  const launch = await launchStatus(store);
  const deployment = deploymentOf(APPLE_S1.id);
  const seriesLive = deployment.state === 'CONFIGURED';
  const free = isFree();
  const origin = BRAND.origin;
  const today = new Date().toISOString().slice(0, 10);
  const stepIndex = LADDER.findIndex((s) => s === launch.step);
  const gatesPassed = GATES.filter((g) => g.status === 'PASSED').length;
  const band = WIDE_BASIS_BPS;

  const parts: readonly { part: { name: string; what: string }; href: string; state: React.ReactNode }[] = [
    { part: GUIDE.parts.read, href: '#read', state: <State tone="live">open</State> },
    { part: GUIDE.parts.alerts, href: '#alerts', state: free ? <State tone="live">open</State> : <State tone="wait">paid</State> },
    { part: GUIDE.parts.position, href: '#position', state: seriesLive ? <State tone="live">a series is live</State> : <State tone="wait">simulation only</State> },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <div className="kicker">
          <b>The desk</b> · {GUIDE.kicker}
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{GUIDE.headline}</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-(--color-paper-dim)">{GUIDE.sub}</p>
        <ul className="mt-6 grid gap-px border border-(--color-rule) bg-(--color-rule) sm:grid-cols-3">
          {parts.map(({ part, href, state }) => (
            <li key={part.name} className="bg-(--color-ink-2)">
              <a href={href} className="block p-4 hover:bg-(--color-ink-3)">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm text-(--color-paper)">{part.name}</span>
                  {state}
                </div>
                <p className="mt-1 text-xs text-(--color-paper-faint)">{part.what}</p>
              </a>
            </li>
          ))}
        </ul>
      </header>

      {/* ── 1 · READ THE PRICES ───────────────────────────────────────────── */}
      <Section id="read" title={GUIDE.read.title} lede={GUIDE.read.lede} state={<State tone="live">open · no wallet, no account</State>}>
        <ol className="mt-6 space-y-5">
          {GUIDE.read.steps.map((step, i) => (
            <Step key={step.title} n={i + 1} step={step} band={band} />
          ))}
        </ol>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">
          {GUIDE.read.states} <A href="/doctrine">{GUIDE.read.doctrine} →</A>
        </p>
      </Section>

      {/* ── 2 · GET ALERTS ────────────────────────────────────────────────── */}
      <Section id="alerts" title={GUIDE.alerts.title} lede={GUIDE.alerts.lede} state={free ? <State tone="live">open</State> : <State tone="wait">paid</State>}>
        {free ? (
          <>
            <ol className="mt-6 space-y-5">
              {GUIDE.alerts.steps.map((step, i) => (
                <Step
                  key={step.title}
                  n={i + 1}
                  step={step}
                  band={band}
                  extra={
                    i === 1 ? (
                      <Block>{`curl -s -X POST ${origin}/api/subscriptions \\\n  -H "x-curb-key: curb_…" -H "content-type: application/json" \\\n  -d '{"url":"https://example.com/curb","tokens":["AAPL","TSLA"]}'`}</Block>
                    ) : i === 3 ? (
                      <Block>{`curl -s -X DELETE ${origin}/api/subscriptions \\\n  -H "x-curb-key: curb_…" -d '{"id":"…"}'`}</Block>
                    ) : null
                  }
                />
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">
            {GUIDE.alerts.paid} <A href="/services">Services →</A>
          </p>
        )}
      </Section>

      {/* ── 3 · TAKE THE DATA ─────────────────────────────────────────────── */}
      <Section id="api" title={GUIDE.api.title} lede={GUIDE.api.lede} state={<State tone="live">open · no key</State>}>
        <ol className="mt-6 space-y-5">
          {GUIDE.api.steps.map((step, i) => (
            <Step
              key={step.title}
              n={i + 1}
              step={step}
              band={band}
              extra={
                i === 0 ? (
                  <Block>{`curl -s ${origin}/api/state`}</Block>
                ) : i === 1 ? (
                  <Block>{`curl -s ${origin}/api/floor\ncurl -s ${origin}/api/registry\ncurl -s ${origin}/api/positions\ncurl -s ${origin}/api/gazette/${today}`}</Block>
                ) : null
              }
            />
          ))}
        </ol>
      </Section>

      {/* ── 4 · THE POSITION ──────────────────────────────────────────────── */}
      <Section id="position" title={GUIDE.position.title} lede={GUIDE.position.lede} state={seriesLive ? <State tone="live">a series is live</State> : <State tone="wait">simulation only</State>}>
        <ol className="mt-6 space-y-5">
          {GUIDE.position.steps.map((step, i) => (
            <Step
              key={step.title}
              n={i + 1}
              step={i === 0 ? { ...step, href: `/positions/${APPLE_S1.id}`, link: `Open ${APPLE_S1.name}` } : step}
              band={band}
              state={
                i === 2 ? (
                  seriesLive ? <State tone="live">open</State> : <State tone="wait">empty until live</State>
                ) : i === 3 ? (
                  <State tone="fog">{`${gatesPassed} of ${GATES.length} passed`}</State>
                ) : undefined
              }
              extra={
                i === 2 ? (
                  <>
                    <Block>{`curl -s ${origin}/api/wallets/0x…/positions\ncurl -s ${origin}/api/wallets/0x…/claims`}</Block>
                    {seriesLive ? null : <p className="mt-2 text-sm text-(--color-paper-faint)">{GUIDE.position.emptyLookup}</p>}
                  </>
                ) : null
              }
            />
          ))}
        </ol>
      </Section>

      {/* ── 5 · THE TOKEN ─────────────────────────────────────────────────── */}
      <Section
        id="token"
        title={GUIDE.token.title}
        lede={GUIDE.token.lede}
        state={<State tone={launch.step === 'TOP_UP_RECORDED' ? 'live' : 'fog'}>{`step ${Math.max(stepIndex + 1, 0)} of ${LADDER.length}`}</State>}
      >
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">{GUIDE.token.holders}</p>
        <p className="mt-5 text-[11px] uppercase tracking-[0.16em] text-(--color-paper-faint)">{GUIDE.token.ladder}</p>
        <ol className="mt-4 space-y-3">
          {LADDER.map((step, i) => {
            const done = i <= stepIndex;
            const next = i === stepIndex + 1;
            return (
              <li key={step} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 border-t border-(--color-rule) pt-3 first:border-t-0 first:pt-0">
                <span className="tabular text-lg" style={{ color: done ? 'var(--color-state-live)' : next ? 'var(--color-state-stale)' : 'var(--color-state-fog)' }}>
                  {done ? '✓' : String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="text-sm leading-relaxed text-(--color-paper-dim)">{GUIDE.token.rungs[step]}</p>
                  {done ? <State tone="live">done</State> : next ? <State tone="wait">next</State> : <State tone="fog">later</State>}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-(--color-paper-dim)">
          {GUIDE.token.decided} <A href="/mechanism/decisions/launch">{GUIDE.token.checklist} →</A>
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
