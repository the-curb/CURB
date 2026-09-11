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
    <main className="px-3 sm:px-4" aria-busy="true" aria-live="polite">
      <div className="cells grid-cols-1">
        <div className="cell sweep flex items-center px-6 py-5 sm:px-8">
          <span className="tabular text-[11px] uppercase tracking-[0.2em] text-[--color-paper-faint]">Reading the record</span>
        </div>
        <div className="cell" style={{ height: 'min(52vh, 480px)' }} />
        <div className="cells !border-0 grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="cell" style={{ height: '14rem' }} />
          <div className="cell" style={{ height: '14rem' }} />
        </div>
      </div>
    </main>
  );
}
