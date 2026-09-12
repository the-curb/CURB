'use client';

import { useState } from 'react';

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
  readonly topUps: readonly { readonly transactionHash: string; readonly blockNumber: number; readonly amount: string; readonly cents: string; readonly basis: string; readonly ratedAtBlock: number }[];
  readonly charges: readonly { readonly at: string; readonly service: string; readonly cents: number; readonly ref: string }[];
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
}

const cents = (v: string) => {
  const n = BigInt(v);
  const sign = n < 0n ? '-' : '';
  const a = n < 0n ? -n : n;
  return `${sign}US$${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(a % 100n).toString().padStart(2, '0')}`;
};

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The bytes of topUp(bytes32,uint256), assembled here so the reader can compare them with what a wallet shows. */
function topUpCalldata(keyHash: string, amount: bigint): string {
  // keccak256("topUp(bytes32,uint256)")[:4] — fixed here and checked against the ABI in the tests.
  const selector = '0xb67644b9';
  return `${selector}${keyHash.slice(2)}${amount.toString(16).padStart(64, '0')}`;
}

export function CreditDesk({ configured, desk, network, decimals }: Props) {
  const [key, setKey] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [usd, setUsd] = useState('20');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lookup, setLookup] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  const makeKey = async () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const k = `curb_${base64url(bytes)}`;
    setKey(k);
    setHash(await sha256Hex(k));
    setLookup(await sha256Hex(k));
    setAccount(null);
  };

  const ask = async () => {
    setBusy('quote');
    setFault(null);
    try {
      const r = await fetch(`/api/credits?usd=${encodeURIComponent(usd.trim())}`, { cache: 'no-store' });
      const body = (await r.json()) as { quote: Quote | null };
      setQuote(body.quote);
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
      const r = await fetch(`/api/keys/${h}`, { cache: 'no-store' });
      setAccount((await r.json()) as Account);
    } catch (cause) {
      setFault(cause instanceof Error ? cause.message : 'the API could not be reached');
    } finally {
      setBusy(null);
    }
  };

  const amount = quote?.curb ? BigInt(quote.curb) : null;

  return (
    <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="cell p-6 sm:p-8">
        <div className="kicker">
          <b>A key</b> · made here · never sent
        </div>
        <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
          Thirty-two random bytes from this browser, hashed with SHA-256. The desk stores neither; it learns of the hash when the chain credits it. Copy the key now — it is not shown again, and a lost key is a lost balance.
        </p>
        <button type="button" onClick={() => void makeKey()} className="kicker mt-5 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">
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
            <input type="text" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)" />
          </label>
          <button type="submit" disabled={busy !== null} className="kicker mt-4 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:text-(--color-paper-faint)">
            {busy === 'quote' ? 'reading…' : 'Quote'}
          </button>
        </form>
        {quote ? (
          quote.state === 'QUOTED' && amount !== null ? (
            <p className="tabular mt-3 text-[12px] text-(--color-paper-dim)">
              {quote.usd} = <span className="text-(--color-paper)">{quote.curbText} CURB</span> at block {quote.atBlock}, read {quote.readAt}. The credit is at the rate at the block the top-up is mined, not at this one.
            </p>
          ) : (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
              {quote.error ?? quote.state}: {quote.detail ?? 'no CURB amount is quoted'}
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
        {!configured ? (
          <p className="mt-3 text-sm leading-relaxed text-(--color-paper-faint)">No desk is configured: no token exists and no pool is read. The bytes below are what the call will be; there is no address to send them to yet.</p>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
            Approve the desk at <span className="tabular text-(--color-paper)">{desk}</span> on {network} for the amount, then call <span className="tabular">topUp(bytes32 keyHash, uint256 amount)</span>. The desk moves the CURB to the treasury and emits the hash and the amount; the next tick credits the hash at the rate at that block.
          </p>
        )}
        <dl className="mt-4 space-y-3 text-[12px]">
          <div>
            <dt className="kicker">topUp calldata{hash && amount !== null ? '' : ' · make a key and a quote first'}</dt>
            <dd className="tabular mt-1 break-all text-(--color-paper-dim)">{hash && amount !== null ? topUpCalldata(hash, amount) : '—'}</dd>
          </div>
          <div>
            <dt className="kicker">amount · CURB base units{decimals !== null ? ` (${decimals} decimals)` : ''}</dt>
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
            <input type="text" autoComplete="off" spellCheck={false} placeholder="0x…" value={lookup} onChange={(e) => setLookup(e.target.value)} className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)" />
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
          ) : (
            <div className="mt-4 text-[12px]">
              <p className="tabular text-(--color-paper)">
                {account.status.replace('_', ' ').toLowerCase()} · credited {cents(account.creditedCents)} · spent {cents(account.spentCents)} · balance {cents(account.balanceCents)}
                {account.status !== 'OPEN' ? ` · ${cents(account.toOpenCents)} more to open` : ''}
              </p>
              {account.storeFault ? <p className="mt-2" style={{ color: 'var(--color-state-stale)' }}>{account.storeFault}</p> : null}
              {account.topUps.length > 0 ? (
                <ul className="mt-3 space-y-1 text-(--color-paper-dim)">
                  {account.topUps.map((t) => (
                    <li key={`${t.transactionHash}:${t.blockNumber}`} className="tabular break-all">
                      block {t.blockNumber} · {t.amount} base units · {cents(t.cents)} · rated at block {t.ratedAtBlock} ({t.basis.replace(/_/g, ' ').toLowerCase()}) · {t.transactionHash}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-(--color-paper-faint)">The chain has credited nothing to this hash.</p>
              )}
              {account.charges.length > 0 ? (
                <p className="mt-3 text-(--color-paper-faint)">
                  {account.chargeCount} charge{account.chargeCount === 1 ? '' : 's'}; the last: {account.charges[account.charges.length - 1]!.service} · {account.charges[account.charges.length - 1]!.ref} · {account.charges[account.charges.length - 1]!.at}
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
