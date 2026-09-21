'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ABSENT_GLYPH } from '@/lib/doctrine/reading';
import { REGISTRY, registryLine } from '@/lib/copy/registry';

/** One token as the page hands it over: every value already read and formatted on the server. */
export interface RegistryRowView {
  readonly key: string;
  readonly ticker: string;
  readonly company: string;
  readonly address: string;
  readonly multiplier: string | null;
  readonly multiplierExact: string | null;
  readonly notAtOne: boolean | null;
  readonly pending: { readonly shown: string; readonly effectiveAt: string | null } | null;
  readonly supply: string | null;
  readonly hasFeed: boolean;
  readonly feedName: string | null;
  readonly checked: string | null;
  readonly unreadBecause: string | null;
}

type Filter = 'all' | 'notAtOne' | 'pending' | 'noPrice';

const T = REGISTRY.table;

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

/**
 * The roll, searchable. Every token is here; the first screen shows the
 * tokens that need a second look — a change coming, or not at one share —
 * and a reader can search, filter, or open the whole list. Nothing is
 * computed in the browser: it only chooses which of the server's rows to show.
 */
export function RegistryTable({ rows, initial = 20 }: { rows: readonly RegistryRowView[]; initial?: number }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'notAtOne' && r.notAtOne !== true) return false;
      if (filter === 'pending' && r.pending === null) return false;
      if (filter === 'noPrice' && r.hasFeed) return false;
      return q === '' || r.ticker.toLowerCase().includes(q) || r.company.toLowerCase().includes(q);
    });
  }, [rows, query, filter]);

  const narrowed = query.trim() !== '' || filter !== 'all';
  const shown = narrowed || expanded ? matches : matches.slice(0, initial);
  const counts: Record<Filter, number> = {
    all: rows.length,
    notAtOne: rows.filter((r) => r.notAtOne === true).length,
    pending: rows.filter((r) => r.pending !== null).length,
    noPrice: rows.filter((r) => !r.hasFeed).length,
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={T.search}
          aria-label={T.search}
          className="w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-sm text-(--color-paper) outline-none focus:border-(--color-accent) sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
          {(Object.keys(T.filters) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`tabular border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] ${filter === f ? 'border-(--color-accent) text-(--color-paper)' : 'border-(--color-rule) text-(--color-paper-faint) hover:text-(--color-paper)'}`}
            >
              {T.filters[f]} <span className="text-(--color-paper-faint)">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
            <th className="pb-2 pr-3 font-normal">{T.columns.token}</th>
            <th className="hidden pb-2 pr-3 font-normal sm:table-cell">{T.columns.company}</th>
            <th className="pb-2 pr-3 text-right font-normal">{T.columns.shares}</th>
            <th className="pb-2 pr-3 font-normal">{T.columns.coming}</th>
            <th className="hidden pb-2 pr-3 text-right font-normal md:table-cell">{T.columns.supply}</th>
            <th className="pb-2 pr-3 font-normal">{T.columns.price}</th>
            <th className="hidden pb-2 text-right font-normal sm:table-cell">{T.columns.checked}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.key} className="border-t border-(--color-rule)">
              <td className="py-2 pr-3 align-baseline">
                <span className="text-sm tracking-[0.06em] text-(--color-paper)" title={`${row.company} · ${row.address}`}>
                  {row.ticker}
                </span>
              </td>
              <td className="hidden py-2 pr-3 align-baseline text-xs text-(--color-paper-dim) sm:table-cell">{row.company}</td>
              <td className="py-2 pr-3 text-right align-baseline">
                {row.multiplier === null ? (
                  <Absent why={row.unreadBecause ?? 'not read'} />
                ) : (
                  <span className="tabular text-sm" style={{ color: row.notAtOne ? 'var(--color-brass)' : 'var(--color-paper)' }} title={row.multiplierExact ?? undefined}>
                    {row.multiplier}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 align-baseline text-xs">
                {row.pending === null ? (
                  <span className="text-(--color-paper-faint)">{row.multiplier === null ? '' : T.values.none}</span>
                ) : (
                  <span style={{ color: 'var(--color-brass)' }} title={row.pending.effectiveAt ?? 'effective time not readable'}>
                    → {row.pending.shown}
                  </span>
                )}
              </td>
              <td className="hidden py-2 pr-3 text-right align-baseline text-xs text-(--color-paper-dim) md:table-cell">
                {row.supply === null ? <Absent why={row.unreadBecause ?? 'not read'} /> : <span className="tabular">{row.supply}</span>}
              </td>
              <td className="py-2 pr-3 align-baseline text-xs">
                {row.hasFeed ? (
                  <Link href="/floor" className="text-(--color-paper-faint) underline decoration-(--color-rule) underline-offset-4 hover:text-(--color-paper)" title={row.feedName ?? undefined}>
                    {T.values.onFloor}
                  </Link>
                ) : (
                  <Absent why={T.noPrice} />
                )}
              </td>
              <td className="hidden py-2 text-right align-baseline text-xs text-(--color-paper-faint) sm:table-cell">
                {row.checked === null ? <Absent why="not yet read" /> : <span className="tabular">{row.checked}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown.length === 0 ? <p className="mt-4 text-sm text-(--color-paper-faint)">{T.none}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-(--color-paper-faint)">
        <span className="tabular">{registryLine(T.showing, { n: shown.length, total: rows.length })}</span>
        {!narrowed && matches.length > initial ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="kicker underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">
            {expanded ? T.showFewer : registryLine(T.showAll, { total: rows.length })}
          </button>
        ) : null}
      </div>
    </div>
  );
}
