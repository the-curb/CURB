/**
 * Uniswap v4, as far as a price reader needs it.
 *
 * A v4 pool has no address. Every pool lives inside one PoolManager, and is
 * named by its key — the two currencies (sorted, the lower first; native ETH
 * is address zero and so always first), the LP fee, the tick spacing and the
 * hook — hashed: `poolId = keccak256(abi.encode(key))`, five 32-byte words.
 * The PoolManager emits every pool's events with the id as the first indexed
 * topic, and keeps no key on chain: the reader carries the key in the record
 * and recomputes the id from it, so a mistyped key cannot name another pool
 * by accident. State is read through the StateView lens (`getSlot0`,
 * `getLiquidity` by id), which only forwards to the PoolManager's storage.
 *
 * Verified against the chain decided (Robinhood Chain, 4663) on 16–17
 * September 2026 — the deployments, the event layouts and two live pool ids
 * recomputed from their keys (docs/mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md).
 */

import { keccak256, keccak256Hex, selector, toHex } from './keccak.ts';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface V4PoolKey {
  readonly currency0: string;
  readonly currency1: string;
  /** The LP fee in hundredths of a basis point; 0x800000 marks a dynamic fee. */
  readonly fee: number;
  readonly tickSpacing: number;
  /** The hook, or the zero address for none. */
  readonly hooks: string;
}

export const V4_TOPICS = {
  /** Every swap in every pool, from the PoolManager: id and sender indexed; data amount0, amount1, sqrtPriceX96, liquidity, tick, fee. */
  swap: keccak256Hex('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
  /** Once per pool, when it is given its first price: id, currency0, currency1 indexed; data fee, tickSpacing, hooks, sqrtPriceX96, tick. */
  initialize: keccak256Hex('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
  /** Liquidity added (positive delta) or removed (negative): id and sender indexed; data tickLower, tickUpper, liquidityDelta, salt. */
  modifyLiquidity: keccak256Hex('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)'),
} as const;

export const V4_SELECTORS = {
  getSlot0: selector('getSlot0(bytes32)'),
  getLiquidity: selector('getLiquidity(bytes32)'),
  poolManager: selector('poolManager()'),
} as const;

const strip = (hex: string) => hex.replace(/^0x/, '').toLowerCase();

function addressWord(address: string): string {
  return strip(address).padStart(64, '0');
}

function uintWord(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/** A signed value as a 32-byte two's-complement word, as the ABI encodes an int24. */
function intWord(value: number): string {
  const v = BigInt(value);
  return uintWord(v < 0n ? (1n << 256n) + v : v);
}

/** `abi.encode(currency0, currency1, fee, tickSpacing, hooks)` — the five words the PoolManager hashes. */
export function encodePoolKey(key: V4PoolKey): string {
  return `0x${addressWord(key.currency0)}${addressWord(key.currency1)}${uintWord(BigInt(key.fee))}${intWord(key.tickSpacing)}${addressWord(key.hooks)}`;
}

function bytesOf(hex: string): Uint8Array {
  const body = strip(hex);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The pool's id: keccak256 of the encoded key, as 32-byte hex, lower case. */
export function poolIdOf(key: V4PoolKey): string {
  return toHex(keccak256(bytesOf(encodePoolKey(key))));
}

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

/**
 * A key as a record may state it, checked: both currencies addresses (the
 * zero address is native ETH and is allowed), sorted with the lower first,
 * distinct; the fee within the manager's range; the tick spacing within
 * int24 and positive; the hook an address. Returns the reason otherwise.
 */
export function validatePoolKey(raw: unknown): { readonly key: V4PoolKey } | { readonly error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'key must be an object' };
  const k = raw as Record<string, unknown>;
  if (!isAddress(k.currency0) || !isAddress(k.currency1)) return { error: 'key.currency0 and key.currency1 must be 20-byte hex addresses (the zero address for native ETH)' };
  const c0 = k.currency0.toLowerCase();
  const c1 = k.currency1.toLowerCase();
  if (c0 === c1) return { error: 'key.currency0 and key.currency1 are the same' };
  if (BigInt(c0) >= BigInt(c1)) return { error: 'key.currency0 must be numerically lower than key.currency1 — the manager sorts them and a key in the other order names no pool' };
  if (!Number.isInteger(k.fee) || (k.fee as number) < 0 || (k.fee as number) > 0x800000) return { error: 'key.fee must be an integer from 0 to 8388608' };
  if (!Number.isInteger(k.tickSpacing) || (k.tickSpacing as number) <= 0 || (k.tickSpacing as number) > 32767) return { error: 'key.tickSpacing must be a positive integer no larger than 32767' };
  if (!isAddress(k.hooks)) return { error: 'key.hooks must be a 20-byte hex address (the zero address for no hook)' };
  return { key: { currency0: c0, currency1: c1, fee: k.fee as number, tickSpacing: k.tickSpacing as number, hooks: k.hooks.toLowerCase() } };
}

/** A currency word from a v4 event or key: an address, with the zero word meaning native ETH rather than "absent". */
export function decodeCurrencyWord(hex: string): string | null {
  const body = strip(hex);
  if (body.length !== 64 || !/^[0-9a-f]+$/.test(body) || !/^0{24}/.test(body)) return null;
  return `0x${body.slice(24)}`;
}

export const isNativeCurrency = (address: string): boolean => address.toLowerCase() === ZERO_ADDRESS;

/**
 * The hook's permissions are the lowest fourteen bits of its address (v4-core
 * Hooks.sol). The ones that could move a price a reader sees: a before-swap
 * hook may override the fee or return a delta; an after-swap hook that
 * returns a delta takes from the swap's output but cannot move the pool's
 * own sqrtPrice or liquidity. Recorded so a page can say what the hook may do.
 */
export function hookPermissions(hooks: string): { readonly beforeSwap: boolean; readonly afterSwap: boolean; readonly beforeSwapReturnsDelta: boolean; readonly afterSwapReturnsDelta: boolean; readonly beforeInitialize: boolean } {
  const bits = Number(BigInt(hooks.toLowerCase()) & 0x3fffn);
  return {
    beforeInitialize: (bits & (1 << 13)) !== 0,
    beforeSwap: (bits & (1 << 7)) !== 0,
    afterSwap: (bits & (1 << 6)) !== 0,
    beforeSwapReturnsDelta: (bits & (1 << 3)) !== 0,
    afterSwapReturnsDelta: (bits & (1 << 2)) !== 0,
  };
}
