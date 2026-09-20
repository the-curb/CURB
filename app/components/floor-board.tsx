import Link from 'next/link';
import type { Board, BoardRow, SampleState } from '@/lib/floor/board';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';

/**
 * The Floor board. Every cell is either a value with its age or an absence
 * with its reason — hover an em dash to read why. Nothing on this board was
 * read from the chain to draw it; it is the Pillar's last sample, and the
 * header says how old that sample is.
 */

const SAMPLE_STATE: Record<SampleState, { colour: string; label: string; means: string }> = {
  VERIFIED: { colour: 'var(--color-state-live)', label: 'current', means: 'the Pillar sampled within its interval' },
  STALE: { colour: 'var(--color-state-stale)', label: 'stale sample', means: 'the Pillar has not sampled within its freshness threshold; these are the last values it took' },
  ABSENT: { colour: 'var(--color-state-dark)', label: 'pillar absent', means: 'the Pillar was expected and has not reported; every value here is a memory' },
  NONE: { colour: 'var(--color-state-fog)', label: 'no sample', means: 'the Pillar has never written a snapshot to this store' },
};

function Age({ seconds, why }: { seconds: number | null; why: string }) {
  if (seconds === null) {
    return (
      <span className="absent" title={why}>
        {ABSENT_GLYPH}
      </span>
    );
  }
  return <span className="tabular">{describeAge(seconds)}</span>;
}

function Flag({ row }: { row: BoardRow }) {
  switch (row.pauseFlag) {
    case 'SET':
      return (
        <span style={{ color: 'var(--color-state-dark)' }} title="the issuer's oracle pause flag reads set: the feed holds its last value while it is set">
          paused
        </span>
      );
    case 'CLEAR':
      return <span className="text-(--color-paper-faint)">clear</span>;
    case 'UNREAD':
      return (
        <span className="absent" title="the pause flag could not be read — not readable is not the same as clear">
          {ABSENT_GLYPH}
        </span>
      );
    case 'NOT_ASKED':
      return <span className="text-(--color-paper-faint)" title="a crypto feed has no issuer pause flag">n/a</span>;
    default:
      return (
        <span className="absent" title="the snapshot does not record the flag">
          {ABSENT_GLYPH}
        </span>
      );
  }
}

function Heartbeat({ row }: { row: BoardRow }) {
  if (row.pastHeartbeat === null) {
    return (
      <span className="absent" title="no round was read, so there is no age to judge">
        {ABSENT_GLYPH}
      </span>
    );
  }
  return row.pastHeartbeat ? (
    <span style={{ color: 'var(--color-state-stale)' }} title={`older than the published heartbeat of ${row.heartbeatSeconds === null ? '?' : describeAge(row.heartbeatSeconds)}`}>
      past
    </span>
  ) : (
    <span className="text-(--color-paper-faint)">within</span>
  );
}

function Identity({ row }: { row: BoardRow }) {
  switch (row.identity) {
    case 'MATCHES':
      return <span className="text-(--color-paper-faint)">as recorded</span>;
    case 'DRIFT':
      return (
        <span style={{ color: 'var(--color-state-dark)' }} title="the feed no longer describes itself as it did at capture; its price is withheld">
          changed
        </span>
      );
    case 'UNREAD':
      return (
        <span className="absent" title="description() did not answer this run; the price is shown against the identity recorded at capture">
          {ABSENT_GLYPH}
        </span>
      );
    default:
      return (
        <span className="absent" title="the snapshot does not record the identity check">
          {ABSENT_GLYPH}
        </span>
      );
  }
}

/**
 * The three market cells: what the token trades at here, how far that is from
 * the feed, and what it takes to move it.
 *
 * Each is an absence when the Specialist could not read it, and the em dash
 * carries the reason. A market that was not read must never be drawn as a
 * market that agrees with the exchange.
 */
function Market({ row }: { row: BoardRow }) {
  const m = row.market;
  const dash = (why: string) => (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );

  return (
    <>
      <td className="py-2 pr-4 text-right align-baseline">
        {m === null || m.priceUsd === null ? (
          dash(
            m === null
              ? 'the Specialist has not read a pool for this ticker'
              : m.priceInQuote === null
                ? 'no pool with liquidity in force was found for this ticker'
                : `the pool's mid is ${m.priceInQuote} ${m.quoteLabel ?? 'in its quote asset'}, and the Pillar has not read a dollar price for that asset`,
          )
        ) : (
          <span
            className="tabular text-sm text-(--color-paper)"
            title={`${m.venueLabel ?? 'pool'} · sampled ${describeAge(m.sampleAgeSeconds)} ago`}
          >
            {m.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-right align-baseline">
        {m === null || m.basisBps === null ? (
          dash('a difference needs both a pool price and a feed price; one of them was not read')
        ) : (
          <span
            className="tabular text-sm"
            style={{ color: Math.abs(m.basisBps) >= 100 ? 'var(--color-state-stale)' : 'var(--color-paper-dim)' }}
            title="the pool's mid against the feed's last answer, in basis points of the feed. Which way it closes is not stated."
          >
            {`${m.basisBps > 0 ? '+' : m.basisBps < 0 ? '−' : ''}${Math.abs(Math.round(m.basisBps)).toLocaleString('en-US')}`}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-dim)">
        {m === null || m.depthUsd === null ? (
          dash('no size could be computed: the pool published no liquidity in force, or its quote asset has no dollar price')
        ) : (
          <span
            className="tabular"
            title={
              m.depthIsExact
                ? 'the reserves are the whole book, so this size is exact arithmetic over all of it'
                : 'the liquidity at the current tick only. A move that leaves that tick meets liquidity this figure cannot see. Not a quote.'
            }
          >
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
              <span className="absent" title={row.notPricedBecause ?? 'not priced'}>
                {ABSENT_GLYPH}
              </span>
            ) : (
              <span className="tabular text-sm text-(--color-paper)">{row.price}</span>
            )}
          </td>
          {market ? <Market row={row} /> : null}
          <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-dim)">
            <Age seconds={row.feedAgeSeconds} why={row.notPricedBecause ?? 'no round was read'} />
          </td>
          <td className="py-2 pr-4 text-right align-baseline text-xs text-(--color-paper-faint)">
            <Age seconds={row.sampleAgeSeconds} why="" />
          </td>
          <td className="py-2 pr-4 align-baseline text-xs">
            <Heartbeat row={row} />
          </td>
          <td className="py-2 pr-4 align-baseline text-xs">
            <Flag row={row} />
          </td>
          <td className="py-2 align-baseline text-xs">
            <Identity row={row} />
          </td>
        </tr>
      ))}
    </>
  );
}

function Head({ market = false }: { market?: boolean }) {
  return (
    <thead>
      <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-(--color-paper-faint)">
        <th className="pb-2 pr-4 font-normal">Feed</th>
        <th className="pb-2 pr-4 text-right font-normal" title="what the oracle last published for the underlying">
          Feed · USD
        </th>
        {market ? (
          <>
            <th className="pb-2 pr-4 text-right font-normal" title="the deepest pool on this chain with liquidity in force, in dollars">
              On chain · USD
            </th>
            <th className="pb-2 pr-4 text-right font-normal" title="the pool against the feed, in basis points of the feed">
              Basis · bp
            </th>
            <th className="pb-2 pr-4 text-right font-normal" title="the size that moves that mid one percent. A bound over published state, never a quote. * marks a figure computed from the current tick only.">
              Moves 1% · USD
            </th>
          </>
        ) : null}
        <th className="pb-2 pr-4 text-right font-normal" title="how long since the oracle last published">
          Feed updated
        </th>
        <th className="pb-2 pr-4 text-right font-normal" title="how long since the Pillar read it">
          Sampled
        </th>
        <th className="pb-2 pr-4 font-normal">Heartbeat</th>
        <th className="pb-2 pr-4 font-normal">Issuer pause</th>
        <th className="pb-2 font-normal">Identity</th>
      </tr>
    </thead>
  );
}

export function FloorBoard({ board, unreadable }: { board: Board | null; unreadable: string | null }) {
  if (board === null) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
        The snapshot store could not be read{unreadable ? ` (${unreadable})` : ''}. No board is
        drawn, and none should be inferred — an unreadable record is not an empty floor.
      </p>
    );
  }
  const state = SAMPLE_STATE[board.sampleState];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: state.colour }} title={state.means}>
          ● {state.label}
          {board.sampleAgeSeconds === null ? '' : ` · sampled ${describeAge(board.sampleAgeSeconds)} ago`}
        </span>
        <span className="tabular text-[11px] text-(--color-paper-faint)">
          {board.counts.priced} of {board.counts.equity} equity feeds priced · {board.counts.pastHeartbeat} past heartbeat ·{' '}
          {board.counts.paused} paused · {board.counts.drift} identity changed
          {board.counts.withBasis > 0 ? (
            <>
              {' · '}
              <span title="tickers carrying a price on both sides: an oracle answer and a pool with liquidity in force">
                {board.counts.withBasis} priced both sides
              </span>
              {board.widestBasisBps === null ? null : (
                <>
                  {' · widest '}
                  <span title="the largest difference on this board, with its sign. Which way it closes is not stated.">
                    {`${board.widestBasisBps > 0 ? '+' : board.widestBasisBps < 0 ? '−' : ''}${Math.abs(Math.round(board.widestBasisBps)).toLocaleString('en-US')} bp`}
                  </span>
                </>
              )}
            </>
          ) : null}
        </span>
      </div>

      {board.sampleState === 'ABSENT' || board.sampleState === 'STALE' ? (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: state.colour }}>
          {state.means}. The feed ages below are computed against the clock now; the prices are
          what the feeds said when they were last read, not what they say now.
        </p>
      ) : null}

      {board.rows.length === 0 ? (
        <p className="mt-6 text-sm text-(--color-paper-faint)">
          No feed has been sampled into this store yet. That is an absence of samples, not an
          absence of feeds.
        </p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse">
              <Head market />
              <tbody>
                <Rows rows={board.equity} market />
              </tbody>
            </table>
          </div>

          {board.crypto.length > 0 ? (
            <details className="mt-6 border-t border-(--color-rule) pt-4">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.18em] text-(--color-paper-faint)">
                Crypto feeds · {board.crypto.length} sampled in rotation
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse">
                  <Head />
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
        Two ages per row, kept apart: how long since the oracle published, and how long since
        this system read it. A feed within its heartbeat is a feed that updated recently — not a
        statement that its value is correct. The issuer registry lists{' '}
        {STOCK_TOKEN_COVERAGE.tokensInRegistry} stock tokens; {STOCK_TOKEN_COVERAGE.withoutFeed} of
        them have no feed this system can read and are not on this board — see{' '}
        <Link href="/registry" className="text-(--color-paper-dim) hover:text-(--color-paper)">
          the Registry
        </Link>
        .
      </p>
    </div>
  );
}
