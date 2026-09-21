import { DeskNav } from '../components/desk-nav';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { composeFlow, composeSeries, FLOW_SERIES, type FlowSeries } from '@/lib/vault/flow';
import { parseActive } from '@/lib/vault/active';
import { STOCK_TOKENS } from '@/lib/chain/stock-tokens';
import { getStoreAsync } from '@/lib/store';
import { VAULT, vaultLine } from '@/lib/copy/vault';

export const dynamic = 'force-dynamic';
export const metadata = { title: VAULT.title, description: VAULT.description };

/**
 * THE VAULT — flow over the day. Every figure is a rate inside a sample of
 * about a minute of chain time; the bars are those samples in order. There
 * is no total on this page because the Tally cannot read one — the public
 * node refuses a query matching more than ten thousand logs, and this chain
 * makes hundreds of transfers a second — and the page does not add what the
 * agent would not.
 */

const WINDOW_SAMPLES = 48;

const STATE_COLOUR = {
  VERIFIED: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  ABSENT: 'var(--color-state-dark)',
  NONE: 'var(--color-state-fog)',
} as const;

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
    <div className="mt-4 flex h-16 items-end gap-px" aria-label={`${series.points.length} samples, transfers per minute`}>
      {series.points.map((p) => (
        <div
          key={p.at}
          className="flex-1 bg-(--color-brass-dim) hover:bg-(--color-brass)"
          style={{ height: `${high > 0 ? Math.max(2, Math.round((p.perMinute / high) * 100)) : 2}%` }}
          title={`${rate(p.perMinute)} a minute · sampled ${p.at}`}
        />
      ))}
    </div>
  );
}

function SeriesPanel({ series }: { series: FlowSeries }) {
  const stock = series.kind !== 'settlement';
  return (
    <section className="border border-(--color-rule) bg-(--color-ink-2) p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[12px] uppercase tracking-[0.24em] text-(--color-brass)">{stock ? 'Stock tokens' : series.label}</h2>
        <span className="text-[11px] text-(--color-paper-faint)">{stock ? vaultLine(VAULT.series.stocks, { n: STOCK_TOKENS.length }) : VAULT.series.settlement}</span>
      </div>
      {series.unreadBecause !== null ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--color-state-stale)' }}>
          {VAULT.unread} <span className="text-(--color-paper-faint)">({series.unreadBecause})</span>
        </p>
      ) : series.latest === null ? (
        <p className="mt-3 text-sm text-(--color-paper-faint)">{VAULT.noSample}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tabular text-3xl text-(--color-paper)">{rate(series.latest.perMinute)}</span>
            <span className="text-sm text-(--color-paper-dim)">{VAULT.latest}</span>
            <span className="tabular text-xs text-(--color-paper-faint)">
              {series.sampleAgeSeconds === null ? ABSENT_GLYPH : vaultLine(VAULT.sampled, { age: describeAge(series.sampleAgeSeconds) })}
            </span>
          </div>
          <Bars series={series} />
          <p className="tabular mt-3 text-[12px] text-(--color-paper-faint)">
            {series.points.length} {series.points.length === 1 ? VAULT.range.sample : VAULT.range.samples} · {VAULT.range.low} {series.low === null ? ABSENT_GLYPH : rate(series.low)} · {VAULT.range.median}{' '}
            {series.median === null ? ABSENT_GLYPH : rate(series.median)} · {VAULT.range.high} {series.high === null ? ABSENT_GLYPH : rate(series.high)}
          </p>
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
  const state = VAULT.state[flow.sampleState];
  const lastFiling = tally.state === 'UNREAD' ? null : (tally.value[0] ?? null);
  const mostActive = lastFiling?.body.split('\n').find((l) => l.startsWith('— Stock tokens:')) ?? null;
  const active = mostActive === null ? null : parseActive(mostActive);
  // Stock tokens first: they are what the desk is about; the two settlement assets are context.
  const ordered = [...flow.series].sort((a, b) => (a.kind === 'settlement' ? 1 : 0) - (b.kind === 'settlement' ? 1 : 0));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <DeskNav current="THE VAULT" />
        <h1 className="display mt-4 max-w-3xl text-4xl text-(--color-paper) sm:text-5xl">{VAULT.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-(--color-paper-dim)">{VAULT.sub}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-(--color-paper-faint)">
          {VAULT.why} {VAULT.bars}
        </p>
        <p className="mt-4 text-[11px] uppercase tracking-[0.18em]" style={{ color: STATE_COLOUR[flow.sampleState] }} title={state.means}>
          ● {state.label}
          {flow.sampleAgeSeconds === null ? '' : ` · ${vaultLine(VAULT.newest, { age: describeAge(flow.sampleAgeSeconds) })}`}
        </p>
      </header>

      <div className="grid gap-4">
        {ordered.map((s) => (
          <SeriesPanel key={s.key} series={s} />
        ))}
      </div>

      <section className="mt-10 border border-(--color-rule) bg-(--color-ink-2) p-5 sm:p-6">
        <h2 className="text-[12px] uppercase tracking-[0.24em] text-(--color-paper-faint)">{VAULT.active.kicker}</h2>
        {mostActive === null ? (
          <p className="mt-3 text-sm text-(--color-paper-faint)">{lastFiling === null ? <><Absent why="no Tally filing could be read" /> {VAULT.active.unread}</> : VAULT.active.noLine}</p>
        ) : active === null ? (
          // A line this page cannot read back into rows is printed as the Tally wrote it.
          <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">{mostActive.replace(/^— /, '')}</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-(--color-paper-dim)">{vaultLine(VAULT.active.moved, { moved: active.moved, total: active.total, still: active.still })}</p>
            {active.top.length > 0 ? (
              <table className="mt-4 w-full max-w-xl text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
                    <th className="pb-2 pr-4 font-normal">{VAULT.active.columns.token}</th>
                    <th className="pb-2 pr-4 text-right font-normal">{VAULT.active.columns.transfers}</th>
                    <th className="pb-2 pr-4 text-right font-normal">{VAULT.active.columns.senders}</th>
                    <th className="pb-2 text-right font-normal">{VAULT.active.columns.receivers}</th>
                  </tr>
                </thead>
                <tbody>
                  {active.top.map((t) => (
                    <tr key={t.ticker} className="border-t border-(--color-rule)">
                      <td className="py-2 pr-4 tracking-[0.06em] text-(--color-paper)">{t.ticker}</td>
                      <td className="tabular py-2 pr-4 text-right text-(--color-paper)">{t.transfers.toLocaleString('en-US')}</td>
                      <td className="tabular py-2 pr-4 text-right text-(--color-paper-dim)">{t.senders.toLocaleString('en-US')}</td>
                      <td className="tabular py-2 text-right text-(--color-paper-dim)">{t.receivers.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}
        <p className="mt-5 max-w-2xl text-xs leading-relaxed text-(--color-paper-faint)">
          {VAULT.reading} {VAULT.notMeasured}
        </p>
      </section>
    </main>
  );
}
