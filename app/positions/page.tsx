import Link from 'next/link';
import { GATES, SERIES, STEPS } from '@/lib/positions/series';
import { POSITIONS } from '@/lib/copy/positions';

export const dynamic = 'force-dynamic';
export const metadata = { title: POSITIONS.index.title, description: POSITIONS.index.description };

const C = POSITIONS.index;

/**
 * The positions the site describes. One, in design. What a holder would see
 * first: the stage the product is at, then the company, the two issuers, the
 * network and the composition per lot.
 */
export default function PositionsPage() {
  const passed = GATES.filter((g) => g.status === 'PASSED').length;
  return (
    <main className="px-3 py-8 sm:px-4 sm:py-10">
      <header className="mb-8 px-1">
        <div className="kicker">
          <b>{C.kicker}</b>
        </div>
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{C.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">{C.sub}</p>
        <ul className="mt-4 max-w-2xl space-y-1 text-sm leading-relaxed text-(--color-paper-faint)">
          {POSITIONS.status.map((line) => (
            <li key={line}>— {line}</li>
          ))}
        </ul>
      </header>

      <div className="cells grid-cols-1">
        {SERIES.map((s) => (
          <div key={s.id} className="cells !border-0 grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="cell p-6 sm:p-8">
              <div className="kicker">
                {s.company} · {s.chain.split(' — ')[0]}
              </div>
              <h2 className="display mt-3 text-3xl text-(--color-paper) sm:text-4xl">{s.name}</h2>
              <dl className="tabular mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[12px]">
                <dt className="text-(--color-paper-faint)">{C.rows.stage}</dt>
                <dd className="text-(--color-paper)">{C.stage}</dd>
                <dt className="text-(--color-paper-faint)">{C.rows.checks}</dt>
                <dd className="text-(--color-paper)">
                  {passed} / {GATES.length}
                </dd>
                <dt className="text-(--color-paper-faint)">{C.rows.receipt}</dt>
                <dd className="text-(--color-paper)">{C.receipt}</dd>
                <dt className="text-(--color-paper-faint)">{C.rows.symbol}</dt>
                <dd className="text-(--color-paper)">
                  {s.illustrativeSymbol} <span className="text-(--color-paper-faint)">— {C.illustrative}</span>
                </dd>
              </dl>
              <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
                <Link href={`/positions/${s.id}`} className="display inline-block text-2xl text-(--color-paper) underline decoration-(--color-accent) decoration-1 underline-offset-[10px] hover:text-(--color-accent)">
                  {C.try} →
                </Link>
                <Link href="/mechanism" className="kicker hover:text-(--color-paper)">
                  {C.mechanism}
                </Link>
              </div>
            </div>
            <div className="cells !border-0 grid-cols-1 sm:grid-cols-2">
              {s.components.map((c) => (
                <div key={c.id} className="cell p-6 sm:p-8">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="kicker">
                      {C.part} {c.id}
                    </span>
                    <span className="kicker" style={{ color: 'var(--color-state-stale)' }}>
                      {c.verification.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-3 text-base leading-snug text-(--color-paper)">{c.instrument}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-(--color-paper-dim)">{c.issuer}</p>
                  <dl className="tabular mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                    <dt className="text-(--color-paper-faint)">{C.network}</dt>
                    <dd className="text-(--color-paper-dim)">{c.chain}</dd>
                    <dt className="text-(--color-paper-faint)">{C.units}</dt>
                    <dd className="text-(--color-paper-dim)">
                      {c.perLotIllustrative.toString()} <span className="text-(--color-paper-faint)">{C.unitsNote}</span>
                    </dd>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <div className="cells grid-cols-1 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="cell p-6 sm:p-8">
              <span className="tabular text-sm text-(--color-accent)">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="display mt-2 text-2xl text-(--color-paper)">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-paper-dim)">{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
