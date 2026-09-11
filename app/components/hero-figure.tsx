'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollProgress } from './use-scroll-progress';

/**
 * The two clocks, drawn — and the hero pinned while they move.
 *
 * Twenty-four rings, one per hour of a day the chain never closes. At rest
 * they nest around one centre; as the reader scrolls they fan out into a row,
 * one dot per hour, and the rings that belong to the exchange's regular
 * session — six and a half hours out of twenty-four — are drawn solid while
 * the rest are dashed. The chain runs the whole row. The exchange runs the
 * solid part. Those are not the same clock.
 *
 * The section is taller than the screen; the figure and the headline row
 * beneath it stick together while the scroll plays the fan out, then the
 * page moves on.
 */
const HOURS = 24;
/** 09:30 to 16:00 ET, as hour offsets from midnight: 9.5 .. 16. */
const SESSION = { from: 9.5, to: 16 };

export function HeroSection({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(ref);
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

  const width = 1200;
  const height = 460;
  const cx = width / 2;
  const cy = height / 2;
  const spread = 520 * ease;
  const ry = 140 - 36 * ease;

  return (
    <section ref={ref} className="relative md:h-[175vh]">
      <div className="md:sticky md:top-[6.5rem]">
        <div className="cells grid-cols-1">
          <div className="cell grid-dots relative flex items-center justify-center overflow-hidden" style={{ height: 'min(52vh, 480px)' }}>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-[--color-paper]" aria-label="Twenty-four rings, one per hour of the chain's day, fanning into a row; the exchange's session hours are drawn solid">
              {Array.from({ length: HOURS }, (_, i) => {
                const t = i / (HOURS - 1);
                const x = cx + (t - 0.5) * 2 * spread;
                const rx = 10 + (1 - ease) * (20 + i * 9);
                const inSession = i + 0.5 > SESSION.from && i < SESSION.to;
                return (
                  <g key={i}>
                    <ellipse
                      cx={x}
                      cy={cy}
                      rx={Math.max(rx, 2)}
                      ry={ry}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1}
                      strokeDasharray={inSession ? undefined : '3 6'}
                      opacity={inSession ? 0.9 : 0.55}
                    />
                    <circle cx={x} cy={cy} r={3 + 6 * ease} fill="currentColor" opacity={0.2 + 0.8 * ease} />
                  </g>
                );
              })}
              <circle cx={cx} cy={cy} r={14 * (1 - ease)} fill="currentColor" />
            </svg>
            <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] uppercase tracking-[0.2em] text-[--color-paper-faint]">
              24 hours of chain · 6½ hours of exchange · drawn solid
            </div>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
