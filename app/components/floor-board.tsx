import Link from 'next/link';
import type { Board, BoardRow, SampleState } from '@/lib/floor/board';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { FLOOR } from '@/lib/copy/floor';

/**
 * The Floor board. Every cell is either a value with its age or an absence
 * with its reason — hover a dash to read why. Nothing on this board was read
 * from the chain to draw it; it is the agents' last sample, and the header
 * says how old that sample is.
 *
 * Column names and cell words come from `lib/copy/floor.ts` and are plain on
 * purpose: "Gap" rather than "Basis · bp", "On time" rather than "Heartbeat".
 * The precise terms are still on each cell, on hover, for anyone who wants them.
 */

const STATE_COLOUR: Record<SampleState, string> = {
  VERIFIED: 'var(--color-state-live)',
  STALE: 'var(--color-state-stale)',
  ABSENT: 'var(--color-state-dark)',
  NONE: 'var(--color-state-fog)',
};

/** "−2.06%": a basis in plain percent with a true minus. The basis points stay on hover. */
function percent(bps: number): string {
  const sign = bps > 0 ? '+' : bps < 0 ? '−' : '';
  return `${sign}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

function Dash({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function Age({ seconds, why }: { seconds: number | null; why: string }) {
  if (seconds === null) return <Dash why={why} />;
  return <span className="tabular">{describeAge(seconds)}</span>;
}

function Paused({ row }: { row: BoardRow }) {
  switch (row.pauseFlag) {
    case 'SET':
      return (
        <span style={{ color: 'var(--color-state-dark)' }} title={FLOOR.tips.paused}>
          {FLOOR.values.paused}
        </span>
      );
    case 'CLEAR':
      return <span className="text-(--color-paper-faint)">{FLOOR.values.notPaused}</span>;
    case 'NOT_ASKED':
      return <span className="text-(--color-paper-faint)" title="a crypto feed has no issuer pause switch">{FLOOR.values.notAsked}</span>;
    case 'UNREAD':
      return <Dash why="The pause switch could not be read. Unread is not the same as not paused." />;
    default:
      return <Dash why="The record does not say." />;
  }
}

function OnTime({ row }: { row: BoardRow }) {
  if (row.pastHeartbeat === null) return <Dash why="No update was read, so there is nothing to time." />;
  return row.pastHeartbeat ? (
    <span style={{ color: 'var(--color-state-stale)' }} title={`${FLOOR.tips.late} Promised every ${row.heartbeatSeconds === null ? '?' : describeAge(row.heartbeatSeconds)}.`}>
      {FLOOR.values.late}
    </span>
  ) : (
    <span className="text-(--color-paper-faint)">{FLOOR.values.onTime}</span>
  );
}

function Checked({ row }: { row: BoardRow }) {
  switch (row.identity) {
    case 'MATCHES':
      return <span className="text-(--color-paper-faint)">{FLOOR.values.matches}</span>;
    case 'DRIFT':
      return (
        <span style={{ color: 'var(--color-state-dark)' }} title={FLOOR.tips.changed}>
          {FLOOR.values.changed}
        </span>
      );
    case 'UNREAD':
      return <Dash why="The feed did not describe itself this run. Its price is shown against what we recorded." />;
    default:
      return <Dash why="The record does not say." />;
  }
}

/**
 * The three market cells: what the token trades at here, how far that is from
 * the stock price, and what it takes to move it. Each is a dash when it was
 * not read, with the reason on hover — a market that was not read must never
 * be drawn as a market that agrees with the stock price.
 */
function Market({ row }: { row: BoardRow }) {
  const m = row.market;
  return (
    <>
      <td className="py-2 pr-4 text-right align-baseline">
        {m === null || m.priceUsd === null ? (
          <Dash
            why={
              m === null
                ? FLOOR.tips.noRead
                : m.notPricedBecause !== null
                  ? m.notPricedBecause
                  : m.priceInQuote === null
                    ? FLOOR.tips.noPool
                    : `${FLOOR.tips.noDollar} (${m.priceInQuote} ${m.quoteLabel ?? ''})`
            }
          />
        ) : (
          <span className="tabular text-sm text-(--color-paper)" title={`${FLOOR.tips.chain} ${m.venueLabel ?? ''} · read ${describeAge(m.sampleAgeSeconds)} ago`}>
            {m.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-right align-baseline">
        {m === null || m.basisBps === null ? (
          <Dash why="A gap needs both prices, and one was not read." />
        ) : (
          <span
            className="tabular text-sm"
            style={{ color: Math.abs(m.basisBps) >= 100 ? 'var(--color-state-stale)' : 'var(--color-paper-dim)' }}
            title={`${FLOOR.tips.gap} ${Math.round(m.basisBps)} basis points.`}
          >
            {percent(m.basisBps)}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-dim)">
        {m === null || m.depthUsd === null ? (
          <Dash why="No size could be counted: the pool holds no money, or its price is not in dollars yet." />
        ) : (
          <span className="tabular" title={m.depthIsExact ? FLOOR.tips.movesExact : FLOOR.tips.moves}>
            {m.depthUsd < 1_000
              ? m.depthUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : Math.round(m.depthUsd).toLocaleString('en-US')}
            {m.depthIsExact ? '' : '*'}
          </span>
        )}
      </td>
    </>
  );
}

function Rows({ rows, market = false }: { rows: readonly BoardRow[]; market?: boolean }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.key} className="border-t border-(--color-rule)">
          <td className="py-2 pr-4 align-baseline">
            <span className="text-sm tracking-[0.06em] text-(--color-paper)" title={row.name}>
              {row.label}
            </span>
          </td>
          <td className="py-2 pr-4 text-right align-baseline">
            {row.price === null ? (
              <Dash why={row.notPricedBecause ?? 'Not priced.'} />
            ) : (
              <span className="tabular text-sm text-(--color-paper)" title={FLOOR.tips.stock}>
                {row.price}
              </span>
            )}
          </td>
          {market ? <Market row={row} /> : null}
          <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-dim)" title={FLOOR.tips.age}>
            <Age seconds={row.feedAgeSeconds} why={row.notPricedBecause ?? 'No update was read.'} />
          </td>
          <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-faint)" title={FLOOR.tips.read}>
            <Age seconds={row.sampleAgeSeconds} why="" />
          </td>
          <td className="py-2 pr-4 align-baseline text-xs">
            <OnTime row={row} />
          </td>
          <td className="py-2 pr-4 align-baseline text-xs">
            <Paused row={row} />
          </td>
          <td className="py-2 align-baseline text-xs">
            <Checked row={row} />
          </td>
        </tr>
      ))}
    </>
  );
}

function Head({ market = false, first }: { market?: boolean; first: string }) {
  const c = FLOOR.columns;
  const th = 'pb-2 pr-4 font-normal';
  return (
    <thead>
      <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
        <th className={th}>{first}</th>
        <th className={`${th} text-right`} title={FLOOR.tips.stock}>
          {c.stock}
        </th>
        {market ? (
          <>
            <th className={`${th} text-right`} title={FLOOR.tips.chain}>
              {c.chain}
            </th>
            <th className={`${th} text-right`} title={FLOOR.tips.gap}>
              {c.gap}
            </th>
            <th className={`${th} text-right`} title={FLOOR.tips.moves}>
              {c.moves}
            </th>
          </>
        ) : null}
        <th className={`${th} text-right`} title={FLOOR.tips.age}>
          {c.age}
        </th>
        <th className={`${th} text-right`} title={FLOOR.tips.read}>
          {c.read}
        </th>
        <th className={th} title={FLOOR.tips.late}>
          {c.onTime}
        </th>
        <th className={th} title={FLOOR.tips.paused}>
          {c.paused}
        </th>
        <th className="pb-2 font-normal" title={FLOOR.tips.changed}>
          {c.checked}
        </th>
      </tr>
    </thead>
  );
}

export function FloorBoard({ board, unreadable }: { board: Board | null; unreadable: string | null }) {
  if (board === null) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }} title={unreadable ?? undefined}>
        {FLOOR.unreadable}
      </p>
    );
  }
  const state = FLOOR.state[board.sampleState];
  const colour = STATE_COLOUR[board.sampleState];
  const n = board.counts;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: colour }} title={state.means}>
          ● {state.label}
          {board.sampleAgeSeconds === null ? '' : ` · read ${describeAge(board.sampleAgeSeconds)} ago`}
        </span>
        <span className="tabular text-[11px] text-(--color-paper-faint)">
          {n.priced} of {n.equity} stock prices read · {n.withBasis} priced on both sides
          {board.widestBasisBps === null ? null : (
            <span title={`${Math.round(board.widestBasisBps)} basis points. Which way it closes is not stated.`}> · widest gap {percent(board.widestBasisBps)}</span>
          )}
          {' · '}
          {n.paused} paused{n.drift > 0 ? ` · ${n.drift} changed` : ''}
        </span>
      </div>

      {board.sampleState === 'ABSENT' || board.sampleState === 'STALE' ? (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: colour }}>
          {state.means} {FLOOR.staleNote}
        </p>
      ) : null}

      {board.rows.length === 0 ? (
        <p className="mt-6 text-sm text-(--color-paper-faint)">{FLOOR.empty}</p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse">
              <Head market first={FLOOR.columns.token} />
              <tbody>
                <Rows rows={board.equity} market />
              </tbody>
            </table>
          </div>

          {board.crypto.length > 0 ? (
            <details className="mt-6 border-t border-(--color-rule) pt-4">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">
                {FLOOR.crypto} · {board.crypto.length}
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse">
                  <Head first={FLOOR.columns.feed} />
                  <tbody>
                    <Rows rows={board.crypto} />
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}

      <p className="mt-6 text-xs leading-relaxed text-(--color-paper-faint)">
        {STOCK_TOKEN_COVERAGE.withoutFeed} of {STOCK_TOKEN_COVERAGE.tokensInRegistry} {FLOOR.missing}{' '}
        <Link href="/registry" className="text-(--color-paper-dim) hover:text-(--color-paper)">
          See the Registry →
        </Link>
      </p>
    </div>
  );
}
