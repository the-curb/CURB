/**
 * Just enough ABI to read a token and a price feed, with no dependency.
 *
 * Selectors are **computed** from their signatures via `keccak.ts`, not pinned
 * from memory. That matters less for `decimals()`, which everyone knows, than
 * for `uiMultiplier()`, which nobody does — and a guessed selector does not
 * throw. It calls something else or reverts, and the caller cannot tell that
 * apart from a contract that lacks the feature.
 *
 * The signature string is the source of truth; change it and the selector
 * follows. `tests/keccak.test.ts` pins the hash function against published
 * vectors so this whole table stays honest.
 */

import { selector } from './keccak.ts';

export const SIGNATURES = {
  name: 'name()',
  symbol: 'symbol()',
  decimals: 'decimals()',
  totalSupply: 'totalSupply()',
  paused: 'paused()',
  owner: 'owner()',
  // Chainlink AggregatorV3Interface
  latestRoundData: 'latestRoundData()',
  description: 'description()',
  // Robinhood stock-token specifics
  oraclePaused: 'oraclePaused()',
  uiMultiplier: 'uiMultiplier()',
  newUIMultiplier: 'newUIMultiplier()',
  effectiveAt: 'effectiveAt()',
} as const;

export const SELECTORS: Readonly<Record<keyof typeof SIGNATURES, string>> = Object.fromEntries(
  Object.entries(SIGNATURES).map(([key, signature]) => [key, selector(signature)]),
) as Record<keyof typeof SIGNATURES, string>;

export type SelectorName = keyof typeof SELECTORS;

/** EIP-1967 storage slots. Each is keccak256(label) - 1, per the standard. */
export const EIP1967_SLOTS = {
  /** bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1) */
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  /** bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1) */
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  /** bytes32(uint256(keccak256('eip1967.proxy.beacon')) - 1) */
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
} as const;

const ZERO_WORD = `0x${'0'.repeat(64)}`;

function strip(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

export function isEmptyWord(hex: string): boolean {
  return hex === ZERO_WORD || /^0x0*$/.test(hex);
}

/** A 32-byte word holding a right-aligned address, as EIP-1967 slots do. */
export function decodeAddressWord(hex: string): string | null {
  const body = strip(hex);
  if (body.length !== 64) return null;
  const address = body.slice(24);
  if (/^0+$/.test(address)) return null;
  return `0x${address}`;
}

/**
 * A signed 256-bit word. Chainlink's `answer` is `int256`, and a negative price
 * is a real thing the vendor guidance tells integrators to reject — which we can
 * only do if we decode the sign instead of reading it as an enormous positive.
 */
export function decodeInt(hex: string): bigint | null {
  const unsigned = decodeUint(hex);
  if (unsigned === null) return null;
  const limit = 1n << 255n;
  return unsigned >= limit ? unsigned - (1n << 256n) : unsigned;
}

/** Split a static return into 32-byte words. */
export function words(hex: string): string[] {
  const body = strip(hex);
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(`0x${body.slice(i, i + 64)}`);
  return out;
}

export function decodeUint(hex: string): bigint | null {
  const body = strip(hex);
  if (body.length === 0 || !/^[0-9a-fA-F]+$/.test(body)) return null;
  try {
    return BigInt(`0x${body}`);
  } catch {
    return null;
  }
}

/**
 * ABI-decode a returned string. Handles both the dynamic `string` encoding and
 * the older `bytes32` form some long-lived tokens still use.
 */
export function decodeString(hex: string): string | null {
  const body = strip(hex);
  if (body.length === 0) return null;

  // bytes32: a single word, NUL-padded on the right.
  if (body.length === 64) {
    const bytes = body.replace(/(00)+$/, '');
    if (bytes.length === 0) return null;
    const text = hexToUtf8(bytes);
    return text === null || text.trim() === '' ? null : text;
  }

  // Dynamic: offset word, length word, then the data.
  if (body.length < 128) return null;
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const lengthStart = offset * 2;
  if (Number.isNaN(offset) || body.length < lengthStart + 64) return null;

  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthStart + 64)}`));
  const dataStart = lengthStart + 64;
  if (Number.isNaN(length) || body.length < dataStart + length * 2) return null;

  return hexToUtf8(body.slice(dataStart, dataStart + length * 2));
}

function hexToUtf8(hex: string): string | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Format a raw integer amount against its decimals, without floating point. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}
