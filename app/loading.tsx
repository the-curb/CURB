/**
 * What a page looks like before its record has been read.
 *
 * Every page here is rendered on demand from the store, so a navigation has
 * a real wait in it. This is shown the instant a link is followed — it is
 * prefetched with the link — and the page streams in over it. It says what
 * is happening and nothing more: no figure appears here that was not read.
 */
export default function Loading() {
  return (
    <main className="px-3 pt-8 sm:px-4" aria-busy="true" aria-live="polite">
      <div className="cells grid-cols-1">
        <div className="cell sweep flex items-baseline gap-4 px-6 py-5 sm:px-8">
          <span className="kicker">
            <b>№ —</b>
          </span>
          <span className="display text-xl text-(--color-paper-faint)">Reading the record.</span>
        </div>
        <div className="cell" style={{ height: 'clamp(200px, 32vw + 80px, 480px)' }} />
        <div className="cells !border-0 grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="cell" style={{ height: '14rem' }} />
          <div className="cell" style={{ height: '14rem' }} />
        </div>
      </div>
    </main>
  );
}
