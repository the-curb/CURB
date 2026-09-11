import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GATES, PROMISES, seriesById, type ComponentStatus } from '@/lib/positions/series';
import { PositionSimulator } from '../../components/position-simulator';

export const dynamic = 'force-dynamic';

/**
 * One series: what it would hold, from whom, what is known and not known
 * about each component, the four statuses each component has to earn on its
 * own, the ledger run by hand, and the gates before any of it touches a real
 * asset. Every figure is labelled illustrative because every figure is.
 */

const STATUS_LABEL: Record<ComponentStatus, { text: string; colour: string }> = {
  NOT_DETERMINED: { text: 'not determined', colour: 'var(--color-state-fog)' },
  YES: { text: 'yes', colour: 'var(--color-state-live)' },
  NO: { text: 'no', colour: 'var(--color-state-dark)' },
};

const GATE_COLOUR: Record<(typeof GATES)[number]['status'], string> = {
  NOT_STARTED: 'var(--color-state-fog)',
  IN_RESEARCH: 'var(--color-state-stale)',
  PASSED: 'var(--color-state-live)',
};

export async function generateMetadata({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;
  const spec = seriesById(series);
  return { title: spec ? spec.name : 'Position' };
}

export default async function SeriesPage({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) notFound();
  const [a, b] = spec.components;

  return (
    <main className="px-3 py-8 sm:px-4 sm:py-10">
      <header className="mb-8 px-1">
        <div className="kicker">
          <b>The position</b> · {spec.company} · <Link href="/positions" className="hover:text-(--color-paper)">all positions</Link>
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{spec.name}</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-(--color-paper-dim)">{spec.stageLine}</p>
      </header>

      {/* ── the components ─────────────────────────────────────────────── */}
      <section>
        <div className="cells grid-cols-1 md:grid-cols-2">
          {[a, b].map((c) => (
            <div key={c.id} className="cell p-6 sm:p-8">
              <div className="flex items-baseline justify-between gap-4">
                <span className="kicker">
                  <b>Component {c.id}</b> · {c.chain}
                </span>
                <span className="kicker" style={{ color: 'var(--color-state-stale)' }}>
                  {c.verification.toLowerCase()}
                </span>
              </div>
              <h2 className="display mt-3 text-2xl text-(--color-paper)">{c.instrument}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-(--color-paper-dim)">{c.issuer}</p>

              <div className="mt-5 grid gap-6 sm:grid-cols-2">
                <div>
                  <div className="kicker">Known · from the issuer’s documents</div>
                  <ul className="mt-2 space-y-2">
                    {c.known.map((line) => (
                      <li key={line} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                        <span className="text-(--color-accent)">—</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="kicker">Not known · not replaced by a guess</div>
                  <ul className="mt-2 space-y-2">
                    {c.unknown.map((line) => (
                      <li key={line} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                        <span className="text-(--color-paper-faint)">—</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-5 border-t border-(--color-rule) pt-4">
                <div className="kicker">Four statuses, each on its own</div>
                <dl className="tabular mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 text-[12px]">
                  {(
                    [
                      ['Transferable from the series to a wallet', c.statuses.transferable],
                      ['Unwrappable, if a wrapper', c.statuses.unwrappable],
                      ['A market offer for the intended size', c.statuses.marketOffer],
                      ['Eligible for redemption through the issuer', c.statuses.issuerRedemption],
                    ] as const
                  ).map(([label, status]) => (
                    <div key={label} className="contents">
                      <dt className="text-(--color-paper-dim)">{label}</dt>
                      <dd className="text-right" style={{ color: STATUS_LABEL[status].colour }}>
                        {STATUS_LABEL[status].text}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-5 border-t border-(--color-rule) pt-4">
                <div className="kicker">Sources</div>
                <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                  {c.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} className="text-[12px] text-(--color-paper-dim) underline decoration-(--color-rule-2) underline-offset-4 hover:text-(--color-paper)" rel="noopener noreferrer" target="_blank">
                        {s.title} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── the ledger, by hand ─────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-6 px-1 pb-3">
          <span className="kicker">
            <b>The ledger</b> · run it yourself
          </span>
          <Link href="/mechanism#7-the-ledger-lots-with-fixed-components" className="hidden text-[13px] text-(--color-paper-faint) hover:text-(--color-paper) sm:inline">
            §7 of the mechanism, in code
          </Link>
        </div>
        <PositionSimulator
          seriesName={spec.name}
          q={{ A: a.perLotIllustrative.toString(), B: b.perLotIllustrative.toString() }}
          capLots={spec.capLotsIllustrative.toString()}
          labels={{ A: a.instrument.split(',')[0] ?? 'A', B: b.instrument.split(',')[0] ?? 'B' }}
        />
      </section>

      {/* ── rules, promises, gates ──────────────────────────────────────── */}
      <section className="mt-8">
        <div className="cells grid-cols-1 lg:grid-cols-3">
          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              <b>The rules</b> of a series
            </div>
            <ul className="mt-3 space-y-2">
              {spec.rules.map((r) => (
                <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper-dim)">
                  <span className="text-(--color-accent)">—</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="cell p-6 sm:p-8">
            <div className="kicker">
              <b>What we will say</b> · and can test
            </div>
            <ul className="mt-3 space-y-2">
              {PROMISES.testable.map((r) => (
                <li key={r} className="grid grid-cols-[1rem_minmax(0,1fr)] text-[13px] leading-relaxed text-(--color-paper)">
                  <span className="text-(--color-accent)">—</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <div className="kicker mt-6">
              <b>What we will not say</b>
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
              <b>Gates</b> before a real asset
            </div>
            <ul className="mt-3 space-y-3">
              {GATES.map((g) => (
                <li key={g.id} className="text-[13px] leading-relaxed">
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-(--color-accent)">{g.id}</span>
                    <span className="text-(--color-paper)">{g.name}</span>
                    <span className="tabular ml-auto text-[10px] uppercase tracking-[0.14em]" style={{ color: GATE_COLOUR[g.status] }}>
                      {g.status.toLowerCase().replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-(--color-paper-faint)">{g.today}</div>
                </li>
              ))}
            </ul>
            <div className="kicker mt-6">Deferred</div>
            <p className="mt-2 text-[12px] leading-relaxed text-(--color-paper-faint)">{spec.deferred.join(' · ')}.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
