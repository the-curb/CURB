/**
 * Line drawings, all procedural, all one stroke colour. Nothing here is an
 * asset; every path is computed from a few numbers, so the drawings inherit
 * the theme and scale to any cell.
 */

/** Feed ages as a field: many quiet lines, and three that drifted. */
export function WavesFigure() {
  const width = 800;
  const height = 520;
  const lines = 22;
  const paths = Array.from({ length: lines }, (_, i) => {
    const y0 = 60 + (i / (lines - 1)) * 400;
    const amp = 14 + 26 * Math.sin((i / lines) * Math.PI);
    let d = `M0,${y0}`;
    for (let x = 0; x <= width; x += 20) {
      const y = y0 + Math.sin((x / width) * Math.PI * 2 + i * 0.35) * amp + Math.sin((x / width) * Math.PI * 6 + i) * 4;
      d += ` L${x},${y.toFixed(1)}`;
    }
    return d;
  });
  const dots: [number, number, number][] = [
    [190, 176, 20],
    [56, 250, 19],
    [286, 358, 18],
  ];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-[--color-paper]" aria-label="A field of quiet lines, and three points that drifted off them">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={0.8} opacity={0.55} />
      ))}
      {dots.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="currentColor" />
      ))}
    </svg>
  );
}

const ISO = { dx: 0.866, dy: 0.5 };
function iso(x: number, y: number, z = 0, s = 44): [number, number] {
  return [(x - y) * ISO.dx * s, (x + y) * ISO.dy * s - z];
}

function box(x: number, y: number, w: number, d: number, h: number, s: number) {
  const [ax, ay] = iso(x, y, h, s);
  const [bx, by] = iso(x + w, y, h, s);
  const [cx, cy] = iso(x + w, y + d, h, s);
  const [dx, dy] = iso(x, y + d, h, s);
  return {
    top: `M${ax},${ay} L${bx},${by} L${cx},${cy} L${dx},${dy} Z`,
    left: `M${dx},${dy} L${cx},${cy} L${cx},${cy + h} L${dx},${dy + h} Z`,
    right: `M${cx},${cy} L${bx},${by} L${bx},${by + h} L${cx},${cy + h} Z`,
    centre: iso(x + w / 2, y + d / 2, h, s),
  };
}

const BLOCKS = [
  { x: 0, y: 0, w: 3, d: 2, h: 22, label: 'THE FLOOR' },
  { x: 3.4, y: 0, w: 2.2, d: 2, h: 44, label: 'THE REGISTRY' },
  { x: 0, y: 2.4, w: 1.6, d: 1.6, h: 34, label: 'THE VAULT' },
  { x: 2, y: 2.4, w: 1.6, d: 1.6, h: 60, label: 'CHAMBERS' },
  { x: 4, y: 2.4, w: 1.6, d: 1.6, h: 16, label: 'THE PRESS' },
  { x: 0, y: 4.4, w: 5.6, d: 0.6, h: 10, label: 'THE CAGE' },
];

/** The city as a board: six blocks on a traced isometric floor. */
export function CityFigure() {
  const s = 44;
  return (
    <svg viewBox="-300 -80 600 460" className="h-full w-full text-[--color-paper]" aria-label="Six district blocks on an isometric board, traced with lines and terminals">
      <g stroke="currentColor" strokeWidth={0.6} fill="none" opacity={0.3}>
        {Array.from({ length: 13 }, (_, i) => {
          const [x1, y1] = iso(i * 0.5, -0.5, 0, s);
          const [x2, y2] = iso(i * 0.5, 5.5, 0, s);
          const [x3, y3] = iso(-0.5, i * 0.5, 0, s);
          const [x4, y4] = iso(6, i * 0.5, 0, s);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              <line x1={x3} y1={y3} x2={x4} y2={y4} />
            </g>
          );
        })}
      </g>
      {/* traces from the edge into the floor */}
      <g stroke="currentColor" strokeWidth={0.8} fill="none" opacity={0.7}>
        {Array.from({ length: 7 }, (_, i) => {
          const [x1, y1] = iso(-0.5, 0.3 + i * 0.28, 0, s);
          const [x2, y2] = iso(0, 0.3 + i * 0.28, 0, s);
          return (
            <g key={i}>
              <line x1={x1 - 40} y1={y1 + 23} x2={x1} y2={y1} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              <circle cx={x1 - 40} cy={y1 + 23} r={2.5} fill="currentColor" />
            </g>
          );
        })}
      </g>
      {BLOCKS.map((b) => {
        const g = box(b.x, b.y, b.w, b.d, b.h, s);
        return (
          <g key={b.label}>
            <path d={g.left} fill="var(--color-ink)" stroke="currentColor" strokeWidth={1} />
            <path d={g.right} fill="var(--color-ink-3)" stroke="currentColor" strokeWidth={1} />
            <path d={g.top} fill="var(--color-ink)" stroke="currentColor" strokeWidth={1} />
            <text x={g.centre[0]} y={g.centre[1] + 3} textAnchor="middle" fontSize={7.5} letterSpacing={1.4} fill="currentColor" style={{ fontFamily: 'var(--font-mono)' }}>
              {b.label}
            </text>
          </g>
        );
      })}
      {/* the feeds: pins on the floor's top */}
      {Array.from({ length: 35 }, (_, i) => {
        const col = i % 7;
        const row = Math.floor(i / 7);
        const [x, y] = iso(0.25 + col * 0.42, 0.25 + row * 0.38, 22, s);
        return <circle key={i} cx={x} cy={y} r={1.6} fill="currentColor" opacity={0.9} />;
      })}
    </svg>
  );
}

/**
 * The roll as a ring: one dot per stock token in the issuer's registry,
 * arranged in a spiral, the ones with a price feed drawn full and the rest
 * faint. The proportion is the picture.
 */
export function DotsFigure({ total, withFeed }: { total: number; withFeed: number }) {
  const width = 600;
  const height = 520;
  const cx = width / 2;
  const cy = height / 2;
  const dots = Array.from({ length: total }, (_, i) => {
    const t = i / total;
    const angle = t * Math.PI * 2 * 3.2;
    const r = 60 + t * 170;
    const jitter = Math.sin(i * 12.9898) * 6;
    return { x: cx + Math.cos(angle) * (r + jitter), y: cy + Math.sin(angle) * (r + jitter) * 0.82, lit: i % Math.round(total / withFeed) === 0 };
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-[--color-paper]" aria-label={`${total} dots in a spiral, ${withFeed} of them drawn full`}>
      {dots.map((d, i) => (
        <rect key={i} x={d.x - 2} y={d.y - 2} width={4} height={4} fill="currentColor" opacity={d.lit ? 0.95 : 0.28} />
      ))}
    </svg>
  );
}

/** Folded cards: the registries, as a row of plans on a shelf. */
export function CardsFigure() {
  const cards = [
    { title: 'Feed directory', lines: ['57 feeds listed', '35 tokenized equity', 'verified on chain'] },
    { title: 'Asset registry', lines: ['194 stock tokens', 'one shared beacon', 'verified on chain'] },
    { title: 'Terms register', lines: ['5 issuer pages', 'hashed daily', 'never read for meaning'] },
  ];
  return (
    <svg viewBox="0 0 900 260" className="h-full w-full text-[--color-paper]" aria-label="Three folded cards on a shelf: the feed directory, the asset registry, the terms register">
      <line x1="0" y1="236" x2="900" y2="236" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {cards.map((c, i) => {
        const x = 40 + i * 290;
        return (
          <g key={c.title} transform={`translate(${x},40) skewY(-12)`}>
            <path d="M0,20 L40,20 L48,6 L120,6 L128,20 L240,20 L240,180 L0,180 Z" fill="var(--color-ink)" stroke="currentColor" strokeWidth="1" />
            <text x="18" y="52" fontSize="15" fill="currentColor" style={{ fontFamily: 'var(--font-sans)' }}>{c.title}</text>
            {c.lines.map((l, j) => (
              <text key={l} x="18" y={84 + j * 24} fontSize="12" fill="currentColor" opacity="0.75" style={{ fontFamily: 'var(--font-mono)' }}>
                {l}
              </text>
            ))}
            <rect x="18" y="150" width="60" height="6" fill="currentColor" opacity="0.5" />
          </g>
        );
      })}
    </svg>
  );
}
