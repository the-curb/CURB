'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * How far the reader has scrolled through a tall, sticky section, as 0..1.
 *
 * The section is taller than the viewport and its figure sticks to the top,
 * so progress is the distance scrolled inside the section over the distance
 * there is to scroll. Read on animation frames only, and never at all when
 * the reader has asked for reduced motion or the screen is too small for a
 * pinned section — the figures then sit at their resting pose.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, restingAt = 0): number {
  const [progress, setProgress] = useState(restingAt);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    if (reduced || narrow) {
      setProgress(restingAt);
      return;
    }

    const measure = () => {
      frame.current = null;
      const rect = element.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      const scrolled = Math.min(Math.max(-rect.top, 0), travel);
      setProgress(scrolled / travel);
    };
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [ref, restingAt]);

  return progress;
}
