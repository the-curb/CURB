'use client';

import { useState } from 'react';

/**
 * "My position" and "Claim components" (blueprint §6), read-only. Paste an
 * address; the page asks the product API what the index has for it — active
 * receipts, entitled units, open exit claims per component — and, when a
 * series is deployed, shows the bytes a wallet would sign to claim. No
 * wallet is connected, no key is held, nothing is sent. Pending claims are
 * listed apart from receipts and never counted as active backing, so no
 * value is counted twice.
 */

interface PositionRow {
  readonly seriesId: string;
  readonly state: 'NOT_DEPLOYED' | 'INDEXED';
  readonly detail: string | null;
  readonly receipts: string | null;
  readonly entitledUnits: { readonly A: string; readonly B: string } | null;
  readonly asOfBlock: number | null;
}
interface ClaimRow {
  readonly seriesId: string;
  readonly state: 'NOT_DEPLOYED' | 'INDEXED';
  readonly detail: string | null;
  readonly unpaid: { readonly A: string; readonly B: string } | null;
  readonly claimPaused: { readonly A: boolean; readonly B: boolean } | null;
  readonly asOfBlock: number | null;
}
interface PreparedCall {
  readonly to: string;
  readonly data: string;
  readonly signature: string;
  readonly says: string;
}
interface Answer {
  readonly address: string;
  readonly position: PositionRow | null;
  readonly claim: ClaimRow | null;
  readonly claimCalls: readonly PreparedCall[];
  readonly claimCallsState: string;
}

interface Props {
  readonly seriesId: string;
  readonly labels: { readonly A: string; readonly B: string };
}

const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

/** Base units as the API gives them, grouped for reading; never a float. */
function units(raw: string | null): string {
  if (raw === null) return '—';
  const s = raw.replace(/^0+(?=\d)/, '');
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function WalletLookup({ seriesId, labels }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const lookUp = async () => {
    const address = text.trim();
    if (!isAddress(address)) {
      setFault('an address is 20 bytes of hex with a 0x prefix');
      return;
    }
    setBusy(true);
    setFault(null);
    try {
      const [p, c, x] = await Promise.all([
        fetch(`/api/wallets/${address}/positions`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/wallets/${address}/claims`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/positions/${seriesId}/preview-exit?lots=1`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if ('error' in p || 'error' in c) {
        setFault(String(p.detail ?? c.detail ?? 'the API declined the address'));
        setAnswer(null);
        return;
      }
      const position = (p.positions as PositionRow[]).find((r) => r.seriesId === seriesId) ?? null;
      const claim = (c.claims as ClaimRow[]).find((r) => r.seriesId === seriesId) ?? null;
      const sign = 'signItYourself' in x ? (x.signItYourself as { state: string; calls: PreparedCall[] }) : { state: 'NOT_DEPLOYED', calls: [] };
      setAnswer({
        address: address.toLowerCase(),
        position,
        claim,
        claimCalls: sign.calls.filter((k) => k.signature === 'claimComponent(uint8)'),
        claimCallsState: sign.state,
      });
    } catch (cause) {
      setFault(cause instanceof Error ? cause.message : 'the API could not be reached');
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="cell p-6 sm:p-8">
        <div className="kicker">
          <b>My position</b> · read only · nothing is connected
        </div>
        <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
          What the index holds for an address in this series: active receipts, the units they entitle, and open exit claims per component. Claims are listed apart from
          receipts and never counted as backing, so nothing is counted twice.
        </p>
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void lookUp();
          }}
        >
          <label className="block">
            <span className="kicker">Address</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)"
            />
          </label>
          <button type="submit" disabled={busy} className="kicker mt-4 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:text-(--color-paper-faint)">
            {busy ? 'reading…' : 'Read the index'}
          </button>
          {fault ? (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
              {fault}
            </p>
          ) : null}
        </form>
      </div>

      <div className="cell p-6 sm:p-8">
        {answer === null ? (
          <p className="text-sm leading-relaxed text-(--color-paper-faint)">Nothing has been read. An address that has never touched the series reads as zero receipts and zero claims, not as an error.</p>
        ) : (
          <>
            <div className="kicker">
              <span className="tabular normal-case text-(--color-paper-dim)">{answer.address}</span>
            </div>
            {answer.position === null || answer.position.state === 'NOT_DEPLOYED' ? (
              <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
                {answer.position?.detail ?? 'The series is not deployed. No index exists, so no receipts or claims exist for any address, and none is shown.'}
              </p>
            ) : (
              <dl className="tabular mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-(--color-paper-faint)">Active receipts</dt>
                <dd className="text-(--color-paper)">{units(answer.position.receipts)} lots</dd>
                <dt className="text-(--color-paper-faint)">Entitles to</dt>
                <dd className="text-(--color-paper-dim)">
                  {units(answer.position.entitledUnits?.A ?? null)} base units of A ({labels.A}) · {units(answer.position.entitledUnits?.B ?? null)} base units of B ({labels.B})
                </dd>
                <dt className="text-(--color-paper-faint)">Open claims</dt>
                <dd className="text-(--color-paper-dim)">
                  A {units(answer.claim?.unpaid?.A ?? null)} base units
                  {answer.claim?.claimPaused?.A ? ' (claims of A stopped by the operator)' : ''} · B {units(answer.claim?.unpaid?.B ?? null)} base units
                  {answer.claim?.claimPaused?.B ? ' (claims of B stopped by the operator)' : ''}
                </dd>
                <dt className="text-(--color-paper-faint)">As of block</dt>
                <dd className="text-(--color-paper-dim)">{answer.position.asOfBlock ?? '—'}</dd>
              </dl>
            )}

            <div className="mt-5 border-t border-(--color-rule) pt-4">
              <div className="kicker">Claim components · sign it yourself</div>
              {answer.claimCallsState !== 'PREPARED' ? (
                <p className="mt-2 text-[12px] leading-relaxed text-(--color-paper-faint)">
                  Nothing is prepared for a series that is not deployed. When one is, the two claim calls appear here as bytes for your own wallet — one per component, so a
                  component that cannot move leaves the other claimable. The site still sends nothing.
                </p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {answer.claimCalls.map((k) => (
                    <li key={k.data} className="text-[12px]">
                      <div className="text-(--color-paper)">{k.says}</div>
                      <div className="tabular mt-1 break-all text-(--color-paper-faint)">
                        to {k.to}
                        <br />
                        data {k.data}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
