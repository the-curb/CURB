import type { Board } from '@/lib/floor/board';
import { describeAge } from '@/lib/doctrine/reading';

/**
 * The tape. Every tokenized-equity feed on the board, one after another,
 * each with its last price and how old that price is — because a price on
 * a tape without its age is the thing this desk exists to correct. The
 * strip names its source and the sample's age once, at the head; the run
 * moves, and rests under a hand.
 *
 * A feed that could not be priced is on the tape as an absence with its
 * reason, not left off it. Nothing here is a quote.
 */
export function Tape({ board }: { board: Board | null }) {
  const sampled = board !== null && board.sampleState !== 'NONE' && board.sampleAgeSeconds !== null ? describeAge(board.sampleAgeSeconds) : null;
  const head =
    board === null ? 'The record could not be read' : sampled === null ? 'No feed sampled yet' : `Chainlink feeds · sampled ${sampled} ago`;

  const items = board?.equity ?? [];

  return (
    <div className="tabular flex border-b border-(--color-rule) bg-(--color-ink) text-[11px]" aria-label="Feed tape">
      <div
        className="flex shrink-0 items-center gap-2 border-r border-(--color-rule) px-4 py-2 uppercase tracking-[0.18em] text-(--color-paper-faint)"
        title={head}
      >
        <span className="text-(--color-accent)" aria-hidden="true">
          ●
        </span>
        <span className="hidden sm:inline">{head}</span>
        <span className="sm:hidden">{sampled === null ? head : `Chainlink · ${sampled}`}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-2 text-(--color-paper-faint)">— no readings on the tape —</div>
      ) : (
        <div className="tape flex-1">
          <div className="tape-run">
            {[0, 1].map((copy) => (
              <span key={copy} className="inline-flex" aria-hidden={copy === 1}>
                {items.map((row) => (
                  <span key={row.key} className="inline-flex items-baseline gap-2 border-r border-(--color-rule) px-4 py-2">
                    <span className="text-(--color-paper)">{row.label}</span>
                    {row.price === null ? (
                      <span className="absent" title={row.notPricedBecause ?? 'not priced'}>
                        —
                      </span>
                    ) : (
                      <span className="text-(--color-paper-dim)">{row.price}</span>
                    )}
                    <span className="text-(--color-paper-faint)">
                      {row.feedAgeSeconds === null ? 'age unread' : `${describeAge(row.feedAgeSeconds)} old`}
                    </span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
