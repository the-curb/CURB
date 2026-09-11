/**
 * Reads against a token contract, each one returned as a Reading.
 *
 * The distinction this file exists to hold: a call that reverts has not told you
 * "no". `paused()` reverting means the contract does not expose that function —
 * it does not mean the token is unpaused, and rendering it as `false` would be
 * exactly the lie the three-state doctrine is built to prevent. A revert becomes
 * UNREAD with a reason.
 */

import { rpcCall, type RpcOptions } from './rpc.ts';
import {
  decodeAddressWord,
  decodeString,
  decodeUint,
  EIP1967_SLOTS,
  SELECTORS,
  type SelectorName,
} from './abi.ts';
import { unread, type Reading } from '../doctrine/reading.ts';

/** An `eth_call` that returns no data is a revert or an unimplemented function. */
async function callRaw(
  address: string,
  selector: string,
  label: string,
  opts: RpcOptions,
): Promise<Reading<string>> {
  const result = await rpcCall<string>(
    'eth_call',
    [{ to: address, data: selector }, 'latest'],
    opts,
  );
  if (result.state === 'UNREAD') return result;
  if (result.value === '0x' || result.value === '') {
    return unread('FIELD_ABSENT', {
      source: result.source,
      detail: `${label} returned no data — the function reverted or is not implemented. This is not a "no".`,
    });
  }
  return result;
}

export async function readTokenUint(
  address: string,
  fn: Extract<SelectorName, 'decimals' | 'totalSupply'>,
  opts: RpcOptions,
): Promise<Reading<bigint>> {
  const raw = await callRaw(address, SELECTORS[fn], `${fn}()`, opts);
  if (raw.state === 'UNREAD') return raw;
  const value = decodeUint(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: `${fn}() undecodable` });
  }
  return { ...raw, value };
}

export async function readTokenString(
  address: string,
  fn: Extract<SelectorName, 'name' | 'symbol'>,
  opts: RpcOptions,
): Promise<Reading<string>> {
  const raw = await callRaw(address, SELECTORS[fn], `${fn}()`, opts);
  if (raw.state === 'UNREAD') return raw;
  const value = decodeString(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: `${fn}() undecodable` });
  }
  return { ...raw, value };
}

/**
 * `paused()` is tri-state on purpose: true, false, or "the contract does not
 * answer that question". The third is not the second.
 */
export async function readPaused(address: string, opts: RpcOptions): Promise<Reading<boolean>> {
  const raw = await callRaw(address, SELECTORS.paused, 'paused()', opts);
  if (raw.state === 'UNREAD') return raw;
  const value = decodeUint(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'paused() undecodable' });
  }
  return { ...raw, value: value !== 0n };
}

export async function readOwner(address: string, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await callRaw(address, SELECTORS.owner, 'owner()', opts);
  if (raw.state === 'UNREAD') return raw;
  const value = decodeAddressWord(raw.value);
  if (value === null) {
    return unread('FIELD_ABSENT', { source: raw.source, detail: 'owner() returned the zero address' });
  }
  return { ...raw, value };
}

async function readSlot(
  address: string,
  slot: string,
  opts: RpcOptions,
): Promise<Reading<string>> {
  return rpcCall<string>('eth_getStorageAt', [address, slot, 'latest'], opts);
}

export interface ProxyState {
  /** Null means the slot is empty: not an EIP-1967 proxy, or not this pattern. */
  readonly implementation: string | null;
  readonly admin: string | null;
  readonly beacon: string | null;
  /**
   * Transparent proxies set the admin slot; UUPS leaves it empty because the
   * upgrade entry point lives in the implementation instead.
   */
  readonly pattern: 'transparent' | 'uups' | 'not-eip1967';
}

export async function readProxyState(
  address: string,
  opts: RpcOptions,
): Promise<Reading<ProxyState>> {
  const [implSlot, adminSlot, beaconSlot] = await Promise.all([
    readSlot(address, EIP1967_SLOTS.implementation, opts),
    readSlot(address, EIP1967_SLOTS.admin, opts),
    readSlot(address, EIP1967_SLOTS.beacon, opts),
  ]);

  // The implementation slot is the one that decides whether this is a proxy at
  // all; if we could not read it, we do not get to guess the pattern.
  if (implSlot.state === 'UNREAD') return implSlot;

  const implementation = decodeAddressWord(implSlot.value);
  const admin = adminSlot.state === 'UNREAD' ? null : decodeAddressWord(adminSlot.value);
  const beacon = beaconSlot.state === 'UNREAD' ? null : decodeAddressWord(beaconSlot.value);

  const pattern: ProxyState['pattern'] =
    implementation === null ? 'not-eip1967' : admin === null ? 'uups' : 'transparent';

  return { ...implSlot, value: { implementation, admin, beacon, pattern } };
}
