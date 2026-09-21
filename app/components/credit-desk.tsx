'use client';

import { useEffect, useState } from 'react';
import type { PendingState } from '@/lib/credits/pending';
import { newBrowserKey, sha256Hex } from '@/lib/credits/browser-key';

/**
 * The credit desk, in the browser: a key made here — thirty-two random
 * bytes, hashed with SubtleCrypto — that never leaves the page unless the
 * reader copies it; a quote for a dollar figure at the last rate read; and
 * a balance lookup by hash. Nothing is sent to the desk to make a key: the
 * desk learns of the hash when the chain credits it. No wallet is
 * connected here; the top-up is a call the reader signs elsewhere, with
 * the bytes shown.
 */

interface Quote {
  readonly state: string;
  readonly usd?: string;
  readonly curb?: string | null;
  readonly curbText?: string;
  readonly curbWithMargin?: string;
  readonly curbWithMarginText?: string;
  readonly marginPct?: number;
  readonly atBlock?: number;
  readonly readAt?: string;
  readonly detail?: string;
  readonly error?: string;
}

interface Account {
  readonly hash: string;
  readonly status: string;
  readonly creditedCents: string;
  readonly spentCents: string;
  readonly balanceCents: string;
  readonly toOpenCents: string;
  readonly topUps: readonly { readonly transactionHash: string; readonly logIndex: number; readonly blockNumber: number; readonly amount: string; readonly cents: string; readonly basis: string; readonly ratedAtBlock: number }[];
  readonly balanceState: 'READ' | 'UNREAD';
  readonly pending: readonly { readonly transactionHash: string; readonly logIndex: number; readonly blockNumber: number; readonly amount: string; readonly reason: string }[] | null;
  readonly pendingState: PendingState;
  readonly pendingFault: string | null;
  /** Shown to the key's holder only; null for anyone else. */
  readonly charges: readonly { readonly at: string; readonly service: string; readonly cents: number; readonly ref: string }[] | null;
  readonly chargeCount: number;
  readonly storeFault: string | null;
  readonly error?: string;
  readonly detail?: string;
}

interface Props {
  readonly configured: boolean;
  readonly desk: string | null;
  readonly network: string | null;
  readonly decimals: number | null;
  readonly topUpHeld: string | null;
}

interface TopUpHint {
  readonly desk: string;
  readonly network: string;
  readonly token: string;
  readonly tokenDecimals: number | null;
  readonly validUntil: string | null;
}

const cents = (v: string) => {
  const n = BigInt(v);
  const sign = n < 0n ? '-' : '';
  const a = n < 0n ? -n : n;
  return `${sign}US$${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(a % 100n).toString().padStart(2, '0')}`;
};

/** The bytes of topUp(bytes32,uint256), assembled here so the reader can compare them with what a wallet shows. */
function topUpCalldata(keyHash: string, amount: bigint): string {
  // keccak256("topUp(bytes32,uint256)")[:4] — fixed here and checked against the ABI in the tests.
  const selector = '0xb67644b9';
  return `${selector}${keyHash.slice(2)}${amount.toString(16).padStart(64, '0')}`;
}

export function CreditDesk({ configured, desk, network, decimals, topUpHeld }: Props) {
  const [key, setKey] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [usd, setUsd] = useState('20');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [topUp, setTopUp] = useState<TopUpHint | null>(null);
  const [held, setHeld] = useState<string | null>(topUpHeld);
  const [clock, setClock] = useState(0);
  const [lookup, setLookup] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    if (topUp === null) return;
    const update = () => setClock(Date.now());
    const timer = window.setInterval(update, 1_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [topUp]);

  const makeKey = async () => {
    const made = await newBrowserKey();
    setKey(made.key);
    setHash(made.hash);
    setLookup(made.hash);
    setAccount(null);
  };

  const ask = async () => {
    setBusy('quote');
    setFault(null);
    setQuote(null);
    setTopUp(null);
    try {
      const r = await fetch(`/api/credits?usd=${encodeURIComponent(usd.trim())}`, { cache: 'no-store' });
      const body = (await r.json()) as { quote: Quote | null; topUp: TopUpHint | null; topUpHeld: string | null };
      if (!r.ok) throw new Error('the quote endpoint could not answer; no payment bytes are composed');
      setQuote(body.quote ?? null);
      setTopUp(body.quote?.state === 'QUOTED' ? body.topUp ?? null : null);
      setHeld(body.topUpHeld ?? null);
      setClock(Date.now());
    } catch (cause) {
      setFault(cause instanceof Error ? cause.message : 'the API could not be reached');
    } finally {
      setBusy(null);
    }
  };

  const look = async () => {
    const h = lookup.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(h)) {
      setFault('a key hash is 0x followed by 64 hex digits');
      return;
    }
    setBusy('lookup');
    setFault(null);
    try {
      const r = await fetch(`/api/keys/${h}`, { cache: 'no-store', headers: key && (await sha256Hex(key)) === h ? { 'x-curb-key': key } : {} });
      setAccount((await r.json()) as Account);
    } catch (cause) {
      setFault(cause instanceof Error ? cause.message : 'the API could not be reached');
    } finally {
      setBusy(null);
    }
  };

  // Destination and amount belong to the same fresh API response. Page props
  // may predate a configuration change; they never authorize payment bytes.
  const verified = topUp !== null && topUp.validUntil !== null && clock <= Date.parse(topUp.validUntil);
  const amount = verified && quote?.state === 'QUOTED' && quote.curbWithMargin && /^[1-9]\d*$/.test(quote.curbWithMargin) ? BigInt(quote.curbWithMargin) : null;

  return (
    <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="cell p-6 sm:p-8">
        <div className="kicker">
          <b>A key</b> · made here · never sent
        </div>
        <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
          Thirty-two random bytes from this browser, hashed with SHA-256. The desk stores neither; it learns of the hash when the chain credits it. Copy the key now — it is not shown again, and a lost key is a lost balance.
        </p>
        <button type="button" disabled={busy !== null} onClick={() => void makeKey()} className="kicker mt-5 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:text-(--color-paper-faint)">
          {key ? 'Make another key' : 'Make a key'}
        </button>
        {key && hash ? (
          <dl className="mt-4 space-y-3 text-[12px]">
            <div>
              <dt className="kicker">Key · send as x-curb-key</dt>
              <dd className="tabular mt-1 break-all text-(--color-paper)">{key}</dd>
            </div>
            <div>
              <dt className="kicker">Key hash · the bytes32 the chain credits</dt>
              <dd className="tabular mt-1 break-all text-(--color-paper-dim)">{hash}</dd>
            </div>
          </dl>
        ) : null}

        <div className="kicker mt-8">
          <b>A quote</b> · dollars to CURB at the last rate read
        </div>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label className="block">
            <span className="kicker">US dollars</span>
            <input type="text" inputMode="decimal" disabled={busy === 'quote'} value={usd} onChange={(e) => { setUsd(e.target.value); setQuote(null); setTopUp(null); }} className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)" />
          </label>
          <button type="submit" disabled={busy !== null} className="kicker mt-4 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:text-(--color-paper-faint)">
            {busy === 'quote' ? 'reading…' : 'Quote'}
          </button>
        </form>
        {quote ? (
          quote.state === 'QUOTED' && amount !== null ? (
            <p className="tabular mt-3 text-[12px] text-(--color-paper-dim)">
              {quote.usd} = <span className="text-(--color-paper)">{quote.curbText} CURB</span> at block {quote.atBlock}, read {quote.readAt}. The credit is at the rate at the block the top-up is mined — or the lowest the pool showed in the hour before it, whichever is lower — not at this one, so the bytes below carry {quote.marginPct}% more — <span className="text-(--color-paper)">{quote.curbWithMarginText} CURB</span>; what lands over {quote.usd} stays on the key. This buffer is an estimate, not a slippage limit or a guaranteed minimum credit: a lower mined rate can still leave the key below the requested amount. The lookback limits short spikes; it does not make a thin pool manipulation-proof.
            </p>
          ) : (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
              {quote.error ?? quote.state}: {quote.detail ?? (quote.state === 'QUOTED' ? 'the payment evidence has expired; request a new quote' : 'no CURB amount is quoted')}
            </p>
          )
        ) : null}
        {fault ? (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
            {fault}
          </p>
        ) : null}
      </div>

      <div className="cell p-6 sm:p-8">
        <div className="kicker">
          <b>The top-up</b> · one call, signed in your own wallet
        </div>
        {!verified ? (
          <p className="mt-3 text-sm leading-relaxed wrap-anywhere" style={{ color: 'var(--color-state-stale)' }}>
            {held ?? (topUp !== null ? 'The payment evidence has expired.' : configured ? `Desk ${desk} on ${network} is recorded here. Request a quote to check current code and rate evidence before paying.` : 'No desk is configured on this page; request a quote to check its current status.')} No payment bytes are composed until a quote confirms current code and rate evidence for its destination.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim) wrap-anywhere">
            Approve token <span className="tabular break-all">{topUp!.token}</span> for the desk at <span className="tabular break-all text-(--color-paper)">{topUp!.desk}</span> on {topUp!.network} for the amount, then call <span className="tabular">topUp(bytes32 keyHash, uint256 amount)</span>. Evidence is current until {topUp!.validUntil}; request a fresh quote before signing if that time passes. The desk moves CURB to the treasury. Credit is determined at the mined block, or the lowest rate in the lookback window, whichever is lower.
          </p>
        )}
        <dl className="mt-4 space-y-3 text-[12px]">
          <div>
            <dt className="kicker">topUp calldata{hash && amount !== null ? '' : !verified ? ' · not composed' : ' · make a key and a quote first'}</dt>
            <dd className="tabular mt-1 break-all text-(--color-paper-dim)">{hash && amount !== null ? topUpCalldata(hash, amount) : '—'}</dd>
          </div>
          <div>
            <dt className="kicker">amount · CURB base units{(topUp?.tokenDecimals ?? decimals) !== null ? ` (${topUp?.tokenDecimals ?? decimals} decimals)` : ''}</dt>
            <dd className="tabular mt-1 break-all text-(--color-paper-dim)">{amount !== null ? amount.toString() : '—'}</dd>
          </div>
        </dl>

        <div className="kicker mt-8">
          <b>A balance</b> · by key hash · public
        </div>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void look();
          }}
        >
          <label className="block">
            <span className="kicker">Key hash</span>
            <input type="text" autoComplete="off" spellCheck={false} placeholder="0x…" disabled={busy === 'lookup'} value={lookup} onChange={(e) => { setLookup(e.target.value); setAccount(null); }} className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)" />
          </label>
          <button type="submit" disabled={busy !== null} className="kicker mt-4 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:text-(--color-paper-faint)">
            {busy === 'lookup' ? 'reading…' : 'Read the balance'}
          </button>
        </form>
        {account ? (
          account.error ? (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
              {account.error}: {account.detail}
            </p>
          ) : account.storeFault ? (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
              The desk&rsquo;s rows could not be read ({account.storeFault}). Nothing is stated in their place: a store that does not answer is not a hash with nothing on it.
            </p>
          ) : (
            <div className="mt-4 text-[12px]">
              <p className="tabular text-(--color-paper)">
                {account.status.replace('_', ' ').toLowerCase()} · credited {cents(account.creditedCents)} · spent {cents(account.spentCents)} · balance {cents(account.balanceCents)}
                {account.status !== 'OPEN' ? ` · ${cents(account.toOpenCents)} more to open` : ''}
              </p>
              {account.topUps.length > 0 ? (
                <ul className="mt-3 space-y-1 text-(--color-paper-dim)">
                  {account.topUps.map((t) => (
                    <li key={`${t.transactionHash}:${t.logIndex}`} className="tabular break-all">
                      block {t.blockNumber} · {t.amount} base units · {cents(t.cents)} · rated at block {t.ratedAtBlock} ({t.basis.replace(/_/g, ' ').toLowerCase()}) · {t.transactionHash}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-(--color-paper-faint)">No credited top-up is recorded for this hash.</p>
              )}
              {account.pendingState !== 'READ' ? (
                <p className="mt-3" style={{ color: 'var(--color-state-stale)' }}>
                  {account.pendingState === 'UNREAD' ? `Pending top-ups could not be read (${account.pendingFault}).` : account.pendingState === 'NOT_REQUESTED' ? 'Pending top-ups were not requested.' : 'No pending top-up index has been recorded yet.'} The credited balance above was read separately. Pending payments are unknown, so check the transaction and wait for reconciliation before sending again.
                </p>
              ) : account.pending !== null && account.pending.length > 0 ? (
                <ul className="mt-3 space-y-1 text-(--color-paper-dim)">
                  {account.pending.map((t) => (
                    <li key={`pending:${t.transactionHash}:${t.logIndex}`} className="tabular break-all">
                      block {t.blockNumber} · {t.amount} base units · <span className="text-(--color-paper)">read, not yet credited</span> — {t.reason} · {t.transactionHash}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-(--color-paper-faint)">No pending top-up for this hash is recorded in the index just read.</p>}
              {account.charges !== null && account.charges.length > 0 ? (
                <p className="mt-3 text-(--color-paper-faint)">
                  {account.chargeCount} charge{account.chargeCount === 1 ? '' : 's'}; the last: {account.charges[account.charges.length - 1]!.service} · {account.charges[account.charges.length - 1]!.ref} · {account.charges[account.charges.length - 1]!.at}
                </p>
              ) : account.chargeCount > 0 ? (
                <p className="mt-3 text-(--color-paper-faint)">{account.chargeCount} charge{account.chargeCount === 1 ? '' : 's'}; what they bought is shown to the key&rsquo;s holder only.</p>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
