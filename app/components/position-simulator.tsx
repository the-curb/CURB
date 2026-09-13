'use client';

import { useMemo, useState } from 'react';
import { parsePositionLots } from '@/lib/positions/wallet';
import {
  active,
  allocateExit,
  checkInvariants,
  claim,
  claimsOf,
  COMPONENTS,
  donate,
  liability,
  lose,
  mint,
  openSeries,
  receiptsOf,
  setClaimPaused,
  setMintPaused,
  setTransferable,
  shortfall,
  surplus,
  type ComponentId,
  type LedgerResult,
  type LedgerState,
} from '@/lib/positions/ledger';

/**
 * The ledger, run by hand. Every button calls the same functions the tests
 * call; nothing here is drawn separately from the model. Units are the
 * blueprint's illustrative ones and the page says so above the table. No
 * price, no gas, no wallet, no chain: this shows the bookkeeping and nothing
 * the bookkeeping cannot show.
 */

const YOU = 'you';

interface Props {
  readonly seriesName: string;
  readonly q: { readonly A: string; readonly B: string };
  readonly capLots: string;
  readonly labels: { readonly A: string; readonly B: string };
}

const fmt = (n: bigint) => n.toLocaleString('en-US');

export function PositionSimulator({ seriesName, q, capLots, labels }: Props) {
  const qb = useMemo(() => ({ A: BigInt(q.A), B: BigInt(q.B) }), [q.A, q.B]);
  const cap = useMemo(() => BigInt(capLots), [capLots]);
  const [state, setState] = useState<LedgerState>(() => openSeries(qb, cap));
  const [log, setLog] = useState<readonly { ok: boolean; text: string }[]>([]);
  const [lotsText, setLotsText] = useState('3');

  const lots = parsePositionLots(lotsText);

  const record = (entry: { ok: boolean; text: string }) => setLog((prev) => [entry, ...prev].slice(0, 14));

  const apply = (result: LedgerResult) => {
    if (result.ok) {
      setState(result.state);
      record({ ok: true, text: result.note });
    } else {
      record({ ok: false, text: `refused — ${result.reason}: ${result.detail}` });
    }
  };

  const toggle = (label: string, next: LedgerState) => {
    setState(next);
    record({ ok: true, text: label });
  };

  const replay = () => {
    let s = openSeries(qb, cap);
    const lines: { ok: boolean; text: string }[] = [];
    const step = (r: LedgerResult, label: string) => {
      if (r.ok) {
        s = r.state;
        lines.push({ ok: true, text: `${label}: ${r.note}` });
      } else {
        lines.push({ ok: false, text: `${label}: refused — ${r.reason}` });
      }
    };
    step(mint(s, 'alice', 25n), 'Alice mints 25');
    step(mint(s, 'others', 75n), 'Others mint 75');
    step(allocateExit(s, 'alice', 25n), 'Alice allocates 25 for exit');
    s = setTransferable(s, 'A', false);
    lines.push({ ok: true, text: 'The issuer halts transfers of A' });
    step(claim(s, 'alice', 'A'), 'Alice claims A');
    step(claim(s, 'alice', 'B'), 'Alice claims B');
    step(mint(s, 'bob', 10n), 'Bob mints 10 while A is halted');
    s = setTransferable(s, 'A', true);
    lines.push({ ok: true, text: 'A transfers resume' });
    step(mint(s, 'bob', 10n), 'Bob mints 10');
    setState(s);
    setLog(lines.reverse());
  };

  const reset = () => {
    setState(openSeries(qb, cap));
    setLog([]);
  };

  const invariants = checkInvariants(state);
  const yours = claimsOf(state, YOU);

  return (
    <div className="cells grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ── controls ─────────────────────────────────────────────────────── */}
      <div className="cell p-6 sm:p-8">
        <div className="kicker">
          <b>Simulation</b> · illustrative units · no contract, no funds
        </div>
        <h2 className="display mt-3 text-3xl text-(--color-paper)">{seriesName}</h2>
        <p className="mt-3 text-sm leading-relaxed text-(--color-paper-dim)">
          One lot holds <span className="tabular text-(--color-paper)">{fmt(qb.A)}</span> units of {labels.A} and{' '}
          <span className="tabular text-(--color-paper)">{fmt(qb.B)}</span> units of {labels.B}. Cap:{' '}
          <span className="tabular text-(--color-paper)">{fmt(cap)}</span> lots of liability, reserved included.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-(--color-paper-faint)">These mock quantities demonstrate bookkeeping. They are not stock-token amounts, wrapper share amounts or a production lot definition.</p>

        <label className="mt-6 block">
          <span className="kicker">Lots</span>
          <input
            type="text"
            inputMode="numeric"
            value={lotsText}
            onChange={(e) => setLotsText(e.target.value)}
            className="tabular mt-2 w-full border border-(--color-rule) bg-(--color-ink) px-3 py-2 text-base text-(--color-paper) outline-none focus:border-(--color-accent)"
          />
        </label>
        {lots === null ? <p role="alert" className="mt-2 text-[12px] text-(--color-state-stale)">Enter a positive whole number using digits only.</p> : null}

        <div className="mt-4 border-t border-(--color-rule) pt-4">
          <div className="kicker">Preview · before anything is signed</div>
          <dl className="tabular mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 text-[12px]">
            <dt className="text-(--color-paper-faint)">Deposit A</dt>
            <dd className="text-right text-(--color-paper)">{lots === null ? '—' : `${fmt(lots * qb.A)} units`}</dd>
            <dt className="text-(--color-paper-faint)">Deposit B</dt>
            <dd className="text-right text-(--color-paper)">{lots === null ? '—' : `${fmt(lots * qb.B)} units`}</dd>
            <dt className="text-(--color-paper-faint)">Receipts</dt>
            <dd className="text-right text-(--color-paper)">{lots === null ? '—' : `${fmt(lots)} lot${lots === 1n ? '' : 's'}`}</dd>
            <dt className="text-(--color-paper-faint)">Indicative value</dt>
            <dd className="absent text-right" title="No dated price source is wired for these components. A missing price is never shown as zero.">
              not available
            </dd>
            <dt className="text-(--color-paper-faint)">Gas</dt>
            <dd className="absent text-right" title="A simulation sends no transaction.">
              not estimated
            </dd>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-(--color-paper-faint)">
            Both deposits and the receipt would be one atomic transaction. The receipt cannot be sent or sold; exit is by claim,
            one component at a time.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px border border-(--color-rule) bg-(--color-rule)">
          <Action onClick={() => lots !== null && apply(mint(state, YOU, lots))} disabled={lots === null}>
            Mint {lots === null ? '' : fmt(lots)} lots
          </Action>
          <Action onClick={() => lots !== null && apply(allocateExit(state, YOU, lots))} disabled={lots === null}>
            Allocate {lots === null ? '' : fmt(lots)} for exit
          </Action>
          <Action onClick={() => apply(claim(state, YOU, 'A'))}>Claim A</Action>
          <Action onClick={() => apply(claim(state, YOU, 'B'))}>Claim B</Action>
        </div>

        <div className="mt-5">
          <div className="kicker">The world, and the operator</div>
          <div className="mt-2 grid grid-cols-1 gap-px border border-(--color-rule) bg-(--color-rule) sm:grid-cols-2">
            {COMPONENTS.map((i) => (
              <Toggle
                key={`t-${i}`}
                on={!state.transferable[i]}
                onClick={() => toggle(`${state.transferable[i] ? 'The issuer halts' : 'The issuer resumes'} transfers of ${i}`, setTransferable(state, i, !state.transferable[i]))}
              >
                Issuer halts {i} transfers
              </Toggle>
            ))}
            <Toggle on={state.mintPaused} onClick={() => toggle(`The operator ${state.mintPaused ? 'resumes' : 'stops'} minting`, setMintPaused(state, !state.mintPaused))}>
              Operator stops minting
            </Toggle>
            {COMPONENTS.map((i) => (
              <Toggle
                key={`c-${i}`}
                on={state.claimPaused[i]}
                onClick={() => toggle(`The operator ${state.claimPaused[i] ? 'resumes' : 'stops'} claims of ${i}`, setClaimPaused(state, i, !state.claimPaused[i]))}
              >
                Operator stops {i} claims
              </Toggle>
            ))}
            <Action onClick={() => toggle('Someone sends 50 A straight to the contract', donate(state, 'A', 50n))}>Send 50 A to the contract</Action>
            <Action onClick={() => toggle('15 A leave the contract by a path that is not a claim', lose(state, 'A', 15n))}>Lose 15 A (a shortfall)</Action>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          <button type="button" onClick={replay} className="kicker underline decoration-(--color-accent) underline-offset-4 hover:text-(--color-paper)">
            Replay the worked example
          </button>
          <button type="button" onClick={reset} className="kicker hover:text-(--color-paper)">
            Reset
          </button>
        </div>
      </div>

      {/* ── the ledger ───────────────────────────────────────────────────── */}
      <div className="cell p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="kicker">The ledger · every figure in base units</div>
          <div className="kicker" style={{ color: invariants.holds ? 'var(--color-state-live)' : 'var(--color-state-dark)' }}>
            {invariants.holds ? 'every invariant holds' : 'an invariant is broken'}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto" role="region" aria-label="Simulation ledger, scroll horizontally if needed" tabIndex={0}>
          <table className="tabular w-full border-collapse text-[12px]">
            <thead>
              <tr className="kicker text-left">
                <th className="pb-2 pr-4 font-normal">Component</th>
                <th className="pb-2 pr-4 text-right font-normal">Active</th>
                <th className="pb-2 pr-4 text-right font-normal">Reserved</th>
                <th className="pb-2 pr-4 text-right font-normal">Owed</th>
                <th className="pb-2 pr-4 text-right font-normal">Held</th>
                <th className="pb-2 text-right font-normal">Surplus / short</th>
              </tr>
            </thead>
            <tbody>
              {COMPONENTS.map((i) => (
                <Row key={i} state={state} i={i} />
              ))}
            </tbody>
          </table>
        </div>

        <dl className="tabular mt-5 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-(--color-rule) pt-4 text-[12px] sm:grid-cols-4">
          <dt className="text-(--color-paper-faint)">Receipts outstanding</dt>
          <dd className="text-(--color-paper)">{fmt(state.n)}</dd>
          <dt className="text-(--color-paper-faint)">Your receipts</dt>
          <dd className="text-(--color-paper)">{fmt(receiptsOf(state, YOU))}</dd>
          <dt className="text-(--color-paper-faint)">Your claim on A</dt>
          <dd className="text-(--color-paper)">{fmt(yours.A)}</dd>
          <dt className="text-(--color-paper-faint)">Your claim on B</dt>
          <dd className="text-(--color-paper)">{fmt(yours.B)}</dd>
        </dl>

        <div className="mt-5 border-t border-(--color-rule) pt-4">
          <div className="kicker">Invariants</div>
          <ul className="tabular mt-2 space-y-1 text-[11px]">
            {invariants.lines.map((l) => (
              <li key={l.name} className="flex items-baseline gap-2">
                <span style={{ color: l.holds ? 'var(--color-state-live)' : 'var(--color-state-dark)' }}>{l.holds ? '●' : '●'}</span>
                <span className="text-(--color-paper)">{l.name}</span>
                <span className="text-(--color-paper-faint)">— {l.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 border-t border-(--color-rule) pt-4">
          <div className="kicker">What happened</div>
          {log.length === 0 ? (
            <p className="mt-2 text-[12px] text-(--color-paper-faint)">Nothing yet. Mint some lots, or replay the worked example.</p>
          ) : (
            <ol className="tabular mt-2 space-y-1 text-[11px]">
              {log.map((entry, i) => (
                <li key={`${log.length - i}-${entry.text}`} className="flex items-baseline gap-2">
                  <span style={{ color: entry.ok ? 'var(--color-paper-faint)' : 'var(--color-state-stale)' }}>{entry.ok ? '·' : '×'}</span>
                  <span className={entry.ok ? 'text-(--color-paper-dim)' : 'text-(--color-paper)'}>{entry.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="mt-5 border-t border-(--color-rule) pt-4">
          <div className="kicker">What this does not show</div>
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-(--color-paper-faint)">
            <li>— No price, no value, no gas: the ledger counts units and nothing else.</li>
            <li>— No wallet, no eligibility, no issuer contract: a halt here is a switch, not a reason.</li>
            <li>— No reorg, no reentrancy, no chain: those require contract and chain tests, beyond this model.</li>
            <li>— The same functions run in the repository’s tests; the worked example is reproduced there row by row.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ state, i }: { state: LedgerState; i: ComponentId }) {
  const over = surplus(state, i);
  const short = shortfall(state, i);
  const flags = [
    state.transferable[i] ? null : 'halted',
    state.claimPaused[i] ? 'claims stopped' : null,
  ].filter((f): f is string => f !== null);
  return (
    <tr className="border-t border-(--color-rule)">
      <td className="py-2 pr-4 align-baseline text-(--color-paper)">
        {i}
        {flags.length > 0 ? <span className="ml-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-state-stale)' }}>{flags.join(' · ')}</span> : null}
      </td>
      <td className="py-2 pr-4 text-right align-baseline text-(--color-paper-dim)">{fmt(active(state, i))}</td>
      <td className="py-2 pr-4 text-right align-baseline text-(--color-paper-dim)">{fmt(state.reserved[i])}</td>
      <td className="py-2 pr-4 text-right align-baseline text-(--color-paper)">{fmt(liability(state, i))}</td>
      <td className="py-2 pr-4 text-right align-baseline text-(--color-paper)">{fmt(state.balances[i])}</td>
      <td className="py-2 text-right align-baseline">
        {short > 0n ? (
          <span style={{ color: 'var(--color-state-dark)' }}>−{fmt(short)}</span>
        ) : over > 0n ? (
          <span className="text-(--color-paper-faint)">+{fmt(over)}</span>
        ) : (
          <span className="text-(--color-paper-faint)">0</span>
        )}
      </td>
    </tr>
  );
}

function Action({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cell px-3 py-3 text-left text-[13px] text-(--color-paper) hover:bg-(--color-ink-3) disabled:cursor-not-allowed disabled:text-(--color-paper-faint)"
    >
      {children}
    </button>
  );
}

function Toggle({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="cell flex items-center justify-between gap-3 px-3 py-3 text-left text-[13px] text-(--color-paper) hover:bg-(--color-ink-3)"
    >
      <span>{children}</span>
      <span className="tabular text-[10px] uppercase tracking-[0.14em]" style={{ color: on ? 'var(--color-state-stale)' : 'var(--color-paper-faint)' }}>
        {on ? 'on' : 'off'}
      </span>
    </button>
  );
}
