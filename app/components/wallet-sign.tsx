'use client';

import { useState } from 'react';

/**
 * "Form a position" and "Claim components" with the holder's own wallet
 * (blueprint U03, U04), for a series that is deployed. The site prepares the
 * bytes (the preview endpoints), the wallet signs and sends them; nothing
 * here holds a key or sends anything itself. The receipt is shown from the
 * chain — balanceOf on the series, through the same wallet — only after the
 * transaction is mined with status 1; the index catches up on the next tick
 * and is shown separately, as the index. A wallet on the wrong chain is told
 * so and nothing is sent.
 */

interface PreparedCall {
  readonly to: string;
  readonly data: string;
  readonly signature: string;
  readonly says: string;
}
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
type Step = { readonly call: PreparedCall; readonly state: 'WAITING' | 'SENT' | 'MINED' | 'REVERTED' | 'REFUSED'; readonly hash: string | null; readonly detail: string | null };

interface Props {
  readonly seriesId: string;
  readonly seriesAddress: string;
  readonly chainId: number;
}

const SELECTOR_BALANCE_OF = '0x70a08231';

function provider(): Eip1193 | null {
  const w = globalThis as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
}

async function waitForReceipt(p: Eip1193, hash: string): Promise<{ status: string; blockNumber: string } | null> {
  for (let i = 0; i < 120; i += 1) {
    const r = (await p.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string; blockNumber?: string } | null;
    if (r && r.status && r.blockNumber) return { status: r.status, blockNumber: r.blockNumber };
    await new Promise((res) => setTimeout(res, 1000));
  }
  return null;
}

export function WalletSign({ seriesId, seriesAddress, chainId }: Props) {
  const [account, setAccount] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [mode, setMode] = useState<'mint' | 'exit'>('mint');
  const [lotsText, setLotsText] = useState('1');
  const [preview, setPreview] = useState<{ deposit?: { A: string; B: string }; reserves?: { A: string; B: string }; calls: PreparedCall[]; state: string } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [receiptsOnChain, setReceiptsOnChain] = useState<string | null>(null);

  const connect = async () => {
    const p = provider();
    setFault(null);
    if (!p) {
      setFault('no wallet (EIP-1193 provider) is exposed in this browser; nothing can be signed here');
      return;
    }
    try {
      const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
      const chain = Number((await p.request({ method: 'eth_chainId' })) as string);
      setAccount(accounts[0]?.toLowerCase() ?? null);
      setWalletChain(chain);
    } catch (cause) {
      setFault(cause instanceof Error ? cause.message : 'the wallet declined');
    }
  };

  const load = async () => {
    setFault(null);
    setSteps([]);
    const lots = lotsText.trim();
    if (!/^[1-9][0-9]{0,9}$/.test(lots)) {
      setFault('lots must be a positive whole number');
      return;
    }
    const r = await fetch(`/api/positions/${seriesId}/${mode === 'mint' ? 'preview-mint' : 'preview-exit'}?lots=${lots}`, { cache: 'no-store' });
    const j = (await r.json()) as { error?: string; detail?: string; deposit?: { A: string; B: string }; reserves?: { A: string; B: string }; signItYourself?: { state: string; calls: PreparedCall[] } };
    if (j.error) {
      setFault(j.detail ?? j.error);
      setPreview(null);
      return;
    }
    setPreview({ deposit: j.deposit, reserves: j.reserves, calls: j.signItYourself?.calls ?? [], state: j.signItYourself?.state ?? 'NOT_DEPLOYED' });
  };

  const readReceipts = async (p: Eip1193, holder: string) => {
    const data = `${SELECTOR_BALANCE_OF}${holder.slice(2).toLowerCase().padStart(64, '0')}`;
    const raw = (await p.request({ method: 'eth_call', params: [{ to: seriesAddress, data }, 'latest'] })) as string;
    setReceiptsOnChain(raw && raw !== '0x' ? BigInt(raw).toString() : null);
  };

  const sign = async () => {
    const p = provider();
    if (!p || !account || !preview) return;
    if (walletChain !== chainId) {
      setFault(`the wallet is on chain ${walletChain ?? '?'}; the series is on chain ${chainId}. Nothing was sent.`);
      return;
    }
    setBusy(true);
    setFault(null);
    const progress: Step[] = preview.calls.map((call) => ({ call, state: 'WAITING', hash: null, detail: null }));
    setSteps([...progress]);
    try {
      for (let i = 0; i < progress.length; i += 1) {
        const call = progress[i]!.call;
        let hash: string;
        try {
          hash = (await p.request({ method: 'eth_sendTransaction', params: [{ from: account, to: call.to, data: call.data }] })) as string;
        } catch (cause) {
          progress[i] = { call, state: 'REFUSED', hash: null, detail: cause instanceof Error ? cause.message : 'the wallet or the node refused' };
          setSteps([...progress]);
          break; // a refused step stops the sequence; what was sent before stands, as on chain
        }
        progress[i] = { call, state: 'SENT', hash, detail: null };
        setSteps([...progress]);
        const receipt = await waitForReceipt(p, hash);
        if (receipt === null) {
          progress[i] = { call, state: 'SENT', hash, detail: 'not mined within two minutes; the transaction may still be pending' };
          setSteps([...progress]);
          break;
        }
        progress[i] = { call, state: receipt.status === '0x1' ? 'MINED' : 'REVERTED', hash, detail: `block ${Number(receipt.blockNumber)}` };
        setSteps([...progress]);
        if (receipt.status !== '0x1') break;
      }
      await readReceipts(p, account);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="cell p-6 sm:p-8">
        <div className="kicker">
          <b>With your own wallet</b> · the site prepares, the wallet signs and sends
        </div>
        <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
          Series {seriesAddress.slice(0, 10)}… on chain {chainId}. Each step is one transaction your wallet shows you before it is sent: approvals, then the mint; or the exit
          allocation, then a claim per component. The receipt is read back from the chain only after the mint is mined.
        </p>
        <div className="mt-5 flex flex-wrap items-baseline gap-4">
          {(['mint', 'exit'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setPreview(null); setSteps([]); }} className={`kicker underline-offset-4 ${mode === m ? 'text-(--color-paper) underline decoration-(--color-accent)' : 'hover:text-(--color-paper)'}`}>
              {m === 'mint' ? 'Form a position' : 'Allocate for exit and claim'}
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="kicker">Lots</span>
          <input type="number" min={1} step={1} value={lotsText} onChange={(e) => setLotsText(e.target.value)} className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)" />
        </label>
        <div className="mt-4 flex flex-wrap gap-4">
          <button type="button" onClick={() => void load()} className="kicker underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">
            Prepare
          </button>
          {account === null ? (
            <button type="button" onClick={() => void connect()} className="kicker underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">
              Connect wallet
            </button>
          ) : (
            <span className="kicker text-(--color-paper-faint)">
              <span className="normal-case tabular">{account.slice(0, 10)}…</span> on chain {walletChain}
              {walletChain !== chainId ? ' — wrong chain' : ''}
            </span>
          )}
        </div>
        {fault ? (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--color-state-stale)' }}>
            {fault}
          </p>
        ) : null}
      </div>

      <div className="cell p-6 sm:p-8">
        {preview === null ? (
          <p className="text-sm leading-relaxed text-(--color-paper-faint)">Nothing is prepared. Prepare a preview first; nothing is sent until you sign each step in your wallet.</p>
        ) : preview.state !== 'PREPARED' ? (
          <p className="text-sm leading-relaxed text-(--color-paper-faint)">The preview prepared no bytes ({preview.state.toLowerCase().replace('_', ' ')}); there is nothing to sign.</p>
        ) : (
          <>
            <div className="kicker">{mode === 'mint' ? 'Deposits, exactly' : 'Reserved on exit, exactly'}</div>
            <p className="tabular mt-2 text-[12px] text-(--color-paper-dim)">
              A {(preview.deposit ?? preview.reserves)?.A} base units · B {(preview.deposit ?? preview.reserves)?.B} base units
            </p>
            <ol className="mt-4 space-y-3">
              {preview.calls.map((call, i) => {
                const step = steps[i];
                return (
                  <li key={call.data} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-3 text-[12px]">
                    <span className="tabular text-(--color-accent)">{i + 1}</span>
                    <span>
                      <span className="text-(--color-paper)">{call.says}</span>
                      <span className="tabular block break-all text-[10px] text-(--color-paper-faint)">to {call.to}</span>
                      {step?.hash ? <span className="tabular block break-all text-[10px] text-(--color-paper-faint)">tx {step.hash}</span> : null}
                      {step?.detail ? <span className="block text-[10px] text-(--color-paper-faint)">{step.detail}</span> : null}
                    </span>
                    <span className="tabular text-[10px] uppercase tracking-[0.14em]" style={{ color: step?.state === 'MINED' ? 'var(--color-state-live)' : step?.state === 'REVERTED' || step?.state === 'REFUSED' ? 'var(--color-state-dark)' : 'var(--color-paper-faint)' }}>
                      {step ? step.state.toLowerCase() : 'not sent'}
                    </span>
                  </li>
                );
              })}
            </ol>
            <button type="button" disabled={busy || account === null || walletChain !== chainId} onClick={() => void sign()} className="kicker mt-5 underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:cursor-not-allowed disabled:text-(--color-paper-faint) disabled:no-underline">
              {busy ? 'waiting for the wallet…' : account === null ? 'connect a wallet to sign' : walletChain !== chainId ? 'switch the wallet to the series’ chain' : 'Sign each step in the wallet'}
            </button>
            {receiptsOnChain !== null ? (
              <p className="tabular mt-4 border-t border-(--color-rule) pt-3 text-[12px] text-(--color-paper-dim)">
                Receipts on chain for {account?.slice(0, 10)}…: <span className="text-(--color-paper)">{receiptsOnChain}</span> lots — read from the series contract through the wallet after mining. The index and “my position” catch up on the next tick.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
