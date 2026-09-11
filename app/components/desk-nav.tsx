import Link from 'next/link';

/**
 * The desk's own running head: where you are among its rooms, and the way to
 * the others. The masthead names the desk once; this names its parts.
 */
const ROOMS: ReadonlyArray<readonly [string, string]> = [
  ['THE FLOOR', '/floor'],
  ['THE REGISTRY', '/registry'],
  ['THE VAULT', '/vault'],
  ['CHAMBERS', '/chambers'],
  ['THE AGENTS', '/agents'],
];

export function DeskNav({ current }: { current: string }) {
  return (
    <nav className="kicker flex flex-wrap items-baseline gap-x-4 gap-y-1" aria-label="The desk">
      <span>
        <b>The desk</b>
      </span>
      {ROOMS.map(([label, href]) =>
        label === current ? (
          <span key={href} style={{ color: 'var(--color-paper)' }} aria-current="page">
            {label}
          </span>
        ) : (
          <Link key={href} href={href} className="hover:text-(--color-paper)">
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}
