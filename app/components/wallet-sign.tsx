'use client';

import { useEffect, useRef, useState } from 'react';
import type { PreparedCall } from '@/lib/positions/calldata';
import { checkWalletReplacement, readWalletReview, type WalletReview } from '@/lib/positions/wallet-review';
import {
  blocksAnotherSubmission, callsForPositionAction, checkWalletTransaction,
  parsePendingWalletTransaction, parsePositionLots, readWalletIdentity,
  readWalletPosition, runWalletSteps,
  type PendingWalletTransaction, type PositionAction, type WalletIdentity,
  type WalletProvider, type WalletStep,
} from '@/lib/positions/wallet';

interface Props {
  readonly seriesId: string;
  readonly seriesAddress: string;
  readonly chainId: number;
  readonly labels: { readonly A: string; readonly B: string };
  readonly components: { readonly A: string; readonly B: string };
}
interface Preview {
  readonly state: string;
  readonly amounts?: { readonly A: string; readonly B: string };
  readonly receipts?: string;
  readonly indicativeValue?: { state: string; forLotsTotalUsd?: string | null; computedAt?: string; reason?: string; note?: string };
}
type WalletPosition = Awaited<ReturnType<typeof readWalletPosition>>;
const ACTIONS: readonly { id: PositionAction; label: string }[] = [
  { id: 'mint', label: 'Form a position' },
  { id: 'allocate', label: 'Allocate for exit' },
  { id: 'claimA', label: 'Claim A' },
  { id: 'claimB', label: 'Claim B' },
];
const buttonClass = 'kicker underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper) disabled:cursor-not-allowed disabled:text-(--color-paper-faint) disabled:no-underline';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'the wallet or node did not answer';
function provider(): WalletProvider | null {
  return (globalThis as unknown as { ethereum?: WalletProvider }).ethereum ?? null;
}

/** Wallet sends are separate from read-only previews. Unresolved sends survive a reload in this tab. */
export function WalletSign({ seriesId, seriesAddress, chainId, labels, components }: Props) {
  const [identity, setIdentity] = useState<WalletIdentity | null>(null);
  const [mode, setMode] = useState<PositionAction>('mint');
  const [lotsText, setLotsText] = useState('1');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [steps, setSteps] = useState<readonly WalletStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [position, setPosition] = useState<WalletPosition | null>(null);
  const [balanceFault, setBalanceFault] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingWalletTransaction | null>(null);
  const [restored, setRestored] = useState(false);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [review, setReview] = useState<WalletReview | null>(null);
  const [reviewFault, setReviewFault] = useState<string | null>(null);
  const [replacementHash, setReplacementHash] = useState('');
  const locked = useRef(false);
  const pendingRef = useRef<PendingWalletTransaction | null>(null);
  const storageKey = `curb:position:pending:${chainId}:${seriesAddress.toLowerCase()}`;
  const claiming = mode === 'claimA' || mode === 'claimB';
  const lots = parsePositionLots(lotsText);
  const blocked = busy || !restored || pending !== null;

  useEffect(() => {
    try {
      const saved = parsePendingWalletTransaction(sessionStorage.getItem(storageKey));
      pendingRef.current = saved;
      setPending(saved);
      setRestored(true);
    } catch {
      setFault('This tab cannot store an unresolved transaction. Wallet sending stays disabled until session storage is available.');
    }
  }, [storageKey]);

  const rememberPending = (next: PendingWalletTransaction | null) => {
    pendingRef.current = next;
    setPending(next);
    // Persist before asking the wallet to send. If storage fails, the send does not start.
    if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
    else sessionStorage.removeItem(storageKey);
  };

  const refreshPosition = async (p: WalletProvider, holder: WalletIdentity) => {
    setPosition(null);
    setBalanceFault(null);
    try { setPosition(await readWalletPosition(p, seriesAddress, holder)); }
    catch (cause) { setBalanceFault(message(cause)); }
  };

  const connect = async () => {
    if (locked.current) return;
    const p = provider();
    setFault(null);
    if (!p) { setFault('No EIP-1193 wallet is exposed in this browser.'); return; }
    locked.current = true;
    setBusy(true);
    setPosition(null);
    try {
      await p.request({ method: 'eth_requestAccounts' });
      const actual = await readWalletIdentity(p);
      setIdentity(actual);
      // A reconnect starts a fresh review, even if an earlier account still has a pending hash.
      // Persist that hash separately; approvals from one account never carry into another's steps.
      setPreview(null); setSteps([]); setReview(null); setReviewFault(null);
      if (actual.chainId !== chainId) setBalanceFault(`Switch to chain ${chainId} and reconnect to read this series.`);
      else await refreshPosition(p, actual);
    } catch (cause) { setIdentity(null); setFault(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };

  const prepare = async () => {
    if (locked.current || !restored || pendingRef.current) return;
    setFault(null);
    setPreview(null);
    setSteps([]);
    setReview(null);
    setReviewFault(null);
    if (!claiming && lots === null) { setFault('Lots must be a positive whole number written with digits only.'); return; }
    locked.current = true;
    setBusy(true);
    try {
      let calls: readonly PreparedCall[];
      let amounts: { A: string; B: string } | undefined;
      if (claiming) {
        calls = callsForPositionAction(mode, seriesAddress);
        setPreview({ state: 'PREPARED' });
      } else {
        const route = mode === 'mint' ? 'preview-mint' : 'preview-exit';
        const response = await fetch(`/api/positions/${seriesId}/${route}?lots=${lots!.toString()}`, { cache: 'no-store' });
        const result = await response.json() as {
          error?: string; detail?: string;
          deposit?: { A: string; B: string }; reserves?: { A: string; B: string };
          receipts?: string; burns?: string;
          indicativeValue?: Preview['indicativeValue'];
          signItYourself?: { state: string; calls: PreparedCall[] };
        };
        if (!response.ok || result.error) throw new Error(result.detail ?? result.error ?? 'The preview could not be read.');
        const state = result.signItYourself?.state ?? 'NOT_DEPLOYED';
        if (state !== 'PREPARED') { setPreview({ state }); return; }
        calls = callsForPositionAction(mode, seriesAddress, result.signItYourself?.calls ?? []);
        amounts = result.deposit ?? result.reserves;
        setPreview({ state, amounts, receipts: result.receipts ?? result.burns, indicativeValue: result.indicativeValue });
      }
      setSteps(calls.map((call) => ({ call, state: 'WAITING', hash: null, detail: null })));
      // Claims stay independent of both token readers, even when one token cannot answer.
      const p = provider();
      if (!claiming && p && identity?.chainId === chainId) {
        try { setReview(await readWalletReview(p, identity, seriesAddress, components, amounts, calls)); }
        catch (cause) { setReviewFault(message(cause)); }
      }
    } catch (cause) { setPreview(null); setFault(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };

  const sign = async () => {
    const p = provider();
    if (locked.current || !restored || pendingRef.current || !p || !identity || identity.chainId !== chainId || preview?.state !== 'PREPARED' || steps.length === 0) return;
    locked.current = true;
    setBusy(true);
    setFault(null);
    setPendingNote(null);
    setPosition(null);
    try {
      await runWalletSteps(p, identity, mode, steps, (progress) => {
        setSteps(progress);
        const unresolved = progress.find((step) => ['SUBMITTING', 'PENDING', 'UNCERTAIN'].includes(step.state));
        rememberPending(unresolved ? { ...identity, action: mode, hash: unresolved.hash } : null);
      });
      await refreshPosition(p, identity);
    } catch (cause) { setFault(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };

  const checkPending = async () => {
    const p = provider();
    const unresolved = pendingRef.current;
    if (locked.current || !p || !unresolved?.hash) return;
    locked.current = true;
    setBusy(true);
    setFault(null);
    try {
      const receipt = await checkWalletTransaction(p, unresolved);
      if (receipt === null) { setPendingNote('No receipt yet. The transaction remains unresolved; nothing was resent.'); return; }
      setSteps((current) => current.map((step) => step.hash === unresolved.hash ? { ...step, state: receipt.state, detail: `block ${receipt.block}` } : step));
      rememberPending(null);
      setPendingNote(`Transaction ${receipt.state.toLowerCase()} in block ${receipt.block}. Nothing was resent.`);
      if (identity?.chainId === chainId) await refreshPosition(p, identity);
    } catch (cause) { setFault(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };

  const resetUnknown = () => {
    if (locked.current || pendingRef.current?.hash !== null) return;
    try {
      rememberPending(null);
      setSteps([]);
      setPreview(null);
      setPendingNote('Previous outcome was not verified by this page. Review current wallet activity and balances before preparing a new action.');
    } catch (cause) { setFault(message(cause)); }
  };

  const checkReplacement = async () => {
    const p = provider();
    const unresolved = pendingRef.current;
    if (locked.current || !p || !unresolved?.hash) return;
    locked.current = true;
    setBusy(true);
    setFault(null);
    try {
      const result = await checkWalletReplacement(p, unresolved, replacementHash.trim());
      if (result === null) { setPendingNote('The replacement has no receipt yet. Sending remains blocked.'); return; }
      rememberPending(null);
      // A new preparation rereads state after any replacement; never continue old approval steps automatically.
      setSteps([]); setPreview(null); setReview(null); setReplacementHash('');
      setPendingNote(`Replacement ${result.state.toLowerCase()} in block ${result.block}. Review balances and prepare again; nothing was resent.`);
      if (identity?.chainId === chainId) await refreshPosition(p, identity);
    } catch (cause) { setFault(message(cause)); }
    finally { locked.current = false; setBusy(false); }
  };

  const canSign = !blocked && identity?.chainId === chainId && preview?.state === 'PREPARED' && steps.some((step) => step.state === 'WAITING') && !blocksAnotherSubmission(steps) && steps.every((step) => step.state === 'WAITING' || step.state === 'MINED');
  const complete = steps.length > 0 && steps.every((step) => step.state === 'MINED');

  return (
    <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="cell p-6 sm:p-8">
        <div className="kicker"><b>With your own wallet</b> · the site prepares, the wallet signs and sends</div>
        <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
          Series {seriesAddress.slice(0, 10)}… on chain {chainId}. Forming a position asks for two approvals, then one mint.
          Exit allocation creates claims; Claim A and Claim B are separate actions, in either order. A failed claim does not require another allocation.
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-(--color-paper-faint)">A: {labels.A}. B: {labels.B}. Base units remain visible; the review also shows token units when decimals can be read.</p>
        <div className="mt-5 flex flex-wrap items-baseline gap-4">
          {ACTIONS.map((action) => (
            <button key={action.id} type="button" disabled={blocked} aria-pressed={mode === action.id} onClick={() => { setMode(action.id); setPreview(null); setSteps([]); setFault(null); }} className={`${buttonClass} ${mode === action.id ? 'text-(--color-paper)' : ''}`}>{action.label}</button>
          ))}
        </div>
        {claiming ? (
          <p className="mt-4 text-sm leading-relaxed text-(--color-paper-dim)">
            Claim {mode === 'claimA' ? 'A' : 'B'} requests this wallet&apos;s entire outstanding claim on that component. No lots input or remaining receipts are needed. The other component is not called. Eligibility and a transferable component are still required.
          </p>
        ) : (
          <label className="mt-4 block">
            <span className="kicker">Lots · positive whole number</span>
            <input type="text" inputMode="numeric" value={lotsText} disabled={blocked} onChange={(event) => { setLotsText(event.target.value); setPreview(null); setSteps([]); }} className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)" />
          </label>
        )}
        <div className="mt-4 flex flex-wrap gap-4">
          <button type="button" disabled={blocked || (!claiming && lots === null)} onClick={() => void prepare()} className={buttonClass}>Prepare {ACTIONS.find((action) => action.id === mode)?.label.toLowerCase()}</button>
          <button type="button" disabled={busy} onClick={() => void connect()} className={buttonClass}>{identity ? 'Reconnect / refresh balances' : 'Connect wallet'}</button>
        </div>
        {identity ? <p className="tabular mt-3 break-all text-[11px] text-(--color-paper-faint)">{identity.account} on chain {identity.chainId}{identity.chainId !== chainId ? ` · switch to chain ${chainId} and reconnect` : ''}</p> : null}
        {fault ? <p role="alert" className="mt-4 text-[12px] text-(--color-state-stale)">{fault}</p> : null}
        {pending ? (
          <div className="mt-5 border border-(--color-rule) p-4">
            <div className="kicker">Unresolved wallet transaction · new sending is blocked</div>
            <p className="tabular mt-2 break-all text-[11px] text-(--color-paper-dim)">{pending.action} · {pending.account} · chain {pending.chainId}</p>
            {pending.hash ? (
              <>
                <p className="tabular mt-2 break-all text-[11px] text-(--color-paper-faint)">{pending.hash}</p>
                <button type="button" disabled={busy} onClick={() => void checkPending()} className={`${buttonClass} mt-3`}>Check this transaction · do not resend</button>
                <label className="mt-4 block text-[12px] text-(--color-paper-dim)">
                  Replacement hash from wallet activity (speed-up or cancellation)
                  <input aria-label="Replacement transaction hash" type="text" value={replacementHash} onChange={event => setReplacementHash(event.target.value)} disabled={busy} className="tabular mt-2 w-full min-w-0 border border-(--color-rule) bg-(--color-ink) px-2 py-2 text-[11px]" />
                </label>
                <button type="button" disabled={busy || !/^0x[0-9a-f]{64}$/i.test(replacementHash.trim())} onClick={() => void checkReplacement()} className={`${buttonClass} mt-3`}>Verify replacement</button>
                <p className="mt-2 text-[11px] text-(--color-paper-faint)">The node must prove the same sender and nonce. If the original transaction is unavailable, this page keeps the outcome unresolved.</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-[12px] text-(--color-paper-dim)">The wallet has not returned a hash. Inspect its activity before clearing this block; a transaction may already have been sent.</p>
                <button type="button" disabled={busy} onClick={resetUnknown} className={`${buttonClass} mt-3`}>I checked wallet activity; start a new preparation</button>
              </>
            )}
          </div>
        ) : null}
        {pendingNote ? <p role="status" className="mt-3 text-[12px] text-(--color-paper-dim)">{pendingNote}</p> : null}
        <div className="mt-5 border-t border-(--color-rule) pt-4">
          <div className="kicker">This wallet&apos;s receipts and pending claims</div>
          {position ? (
            <p className="tabular mt-2 text-[12px] leading-relaxed text-(--color-paper-dim)">
              Receipts: {position.receipts} lots · claim A: {position.claims.A} base units · claim B: {position.claims.B} base units.
              Read from the series through the wallet at block {position.block}. Zero receipts do not mean zero pending claims.
            </p>
          ) : <p className="mt-2 text-[12px] text-(--color-paper-faint)">{balanceFault ?? 'Connect or refresh the wallet to read balances. Unread balances are not shown as zero.'}</p>}
        </div>
      </div>
      <div className="cell p-6 sm:p-8">
        <div className="kicker">Review the prepared action</div>
        {preview === null ? <p className="mt-3 text-sm text-(--color-paper-faint)">Choose an action and prepare its transaction bytes. Preparing sends nothing.</p> : preview.state !== 'PREPARED' ? (
          <p className="mt-3 text-sm text-(--color-paper-faint)">Preview state: {preview.state}. No transaction is ready for signing.</p>
        ) : (
          <>
            {preview.amounts ? <p className="tabular mt-3 text-[12px] text-(--color-paper-dim)">{mode === 'mint' ? 'Deposit' : 'Reserve for separate claims'}: A {preview.amounts.A} base units · B {preview.amounts.B} base units.</p> : null}
            {preview.receipts ? <p className="mt-2 text-[12px] text-(--color-paper-dim)">{mode === 'mint' ? 'Receive' : 'Burn'} {preview.receipts} receipt lots. {mode === 'mint' ? 'The receipt cannot be transferred; exit requires allocation and component claims.' : 'Allocation records claims; it does not send components yet.'}</p> : null}
            {!claiming ? (
              <div className="mt-4 border border-(--color-rule) p-3 text-[12px] leading-relaxed text-(--color-paper-dim)">
                {review ? <>
                  <p className="kicker">Wallet readings · block {review.block}</p>
                  <p className="mt-1 break-all text-[10px]">{review.account} · chain {review.chainId} · {review.readAt}</p>
                  {(['A', 'B'] as const).map(id => {
                    const item = review.components[id];
                    return <p key={id} className="mt-2 break-words">{id}: {item.state === 'READ' ? `${item.amount ?? '—'} token units · allowance ${item.allowance} (${item.decimals} decimals)${mode === 'mint' && item.enoughAllowance !== null ? item.enoughAllowance ? ' · allowance covers this deposit' : ' · approval needed' : ''}` : `reading unavailable — ${item.reason}`}</p>;
                  })}
                  <p className="mt-2">Gas by step: {review.gas.map((g, i) => `${i + 1}: ${g.units === null ? 'unavailable' : `${g.units} units`}`).join(' · ')}. Estimates use current state; later steps may be unavailable until approvals are mined. The wallet supplies the current fee before signing.</p>
                </> : <p>{reviewFault ?? 'Connect the wallet on this chain and prepare again to read token units, existing allowances and gas estimates.'}</p>}
                <p className="mt-3">Indicative position value: {preview.indicativeValue?.state === 'INDICATIVE' && preview.indicativeValue.forLotsTotalUsd ? `US$${preview.indicativeValue.forLotsTotalUsd} · computed ${preview.indicativeValue.computedAt ?? 'time unavailable'}` : 'unavailable or incomplete'}.</p>
                <p className="mt-1">{preview.indicativeValue?.note ?? preview.indicativeValue?.reason ?? 'A value estimate is not a trade quote.'} Readings and gas estimates do not guarantee execution.</p>
              </div>
            ) : null}
            <ol className="mt-4 space-y-3">
              {steps.map((step, index) => (
                <li key={`${step.call.to}-${step.call.data}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-3 text-[12px]">
                  <span className="tabular text-(--color-accent)">{index + 1}</span>
                  <span>
                    <span className="text-(--color-paper)">{step.call.says}</span>
                    <span className="tabular block break-all text-[10px] text-(--color-paper-faint)">to {step.call.to}</span>
                    {step.hash ? <span className="tabular block break-all text-[10px] text-(--color-paper-faint)">tx {step.hash}</span> : null}
                    {step.detail ? <span className="block text-[10px] text-(--color-paper-faint)">{step.detail}</span> : null}
                  </span>
                  <span className="tabular text-[10px] uppercase tracking-[0.14em]" style={{ color: step.state === 'MINED' ? 'var(--color-state-live)' : ['REVERTED', 'REFUSED', 'BLOCKED', 'UNCERTAIN'].includes(step.state) ? 'var(--color-state-stale)' : 'var(--color-paper-faint)' }}>{step.state.toLowerCase()}</span>
                </li>
              ))}
            </ol>
            <button type="button" disabled={!canSign} onClick={() => void sign()} className={`${buttonClass} mt-5`}>
              {busy ? 'Waiting for the wallet…' : pending ? 'Check the unresolved transaction first' : complete ? 'Action completed' : !identity ? 'Connect a wallet to sign' : identity.chainId !== chainId ? 'Switch chain and reconnect' : steps.some((step) => step.state === 'MINED') ? 'Sign remaining steps in the wallet' : 'Sign in the wallet'}
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-(--color-paper-faint)">The current account and chain are checked again before every transaction. Confirmed steps are skipped when continuing. A reverted, refused or blocked action needs a fresh preparation.</p>
          </>
        )}
      </div>
    </div>
  );
}
