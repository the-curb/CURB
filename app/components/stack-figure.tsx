'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollProgress } from './use-scroll-progress';

/**
 * Six slabs on an isometric floor, one per district, rising with the scroll.
 *
 * The floor is a ruled isometric grid, like a board. Each slab lifts into
 * place in turn as the reader moves down the list beside it; at rest they
 * lie flat on the board. A lifted slab shows its ordinal in the second ink.
 */
const ISO = { dx: 0.866, dy: 0.5 };

function iso(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * ISO.dx * 60, (x + y) * ISO.dy * 60 - z];
}

function slabPath(x: number, y: number, w: number, d: number, lift: number, thickness: number): { top: string; left: string; right: string } {
  const [ax, ay] = iso(x, y, lift);
  const [bx, by] = iso(x + w, y, lift);
  const [cxp, cyp] = iso(x + w, y + d, lift);
  const [dxp, dyp] = iso(x, y + d, lift);
  const t = thickness;
  return {
    top: `M${ax},${ay} L${bx},${by} L${cxp},${cyp} L${dxp},${dyp} Z`,
    left: `M${dxp},${dyp} L${cxp},${cyp} L${cxp},${cyp + t} L${dxp},${dyp + t} Z`,
    right: `M${cxp},${cyp} L${bx},${by} L${bx},${by + t} L${cxp},${cyp + t} Z`,
  };
}

const SLABS = [
  { x: 0, y: 0, w: 2.2, d: 1.4, label: 'THE FLOOR' },
  { x: 2.6, y: 0, w: 1.8, d: 1.4, label: 'THE REGISTRY' },
  { x: 0, y: 1.8, w: 1.4, d: 1.2, label: 'THE VAULT' },
  { x: 1.8, y: 1.8, w: 1.4, d: 1.2, label: 'CHAMBERS' },
  { x: 3.6, y: 1.8, w: 0.8, d: 1.2, label: 'THE PRESS' },
  { x: 0, y: 3.4, w: 4.4, d: 0.5, label: 'THE CAGE' },
];

export function StackSection({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(ref);

  return (
    <section ref={ref} className="relative">
      <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="cell">
          <div className="lg:sticky lg:top-[var(--masthead-h)]">{aside}</div>
          {children}
        </div>
        <div className="cell relative hidden lg:block">
          <div className="sticky top-[var(--masthead-h)]" style={{ height: 'calc(100vh - var(--masthead-h) - 1rem)' }}>
            <svg viewBox="-270 -90 540 420" className="h-full w-full text-(--color-paper)" aria-label="Six slabs on an isometric board, one per district, rising as the list beside them is read">
              <g stroke="currentColor" strokeWidth={0.75} opacity={0.35} fill="none">
                {Array.from({ length: 11 }, (_, i) => {
                  const [x1, y1] = iso(i * 0.5, 0);
                  const [x2, y2] = iso(i * 0.5, 5);
                  const [x3, y3] = iso(0, i * 0.5);
                  const [x4, y4] = iso(5, i * 0.5);
                  return (
                    <g key={i}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} />
                      <line x1={x3} y1={y3} x2={x4} y2={y4} />
                    </g>
                  );
                })}
              </g>
              {SLABS.map((s, i) => {
                const local = Math.min(1, Math.max(0, (p - i * 0.12) / 0.3));
                const lifted = local > 0.95;
                const lift = local * (34 + (5 - i) * 6);
                const thickness = 6 + local * 10;
                const path = slabPath(s.x, s.y, s.w, s.d, lift, thickness);
                const [lx, ly] = iso(s.x + s.w / 2, s.y + s.d / 2, lift);
                const [nx, ny] = iso(s.x + 0.22, s.y + 0.22, lift);
                return (
                  <g key={s.label}>
                    <path d={path.left} fill="var(--color-ink)" stroke="currentColor" strokeWidth={1} opacity={0.9} />
                    <path d={path.right} fill="var(--color-ink-3)" stroke="currentColor" strokeWidth={1} opacity={0.9} />
                    <path d={path.top} fill={lifted ? 'var(--color-invert)' : 'var(--color-ink)'} stroke="currentColor" strokeWidth={1} />
                    <text
                      x={lx}
                      y={ly + 3}
                      textAnchor="middle"
                      fontSize={8.5}
                      letterSpacing={1.5}
                      fill={lifted ? 'var(--color-invert-ink)' : 'currentColor'}
                      opacity={0.3 + 0.7 * local}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {s.label}
                    </text>
                    <text x={nx} y={ny + 3} fontSize={9} fill="var(--color-accent)" opacity={local} style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>
                      {String(i + 1).padStart(2, '0')}
                    </text>
                  </g>
                );
              })}
              {/* terminals: the feeds, as pins along the floor's edge */}
              {Array.from({ length: 12 }, (_, i) => {
                const [x, y] = iso(0.15 + i * 0.16, -0.35);
                return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--color-accent)" opacity={0.4 + 0.6 * Math.min(1, p * 2)} />;
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
