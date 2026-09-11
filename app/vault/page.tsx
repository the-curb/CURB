import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { composeFlow, composeSeries, FLOW_SERIES, type Flow, type FlowSeries } from '@/lib/vault/flow';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Vault' };

/**
 * THE VAULT — flow over the day. Every figure is a rate inside a sample of
 * about a minute of chain time; the bars are those samples in order. There
 * is no total on this page because the Tally cannot read one, and the page
 * does not add what the agent would not.
 */

const WINDOW_SAMPLES = 48;

const STATE: Record<Flow['sampleState'], { colour: string; label: string; means: string }> = {
  VERIFIED: { colour: 'var(--color-state-live)', label: 'current', means: 'the Tally sampled within its interval' },
  STALE: { colour: 'var(--color-state-stale)', label: 'stale sample', means: 'the Tally has not sampled within its freshness threshold' },
  ABSENT: { colour: 'var(--color-state-dark)', label: 'tally absent', means: 'the Tally was expected and has not reported; every bar here is a memory' },
  NONE: { colour: 'var(--color-state-fog)', label: 'no sample', means: 'the Tally has never written a sample to this store' },
};

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function rate(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function Bars({ series }: { series: FlowSeries }) {
  const high = series.high ?? 0;
  return (
    <div className="mt-3 flex h-16 items-end gap-px" aria-label={`${series.points.length} samples, transfers per minute`}>
      {series.points.map((p) => (
        <div
          key={p.at}
          className="flex-1 bg-[--color-brass-dim] hover:bg-[--color-brass]"
          style={{ height: `${high > 0 ? Math.max(2, Math.round((p.perMinute / high) * 100)) : 2}%` }}
          title={`${rate(p.perMinute)} a minute · sampled ${p.at}`}
        />
      ))}
    </div>
  );
}

function SeriesPanel({ series }: { series: FlowSeries }) {
  return (
    <section className="border border-[--color-rule] bg-[--color-ink-2] p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[11px] uppercase tracking-[0.24em] text-[--color-brass]">{series.label}</h3>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[--color-paper-faint]">
          {series.kind === 'settlement' ? 'settlement asset' : 'all 194 tokens'}
        </span>
      </div>
      {series.unreadBecause !== null ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--color-state-stale)' }}>
          The series could not be read ({series.unreadBecause}). Nothing is drawn; this is not a quiet token.
        </p>
      ) : series.latest === null ? (
        <p className="mt-3 text-sm text-[--color-paper-faint]">No sample yet.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="tabular text-2xl text-[--color-paper]">{rate(series.latest.perMinute)}</span>
            <span className="text-xs text-[--color-paper-dim]">transfers a minute in the last sample</span>
            <span className="tabular text-xs text-[--color-paper-faint]">
              sampled {series.sampleAgeSeconds === null ? ABSENT_GLYPH : `${describeAge(series.sampleAgeSeconds)} ago`}
            </span>
          </div>
          <Bars series={series} />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-[--color-paper-faint]">
            <span>
              {series.points.length} {series.points.length === 1 ? 'sample' : 'samples'} · low <span className="tabular">{series.low === null ? ABSENT_GLYPH : rate(series.low)}</span> · median{' '}
              <span className="tabular">{series.median === null ? ABSENT_GLYPH : rate(series.median)}</span> · high{' '}
              <span className="tabular">{series.high === null ? ABSENT_GLYPH : rate(series.high)}</span>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export default async function VaultPage() {
  const now = new Date();
  const store = await getStoreAsync();
  const [reads, tally] = await Promise.all([
    Promise.all(FLOW_SERIES.map((s) => store.observations(s.key, WINDOW_SAMPLES))),
    store.publicationsByAgent('tally', 1),
  ]);
  const series = FLOW_SERIES.map((spec, i) => composeSeries(spec, reads[i]!, now));
  const flow = composeFlow(series, WINDOW_SAMPLES);
  const state = STATE[flow.sampleState];
  const lastFiling = tally.state === 'UNREAD' ? null : (tally.value[0] ?? null);
  const mostActive = lastFiling?.body.split('\n').find((l) => l.startsWith('— Stock tokens:')) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">

      <header className="mb-10">
        <div className="tracking-mark text-xs text-[--color-brass]">THE VAULT</div>
        <h1 className="mt-4 max-w-2xl text-2xl leading-snug text-[--color-paper] sm:text-3xl">
          Flow, as a rate. Sampled every hour for about a minute of chain time.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[--color-paper-dim]">
          The public node refuses any query that matches more than ten thousand logs and this chain produces hundreds of
          transfers a second, so an hour cannot be totalled from here. What can be read is a sample, and a sample is a
          rate. Each bar is one sample; the day is the shape they make.
        </p>
        <p className="mt-3 text-[11px] uppercase tracking-[0.18em]" style={{ color: state.colour }} title={state.means}>
          ● {state.label}
          {flow.sampleAgeSeconds === null ? '' : ` · newest sample ${describeAge(flow.sampleAgeSeconds)} ago`}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-1">
        {flow.series.map((s) => (
          <SeriesPanel key={s.key} series={s} />
        ))}
      </div>

      <section className="mt-10 border border-[--color-rule] bg-[--color-ink-2] p-5 sm:p-6">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">Most active, in the last sample</h2>
        {mostActive === null ? (
          <p className="mt-3 text-sm text-[--color-paper-faint]">
            {lastFiling === null ? <Absent why="no Tally filing could be read" /> : 'The last filing carries no stock-token line.'}
          </p>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-[--color-paper-dim]">{mostActive.replace(/^— /, '')}</p>
        )}
        <p className="mt-4 text-xs leading-relaxed text-[--color-paper-faint]">
          Transfers against distinct sending and receiving addresses is the pair that separates distribution from churn. Holder
          concentration is a property of the whole history and is not measured here; a ranking built from a sample would look
          authoritative and be wrong.
        </p>
      </section>
    </main>
  );
}
