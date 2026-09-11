/**
 * The mark: a kerb. Three courses of stone stepping down to the street — the
 * edge where the curb market traded, drawn as a line. Monochrome, one stroke,
 * legible at 24px in a header cell and at 240px on a footer.
 */
export function Mark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
    >
      <path d="M4 10 H16 V18 H26 V26 H36" />
      <path d="M4 16 H12" />
      <path d="M4 22 H12" />
      <path d="M30 32 H36" />
      <path d="M22 32 H26" />
    </svg>
  );
}
