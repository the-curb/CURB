import Link from 'next/link';
import { AGENT_BY_ID } from '@/lib/agents/registry';
import { STOCK_TOKENS_SOURCE, STOCK_TOKEN_BEACON } from '@/lib/chain/stock-tokens';
import { FEED_COVERAGE, STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { ABSENT_GLYPH, describeAge } from '@/lib/doctrine/reading';
import { composeRoll, type Roll } from '@/lib/registry/roll';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Registry' };

/**
 * THE REGISTRY — every stock token the issuer lists, and what the chain last
 * said about each. Two things a reader will not find elsewhere on one page:
 * that every token here runs the code one beacon names, and which tokens have
 * no reference price this system can read.
 */

const STATE: Record<Roll['sampleState'], { colour: string; label: string; means: string }> = {
  VERIFIED: { colour: 'var(--color-state-live)', label: 'current', means: 'the Archivist read the roll within its interval' },
  STALE: { colour: 'var(--color-state-stale)', label: 'stale sample', means: 'the Archivist has not read the roll within its freshness threshold; these are its last readings' },
  ABSENT: { colour: 'var(--color-state-dark)', label: 'archivist absent', means: 'the Archivist was expected and has not reported; every value here is a memory' },
  NONE: { colour: 'var(--color-state-fog)', label: 'not yet read', means: 'the Archivist has never written a snapshot to this store' },
};

function Absent({ why }: { why: string }) {
  return (
    <span className="absent" title={why}>
      {ABSENT_GLYPH}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-[--color-rule] py-2.5 first:border-t-0">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[--color-paper-faint]">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

export default async function RegistryPage() {
  const now = new Date();
  const store = await getStoreAsync();
  const [snapshots, publications, driftSnapshots] = await Promise.all([store.snapshots('token:'), store.publicationsByAgent('registrar', 1), store.snapshots('capture:drift')]);
  // The capture against the world, as the Registrar last checked it. Stored JSON, checked field by field.
  const driftRow = driftSnapshots.state === 'UNREAD' ? null : (driftSnapshots.value.find((s) => s.key === 'capture:drift') ?? null);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const drift = driftRow === null ? null : {
    checkedAgeSeconds: Math.max(0, Math.round((now.getTime() - new Date(driftRow.observedAt).getTime()) / 1000)),
    tokensListed: typeof driftRow.payload.tokensListed === 'number' ? driftRow.payload.tokensListed : null,
    feedsListed: typeof driftRow.payload.feedsListed === 'number' ? driftRow.payload.feedsListed : null,
    tokensAdded: list(driftRow.payload.tokensAdded), tokensRemoved: list(driftRow.payload.tokensRemoved), tokensMoved: list(driftRow.payload.tokensMoved),
    feedsAdded: list(driftRow.payload.feedsAdded), feedsRemoved: list(driftRow.payload.feedsRemoved),
  };
  const driftClean = drift !== null && [drift.tokensAdded, drift.tokensRemoved, drift.tokensMoved, drift.feedsAdded, drift.feedsRemoved].every((l) => l.length === 0);
  const roll = snapshots.state === 'UNREAD' ? null : composeRoll(snapshots.value, now);
  const rollFault = snapshots.state === 'UNREAD' ? `${snapshots.reason}${snapshots.detail ? ` — ${snapshots.detail}` : ''}` : null;
  const lastAudit = publications.state === 'UNREAD' ? null : (publications.value[0] ?? null);
  const beaconLine = lastAudit?.body.split('\n').find((l) => l.includes('stock-token beacon')) ?? null;
  const state = roll === null ? null : STATE[roll.sampleState];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 sm:py-16">

      <header className="mb-12">
        <div className="tracking-mark text-xs text-[--color-brass]">THE REGISTRY</div>
        <h1 className="mt-4 max-w-2xl text-2xl leading-snug text-[--color-paper] sm:text-3xl">
          {STOCK_TOKEN_COVERAGE.tokensInRegistry} stock tokens. One beacon behind all of them.{' '}
          {STOCK_TOKEN_COVERAGE.withFeed} with a price this system can read.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[--color-paper-dim]">
          Every token the issuer&rsquo;s registry lists on Robinhood Chain, as {AGENT_BY_ID.archivist.name} last
          read it. The multiplier is shares per token — the on-chain record of every reinvested distribution and
          every split. A token that is not at one represents more or less than one share, and a price quoted
          per token is off by exactly that ratio if it is read as a share price.
        </p>
      </header>

      {/* ── THE BEACON ────────────────────────────────────────────────────── */}
      <section className="mb-12 border border-[--color-rule] bg-[--color-ink-2] p-6 sm:p-8">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">The beacon · one address, every token</h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[--color-paper-dim]">
          Each stock token is a proxy that delegates to whatever implementation this beacon names. A change
          here is a change to every token in one transaction. {AGENT_BY_ID.registrar.name} reads it on every run and
          compares it with what was recorded at capture.
        </p>
        <div className="mt-6 grid gap-x-12 sm:grid-cols-2">
          <div>
            <Row label="Beacon">
              <span className="tabular break-all text-xs">{STOCK_TOKEN_BEACON.address}</span>
            </Row>
            <Row label="Implementation at capture">
              <span className="tabular break-all text-xs">{STOCK_TOKEN_BEACON.observedImplementation}</span>
            </Row>
            <Row label="Implementation size">
              <span className="tabular">{STOCK_TOKEN_BEACON.observedImplementationSizeBytes} bytes</span>
            </Row>
          </div>
          <div>
            <Row label="Captured at block">
              <span className="tabular">{STOCK_TOKEN_BEACON.observedAtBlock}</span>
            </Row>
            <Row label="Captured">
              <span className="tabular text-xs">{STOCK_TOKEN_BEACON.observedAt}</span>
            </Row>
            <Row label="Last audit says">
              {beaconLine === null ? (
                <Absent why={lastAudit === null ? 'no Registrar filing has been read' : 'the last filing carries no beacon line'} />
              ) : (
                <span className="text-xs" style={{ color: /CHANGED|DIFFERS/.test(beaconLine) ? 'var(--color-state-dark)' : 'var(--color-state-live)' }}>
                  {/CHANGED|DIFFERS/.test(beaconLine) ? 'changed since capture' : 'as recorded at capture'}
                  {lastAudit ? ` · ${describeAge(Math.max(0, Math.round((now.getTime() - new Date(lastAudit.publishedAt).getTime()) / 1000)))} ago` : ''}
                </span>
              )}
            </Row>
          </div>
        </div>
      </section>

      {/* ── THE CAPTURE, AGAINST THE WORLD ───────────────────────────────── */}
      <section className="mb-12 border border-[--color-rule] bg-[--color-ink-2] p-6 sm:p-8">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">The capture, against the world</h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[--color-paper-dim]">
          What this system reads is what the issuer&rsquo;s registry and the vendor&rsquo;s directory said on the day they were
          captured. {AGENT_BY_ID.registrar.name} fetches both every day and diffs them against the capture, so a token listed
          since is named here rather than silently absent.
        </p>
        {drift === null ? (
          <p className="mt-4 text-sm text-[--color-paper-faint]">
            <Absent why={driftSnapshots.state === 'UNREAD' ? 'the snapshot store could not be read' : 'the Registrar has not yet checked the capture against the live sources'} /> not yet checked
          </p>
        ) : (
          <div className="mt-6 grid gap-x-12 sm:grid-cols-2">
            <div>
              <Row label="Checked"><span className="tabular text-xs">{describeAge(drift.checkedAgeSeconds)} ago</span></Row>
              <Row label="Tokens listed today · captured">
                <span className="tabular">{drift.tokensListed ?? ABSENT_GLYPH} · {STOCK_TOKEN_COVERAGE.tokensInRegistry}</span>
              </Row>
              <Row label="Feeds listed today · captured">
                <span className="tabular">{drift.feedsListed ?? ABSENT_GLYPH} · {FEED_COVERAGE.capturedHere}</span>
              </Row>
            </div>
            <div>
              <Row label="Verdict">
                <span className="text-xs" style={{ color: driftClean ? 'var(--color-state-live)' : 'var(--color-state-stale)' }}>
                  {driftClean ? 'the same sets, nothing to re-capture' : 're-capture owed'}
                </span>
              </Row>
              {drift.tokensAdded.length > 0 ? <Row label="Listed, not captured"><span className="text-xs">{drift.tokensAdded.join(', ')}</span></Row> : null}
              {drift.tokensRemoved.length > 0 ? <Row label="Captured, no longer listed"><span className="text-xs">{drift.tokensRemoved.join(', ')}</span></Row> : null}
              {drift.tokensMoved.length > 0 ? <Row label="Moved to another contract"><span className="text-xs" style={{ color: 'var(--color-state-dark)' }}>{drift.tokensMoved.join(', ')}</span></Row> : null}
              {drift.feedsAdded.length > 0 ? <Row label="Feeds listed, not captured"><span className="text-xs">{drift.feedsAdded.join(', ')}</span></Row> : null}
              {drift.feedsRemoved.length > 0 ? <Row label="Feeds no longer listed"><span className="text-xs">{drift.feedsRemoved.join(', ')}</span></Row> : null}
            </div>
          </div>
        )}
      </section>

      {/* ── THE ROLL ──────────────────────────────────────────────────────── */}
      <section className="mb-12 border border-[--color-rule] bg-[--color-ink-2] p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="text-[11px] uppercase tracking-[0.28em] text-[--color-paper-faint]">The roll</h2>
          {state && roll ? (
            <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: state.colour }} title={state.means}>
              ● {state.label}
              {roll.sampleAgeSeconds === null ? '' : ` · sampled ${describeAge(roll.sampleAgeSeconds)} ago`}
            </span>
          ) : null}
        </div>

        {roll === null ? (
          <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--color-state-stale)' }}>
            The snapshot store could not be read ({rollFault}). No roll is drawn, and none should be inferred.
          </p>
        ) : (
          <>
            <p className="mt-4 tabular text-[11px] text-[--color-paper-faint]">
              {roll.counts.read} of {roll.counts.total} read · {roll.counts.notAtOne} not at one · {roll.counts.pending} pending ·{' '}
              {roll.counts.withFeed} with a feed · {roll.counts.withoutFeed} without
            </p>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[--color-paper-faint]">
                    <th className="pb-2 pr-4 font-normal">Token</th>
                    <th className="pb-2 pr-4 font-normal">Name</th>
                    <th className="pb-2 pr-4 text-right font-normal" title="uiMultiplier(), shares per token">Shares / token</th>
                    <th className="pb-2 pr-4 font-normal">Pending</th>
                    <th className="pb-2 pr-4 text-right font-normal">Supply</th>
                    <th className="pb-2 pr-4 font-normal">Feed</th>
                    <th className="pb-2 text-right font-normal">Read</th>
                  </tr>
                </thead>
                <tbody>
                  {roll.rows.map((row) => (
                    <tr key={row.token.key} className="border-t border-[--color-rule]">
                      <td className="py-2 pr-4 align-baseline">
                        <span className="text-sm tracking-[0.06em] text-[--color-paper]" title={row.token.address}>{row.token.ticker}</span>
                      </td>
                      <td className="py-2 pr-4 align-baseline text-xs text-[--color-paper-dim]">
                        {row.token.name.replace(/\s*•\s*Robinhood Token$/, '')}
                      </td>
                      <td className="py-2 pr-4 text-right align-baseline">
                        {row.multiplier === null ? (
                          <Absent why={row.unreadBecause ?? 'not read'} />
                        ) : (
                          <span
                            className="tabular text-sm"
                            style={{ color: row.notAtOne ? 'var(--color-brass)' : 'var(--color-paper)' }}
                            title={row.multiplierExact ?? undefined}
                          >
                            {row.multiplier}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 align-baseline text-xs">
                        {row.pending === null ? (
                          <span className="text-[--color-paper-faint]">{row.multiplier === null ? '' : 'none'}</span>
                        ) : (
                          <span style={{ color: 'var(--color-brass)' }} title={row.pending.effectiveAt ?? 'effective time not readable'}>
                            → {row.pending.shown}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right align-baseline text-xs text-[--color-paper-dim]">
                        {row.supply === null ? <Absent why={row.unreadBecause ?? 'not read'} /> : <span className="tabular">{row.supply}</span>}
                      </td>
                      <td className="py-2 pr-4 align-baseline text-xs">
                        {row.feedName === null ? (
                          <span className="absent" title="no Chainlink feed prices this token; its price is not stated anywhere on this site">{ABSENT_GLYPH}</span>
                        ) : (
                          <Link href="/floor" className="text-[--color-paper-faint] hover:text-[--color-paper]" title={row.feedName}>
                            on the floor
                          </Link>
                        )}
                      </td>
                      <td className="py-2 text-right align-baseline text-xs text-[--color-paper-faint]">
                        {row.sampleAgeSeconds === null ? <Absent why="not yet read" /> : <span className="tabular">{describeAge(row.sampleAgeSeconds)} ago</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="mt-6 text-xs leading-relaxed text-[--color-paper-faint]">
          Registry: {STOCK_TOKENS_SOURCE.url}, read {STOCK_TOKENS_SOURCE.retrievedAt}, {STOCK_TOKENS_SOURCE.onThisChain} of{' '}
          {STOCK_TOKENS_SOURCE.listed} listed assets deployed on this chain, every one verified on chain at block{' '}
          {STOCK_TOKENS_SOURCE.verifiedAtBlock}. Feeds: {FEED_COVERAGE.directory}. Nothing here is an endorsement or a
          listing; it is what two sources said and what the chain answered.
        </p>
      </section>
    </main>
  );
}
