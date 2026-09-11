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
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-(--color-paper)" aria-label="A field of quiet lines, and three points that drifted off them">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={0.8} opacity={0.55} />
      ))}
      {dots.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="var(--color-accent)" />
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
    <svg viewBox="-300 -80 600 460" className="h-full w-full text-(--color-paper)" aria-label="Six district blocks on an isometric board, traced with lines and terminals">
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
              <circle cx={x1 - 40} cy={y1 + 23} r={2.5} fill="var(--color-accent)" />
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
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-(--color-paper)" aria-label={`${total} dots in a spiral, ${withFeed} of them drawn full`}>
      {dots.map((d, i) => (
        <rect key={i} x={d.x - 2} y={d.y - 2} width={4} height={4} fill={d.lit ? 'var(--color-accent)' : 'currentColor'} opacity={d.lit ? 0.95 : 0.3} />
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
    <svg viewBox="0 0 900 260" className="h-full w-full text-(--color-paper)" aria-label="Three folded cards on a shelf: the feed directory, the asset registry, the terms register">
      <line x1="0" y1="236" x2="900" y2="236" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {cards.map((c, i) => {
        const x = 40 + i * 290;
        return (
          <g key={c.title} transform={`translate(${x},40) skewY(-12)`}>
            <path d="M0,20 L40,20 L48,6 L120,6 L128,20 L240,20 L240,180 L0,180 Z" fill="var(--color-ink)" stroke="currentColor" strokeWidth="1" />
            <text x="18" y="54" fontSize="20" fill="currentColor" style={{ fontFamily: 'var(--font-sans)' }}>{c.title}</text>
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

/**
 * Twenty-four rings, one per hour of a day the chain never closes. At ease 0
 * they nest around one centre; at ease 1 they stand in a row, one dot per
 * hour, and the rings that belong to the exchange's regular session — six
 * and a half hours out of twenty-four — are drawn solid while the rest are
 * dashed. The chain runs the whole row. The exchange runs the solid part.
 */
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

/**
 * Two issuers, one position. Units of component A (circles) and component B
 * (squares) lie in two separate groups; as `p` runs from 0 to 1 they take
 * their places in lots — ten A and twenty B to a lot, the blueprint's
 * illustrative units — and each lot shows its two separate exits. The
 * composition is the picture: nothing is blended, every unit stays itself.
 */
const LOT = { x: 430, w: 340, ys: [46, 186, 326], h: 96, perRow: 10, pitch: 30, qA: 10, qB: 20 };
const ISLAND = { A: { cx: 175, cy: 230 }, B: { cx: 1025, cy: 230 } };

function spiral(j: number, cx: number, cy: number, spacing: number): [number, number] {
  const r = spacing * Math.sqrt(j + 0.5);
  const a = j * 2.399963;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function PositionFigure({ p }: { p: number }) {
  const lots = LOT.ys.length;
  const unitsA = Array.from({ length: lots * LOT.qA }, (_, j) => {
    const lot = Math.floor(j / LOT.qA);
    const col = j % LOT.qA;
    const [sx, sy] = spiral(j, ISLAND.A.cx, ISLAND.A.cy, 17);
    const tx = LOT.x + 25 + col * LOT.pitch;
    const ty = LOT.ys[lot]! + 24;
    const t = Math.min(1, Math.max(0, (p - j * 0.006) / 0.7));
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return { x: lerp(sx, tx, e), y: lerp(sy, ty, e) };
  });
  const unitsB = Array.from({ length: lots * LOT.qB }, (_, j) => {
    const lot = Math.floor(j / LOT.qB);
    const within = j % LOT.qB;
    const row = Math.floor(within / LOT.perRow);
    const col = within % LOT.perRow;
    const [sx, sy] = spiral(j, ISLAND.B.cx, ISLAND.B.cy, 16);
    const tx = LOT.x + 25 + col * LOT.pitch;
    const ty = LOT.ys[lot]! + 50 + row * 24;
    const t = Math.min(1, Math.max(0, (p - j * 0.003) / 0.7));
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return { x: lerp(sx, tx, e), y: lerp(sy, ty, e) };
  });
  const frame = Math.min(1, Math.max(0, (p - 0.35) / 0.4));
  const exits = Math.min(1, Math.max(0, (p - 0.75) / 0.25));
  const mono = { fontFamily: 'var(--font-mono)' } as const;

  return (
    <svg viewBox="0 0 1200 460" className="h-full w-full text-(--color-paper)" aria-label="Units from two issuers taking their places in lots of a fixed composition, each lot with a separate exit per component">
      <text x={ISLAND.A.cx} y={412} textAnchor="middle" fontSize={11} letterSpacing={2.4} fill="currentColor" opacity={0.7} style={mono}>
        ISSUER A · COMPONENT A
      </text>
      <text x={ISLAND.B.cx} y={412} textAnchor="middle" fontSize={11} letterSpacing={2.4} fill="currentColor" opacity={0.7} style={mono}>
        ISSUER B · COMPONENT B
      </text>
      <text x={600} y={24} textAnchor="middle" fontSize={11} letterSpacing={2.4} fill="currentColor" opacity={0.75 * frame} style={mono}>
        ONE POSITION · {lots} LOTS · {LOT.qA} A + {LOT.qB} B EACH
      </text>
      {LOT.ys.map((y, i) => (
        <g key={i} opacity={frame}>
          <rect x={LOT.x} y={y} width={LOT.w} height={LOT.h} fill="none" stroke="currentColor" strokeWidth={1} />
          <text x={LOT.x - 12} y={y + LOT.h / 2 + 4} textAnchor="end" fontSize={11} fill="var(--color-accent)" style={mono}>
            LOT {String(i + 1).padStart(2, '0')}
          </text>
          <g opacity={exits}>
            <line x1={LOT.x + LOT.w} y1={y + 24} x2={LOT.x + LOT.w + 46} y2={y + 24} stroke="currentColor" strokeWidth={1} />
            <text x={LOT.x + LOT.w + 54} y={y + 28} fontSize={10} letterSpacing={1.6} fill="currentColor" opacity={0.8} style={mono}>
              CLAIM A
            </text>
            <line x1={LOT.x + LOT.w} y1={y + 62} x2={LOT.x + LOT.w + 46} y2={y + 62} stroke="var(--color-accent)" strokeWidth={1} />
            <text x={LOT.x + LOT.w + 54} y={y + 66} fontSize={10} letterSpacing={1.6} fill="var(--color-accent)" style={mono}>
              CLAIM B
            </text>
          </g>
        </g>
      ))}
      {unitsA.map((u, j) => (
        <circle key={`a-${j}`} cx={u.x} cy={u.y} r={5.5} fill="currentColor" opacity={0.95} />
      ))}
      {unitsB.map((u, j) => (
        <rect key={`b-${j}`} x={u.x - 5} y={u.y - 5} width={10} height={10} fill="var(--color-accent)" opacity={0.9} />
      ))}
    </svg>
  );
}
