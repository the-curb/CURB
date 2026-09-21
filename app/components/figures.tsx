/**
 * Line drawings, all procedural, all one stroke colour. Nothing here is an
 * asset; every path is computed from a few numbers, so the drawings inherit
 * the theme and scale to any cell. The front page keeps one: the clocks. The
 * waves, the city, the dots, the cards and the position figure went with the
 * scroll-driven home they were drawn for (removed 21 September 2026).
 */

/** The chain’s day and the exchange’s session: twenty-four rings, the session hours drawn solid. */
const HOURS = 24;
const SESSION = { from: 9.5, to: 16 };

export function ClocksFigure({ ease }: { ease: number }) {
  const width = 1200;
  const height = 460;
  const cx = width / 2;
  const cy = height / 2;
  const spread = 520 * ease;
  const ry = 140 - 36 * ease;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-(--color-paper)" aria-label="Twenty-four rings, one per hour of the chain's day, fanning into a row; the exchange's session hours are drawn solid">
      {Array.from({ length: HOURS }, (_, i) => {
        const t = i / (HOURS - 1);
        const x = cx + (t - 0.5) * 2 * spread;
        const rx = 10 + (1 - ease) * (20 + i * 9);
        const inSession = i + 0.5 > SESSION.from && i < SESSION.to;
        return (
          <g key={i}>
            <ellipse cx={x} cy={cy} rx={Math.max(rx, 2)} ry={ry} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray={inSession ? undefined : '3 6'} opacity={inSession ? 0.9 : 0.55} />
            <circle cx={x} cy={cy} r={3 + 6 * ease} fill={inSession ? 'var(--color-accent)' : 'currentColor'} opacity={0.2 + 0.8 * ease} />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={14 * (1 - ease)} fill="var(--color-accent)" />
    </svg>
  );
}
