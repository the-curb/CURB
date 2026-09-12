/**
 * The events a series contract would emit, as the mechanism proposes them,
 * and how each is read back from a log.
 *
 * The topic of each event is computed from its signature, never pinned:
 * a guessed topic matches nothing and looks exactly like a quiet contract.
 * A log whose data does not decode is returned as a fault with the reason,
 * not skipped, because a skipped event is a ledger that silently disagrees
 * with the chain.
 */

import { decodeAddressWord, decodeUint, words } from '../chain/abi.ts';
import { keccak256Hex } from '../chain/keccak.ts';
import type { LogEntry } from '../chain/rpc.ts';
import type { ComponentId } from './ledger.ts';

export const EVENT_SIGNATURES = {
  PositionMinted: 'PositionMinted(address,uint256,uint256,uint256)',
  ExitAllocated: 'ExitAllocated(address,uint256,uint256,uint256)',
  ComponentClaimed: 'ComponentClaimed(address,uint8,uint256)',
  MintStatusChanged: 'MintStatusChanged(bool,string)',
  ComponentClaimStatusChanged: 'ComponentClaimStatusChanged(uint8,bool,string)',
  /** The operator's own actions — the audit trail the policy asks for, read from the chain rather than from a log kept by hand. */
  MintPermitSet: 'MintPermitSet(address,uint64)',
  ClaimPermitSet: 'ClaimPermitSet(address,bool)',
  OperatorChanged: 'OperatorChanged(address,address)',
} as const;

export type EventName = keyof typeof EVENT_SIGNATURES;

export const EVENT_TOPICS: Readonly<Record<EventName, string>> = Object.fromEntries(
  Object.entries(EVENT_SIGNATURES).map(([name, signature]) => [name, keccak256Hex(signature)]),
) as Record<EventName, string>;

export const ALL_TOPICS: readonly string[] = Object.values(EVENT_TOPICS);

export type SeriesEvent =
  | { readonly name: 'PositionMinted'; readonly holder: string; readonly lots: bigint; readonly unitsA: bigint; readonly unitsB: bigint }
  | { readonly name: 'ExitAllocated'; readonly holder: string; readonly lots: bigint; readonly unitsA: bigint; readonly unitsB: bigint }
  | { readonly name: 'ComponentClaimed'; readonly holder: string; readonly component: ComponentId; readonly units: bigint }
  | { readonly name: 'MintStatusChanged'; readonly paused: boolean; readonly reason: string }
  | { readonly name: 'ComponentClaimStatusChanged'; readonly component: ComponentId; readonly paused: boolean; readonly reason: string }
  /** A mint permit set for a holder, until a unix time; zero revokes it. */
  | { readonly name: 'MintPermitSet'; readonly holder: string; readonly until: bigint }
  | { readonly name: 'ClaimPermitSet'; readonly holder: string; readonly permitted: boolean }
  | { readonly name: 'OperatorChanged'; readonly previous: string; readonly next: string };

export interface IndexedEvent {
  readonly chainId: number;
  readonly series: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly event: SeriesEvent;
}

export type DecodeResult = { readonly ok: true; readonly event: SeriesEvent } | { readonly ok: false; readonly detail: string } | { readonly ok: 'IGNORED' };

function componentOf(word: string): ComponentId | null {
  const n = decodeUint(word);
  return n === 0n ? 'A' : n === 1n ? 'B' : null;
}

/** A dynamic string at `offsetWordIndex` within the data words. */
function stringAt(data: string, headWords: readonly string[], offsetWordIndex: number): string | null {
  const offset = decodeUint(headWords[offsetWordIndex] ?? '');
  if (offset === null) return null;
  const body = data.startsWith('0x') ? data.slice(2) : data;
  const start = Number(offset) * 2;
  if (body.length < start + 64) return null;
  const length = Number(decodeUint(`0x${body.slice(start, start + 64)}`) ?? -1n);
  if (length < 0 || body.length < start + 64 + length * 2) return null;
  const hex = body.slice(start + 64, start + 64 + length * 2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeSeriesEvent(log: Pick<LogEntry, 'topics' | 'data'>): DecodeResult {
  const topic0 = (log.topics[0] ?? '').toLowerCase();
  const w = words(log.data);
  const uint = (i: number) => decodeUint(w[i] ?? '');

  switch (topic0) {
    case EVENT_TOPICS.PositionMinted:
    case EVENT_TOPICS.ExitAllocated: {
      const holder = log.topics[1] ? decodeAddressWord(log.topics[1]) : null;
      const lots = uint(0);
      const unitsA = uint(1);
      const unitsB = uint(2);
      if (holder === null || lots === null || unitsA === null || unitsB === null) return { ok: false, detail: 'holder, lots, unitsA or unitsB undecodable' };
      const name = topic0 === EVENT_TOPICS.PositionMinted ? 'PositionMinted' : 'ExitAllocated';
      return { ok: true, event: { name, holder: holder.toLowerCase(), lots, unitsA, unitsB } };
    }
    case EVENT_TOPICS.ComponentClaimed: {
      const holder = log.topics[1] ? decodeAddressWord(log.topics[1]) : null;
      const component = w[0] ? componentOf(w[0]) : null;
      const units = uint(1);
      if (holder === null || component === null || units === null) return { ok: false, detail: 'holder, component or units undecodable' };
      return { ok: true, event: { name: 'ComponentClaimed', holder: holder.toLowerCase(), component, units } };
    }
    case EVENT_TOPICS.MintStatusChanged: {
      const paused = uint(0);
      const reason = stringAt(log.data, w, 1);
      if (paused === null || reason === null) return { ok: false, detail: 'paused or reason undecodable' };
      return { ok: true, event: { name: 'MintStatusChanged', paused: paused !== 0n, reason } };
    }
    case EVENT_TOPICS.ComponentClaimStatusChanged: {
      const component = w[0] ? componentOf(w[0]) : null;
      const paused = uint(1);
      const reason = stringAt(log.data, w, 2);
      if (component === null || paused === null || reason === null) return { ok: false, detail: 'component, paused or reason undecodable' };
      return { ok: true, event: { name: 'ComponentClaimStatusChanged', component, paused: paused !== 0n, reason } };
    }
    case EVENT_TOPICS.MintPermitSet: {
      const holder = log.topics[1] ? decodeAddressWord(log.topics[1]) : null;
      const until = uint(0);
      if (holder === null || until === null) return { ok: false, detail: 'holder or until undecodable' };
      return { ok: true, event: { name: 'MintPermitSet', holder: holder.toLowerCase(), until } };
    }
    case EVENT_TOPICS.ClaimPermitSet: {
      const holder = log.topics[1] ? decodeAddressWord(log.topics[1]) : null;
      const permitted = uint(0);
      if (holder === null || permitted === null) return { ok: false, detail: 'holder or permitted undecodable' };
      return { ok: true, event: { name: 'ClaimPermitSet', holder: holder.toLowerCase(), permitted: permitted !== 0n } };
    }
    case EVENT_TOPICS.OperatorChanged: {
      const previous = log.topics[1] ? decodeAddressWord(log.topics[1]) : null;
      const next = log.topics[2] ? decodeAddressWord(log.topics[2]) : null;
      if (previous === null || next === null) return { ok: false, detail: 'previous or next undecodable' };
      return { ok: true, event: { name: 'OperatorChanged', previous: previous.toLowerCase(), next: next.toLowerCase() } };
    }
    default:
      return { ok: 'IGNORED' };
  }
}

/* ── encoding, for tests and fixtures ─────────────────────────────────────── */

const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;
const addressWord = (address: string) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

/** The dynamic tail of a string argument: its offset word, its length word, its bytes padded to 32. */
function stringTail(text: string, headWords: number): string {
  const bytes = Buffer.from(text, 'utf8');
  const padded = bytes.toString('hex').padEnd(Math.ceil(bytes.length / 32) * 64, '0');
  return `${word(BigInt(headWords * 32)).slice(2)}${word(BigInt(bytes.length)).slice(2)}${padded}`;
}

/** The log a series contract would emit for an event — the inverse of the decoder. */
export function encodeSeriesEvent(event: SeriesEvent): { topics: string[]; data: string } {
  switch (event.name) {
    case 'PositionMinted':
    case 'ExitAllocated':
      return { topics: [EVENT_TOPICS[event.name], addressWord(event.holder)], data: `0x${[word(event.lots), word(event.unitsA), word(event.unitsB)].map((x) => x.slice(2)).join('')}` };
    case 'ComponentClaimed':
      return { topics: [EVENT_TOPICS.ComponentClaimed, addressWord(event.holder)], data: `0x${[word(event.component === 'A' ? 0n : 1n), word(event.units)].map((x) => x.slice(2)).join('')}` };
    case 'MintStatusChanged':
      // head: paused, offset; tail: length, bytes
      return { topics: [EVENT_TOPICS.MintStatusChanged], data: `0x${word(event.paused ? 1n : 0n).slice(2)}${stringTail(event.reason, 2)}` };
    case 'ComponentClaimStatusChanged':
      // head: component, paused, offset; tail: length, bytes
      return {
        topics: [EVENT_TOPICS.ComponentClaimStatusChanged],
        data: `0x${word(event.component === 'A' ? 0n : 1n).slice(2)}${word(event.paused ? 1n : 0n).slice(2)}${stringTail(event.reason, 3)}`,
      };
    case 'MintPermitSet':
      return { topics: [EVENT_TOPICS.MintPermitSet, addressWord(event.holder)], data: word(event.until) };
    case 'ClaimPermitSet':
      return { topics: [EVENT_TOPICS.ClaimPermitSet, addressWord(event.holder)], data: word(event.permitted ? 1n : 0n) };
    case 'OperatorChanged':
      return { topics: [EVENT_TOPICS.OperatorChanged, addressWord(event.previous), addressWord(event.next)], data: '0x' };
  }
}
