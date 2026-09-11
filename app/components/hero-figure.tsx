'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollProgress } from './use-scroll-progress';
import { ClocksFigure, PositionFigure } from './figures';

/**
 * A section pinned while its figure moves with the scroll.
 *
 * The section is taller than the screen; the figure and the row beneath it
 * stick together while the scroll plays the figure from its resting pose to
 * its finished one, then the page moves on. Which figure is named, not
 * passed, because a server page cannot hand a client component a function.
 */
export function HeroSection({ figure, caption, children }: { figure: 'position' | 'clocks'; caption: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(ref);
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

  return (
    <section ref={ref} className="relative md:h-[175vh]">
      <div className="md:sticky md:top-[var(--masthead-h)]">
        <div className="cells grid-cols-1">
          <div className="cell ledger relative flex items-center justify-center overflow-hidden" style={{ height: 'clamp(200px, 32vw + 80px, 480px)' }}>
            {figure === 'position' ? <PositionFigure p={ease} /> : <ClocksFigure ease={ease} />}
            <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] uppercase tracking-[0.2em] text-(--color-paper-faint)">{caption}</div>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
