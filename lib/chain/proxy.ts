/**
 * What stands behind an address: the EIP-1967 slots.
 *
 * A proxy's own code never changes when its implementation does, so a code
 * hash alone would sleep through an upgrade. The implementation, admin and
 * beacon slots are read directly from storage — no function is called and
 * no interface is assumed — and an address whose slots are all empty is
 * recorded as having no EIP-1967 proxy, which is not the same as having no
 * proxy at all, and the record says so.
 */

import type { Reading } from '../doctrine/reading.ts';
import { rpcCall, type RpcOptions } from './rpc.ts';

/** keccak256("eip1967.proxy.implementation") − 1, and the admin and beacon slots beside it. */
export const EIP1967_SLOTS = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
} as const;

export type ProxyKind = 'EIP1967' | 'BEACON' | 'NONE';

export interface ProxySlots {
  readonly state: 'VERIFIED' | 'UNREAD';
  /** EIP1967 when the implementation slot is set, BEACON when only the beacon slot is, NONE when all three are empty. */
  readonly kind: ProxyKind | null;
  readonly implementation: string | null;
  readonly admin: string | null;
  readonly beacon: string | null;
  readonly reason: string | null;
  readonly source: string | null;
}

const ZERO_WORD = /^0x0{64}$/;

/** The address in a storage word, or null when the word is empty or not a word. */
export function addressInWord(word: string): string | null | undefined {
  if (!/^0x[0-9a-fA-F]{64}$/.test(word)) return undefined;
  if (ZERO_WORD.test(word)) return null;
  return `0x${word.slice(-40).toLowerCase()}`;
}

export async function readProxySlots(address: string, opts: RpcOptions): Promise<ProxySlots> {
  const reads = await Promise.all(
    (['implementation', 'admin', 'beacon'] as const).map((slot) => rpcCall<string>('eth_getStorageAt', [address, EIP1967_SLOTS[slot], 'latest'], opts)),
  );
  const unread = reads.find((r): r is Reading<string> & { state: 'UNREAD' } => r.state === 'UNREAD');
  if (unread) {
    return { state: 'UNREAD', kind: null, implementation: null, admin: null, beacon: null, reason: `${unread.reason}${unread.detail ? ` — ${unread.detail}` : ''}`, source: unread.source };
  }
  const words = reads.map((r) => (r.state === 'UNREAD' ? '' : r.value)).map(addressInWord);
  if (words.some((w) => w === undefined)) {
    return { state: 'UNREAD', kind: null, implementation: null, admin: null, beacon: null, reason: 'a storage word came back that is not 32 bytes', source: reads[0]!.state === 'UNREAD' ? null : reads[0]!.source };
  }
  const [implementation, admin, beacon] = words as (string | null)[];
  const kind: ProxyKind = implementation ? 'EIP1967' : beacon ? 'BEACON' : 'NONE';
  return { state: 'VERIFIED', kind, implementation: implementation ?? null, admin: admin ?? null, beacon: beacon ?? null, reason: null, source: reads[0]!.state === 'UNREAD' ? null : reads[0]!.source };
}
