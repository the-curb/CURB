/** Read-only wallet review. A missing allowance, price or estimate is never zero. */
import { selector } from '../chain/keccak.ts';
import type { PreparedCall } from './calldata.ts';
import { assertWalletIdentity, checkWalletTransaction, type PendingWalletTransaction, type WalletIdentity, type WalletProvider } from './wallet.ts';

const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v);
const quantity = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v);
const fault = (e: unknown) => e instanceof Error ? e.message : 'the wallet did not return this reading';
const word = (a: string) => a.slice(2).padStart(64, '0');

export function displayTokenUnits(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('invalid token units');
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value / scale}${fraction ? `.${fraction}` : ''}`;
}

export type ComponentReview =
  | { state: 'READ'; address: string; decimals: number; allowance: string; amount: string | null; enoughAllowance: boolean | null }
  | { state: 'UNREAD'; address: string; reason: string };
export interface WalletReview {
  account: string;
  chainId: number;
  block: string;
  readAt: string;
  components: { A: ComponentReview; B: ComponentReview };
  gas: { to: string; units: string | null; reason: string | null }[];
}

export async function readWalletReview(provider: WalletProvider, expected: WalletIdentity, series: string, components: { A: string; B: string }, amounts: { A: string; B: string } | undefined, calls: readonly PreparedCall[]): Promise<WalletReview> {
  if (![series, components.A, components.B, expected.account].every(address)) throw new Error('invalid review address');
  await assertWalletIdentity(provider, expected);
  const block = await provider.request({ method: 'eth_blockNumber' });
  if (!quantity(block)) throw new Error('the wallet did not return a review block');
  const uintCall = async (to: string, data: string) => {
    const result = await provider.request({ method: 'eth_call', params: [{ to, data }, block] });
    if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(result)) throw new Error('incomplete token response');
    return BigInt(result);
  };
  const readComponent = async (id: 'A' | 'B'): Promise<ComponentReview> => {
    try {
      const [decimals, allowance] = await Promise.all([
        uintCall(components[id], selector('decimals()')),
        uintCall(components[id], `${selector('allowance(address,address)')}${word(expected.account)}${word(series)}`),
      ]);
      if (decimals > 255n) throw new Error('token decimals exceed uint8');
      const amount = amounts?.[id];
      if (amount !== undefined && !/^\d+$/.test(amount)) throw new Error('invalid prepared amount');
      return { state: 'READ', address: components[id], decimals: Number(decimals), allowance: displayTokenUnits(allowance.toString(), Number(decimals)), amount: amount === undefined ? null : displayTokenUnits(amount, Number(decimals)), enoughAllowance: amount === undefined ? null : allowance >= BigInt(amount) };
    } catch (e) { return { state: 'UNREAD', address: components[id], reason: fault(e) }; }
  };
  const [A, B, gas] = await Promise.all([
    readComponent('A'), readComponent('B'),
    Promise.all(calls.map(async (call) => {
      try {
        const result = await provider.request({ method: 'eth_estimateGas', params: [{ from: expected.account, to: call.to, data: call.data }, block] });
        if (!quantity(result) || BigInt(result) <= 0n) throw new Error('no valid gas estimate');
        return { to: call.to, units: BigInt(result).toString(), reason: null };
      } catch (e) { return { to: call.to, units: null, reason: fault(e) }; }
    })),
  ]);
  await assertWalletIdentity(provider, expected);
  return { account: expected.account, chainId: expected.chainId, block: BigInt(block).toString(), readAt: new Date().toISOString(), components: { A, B }, gas };
}

/** A user-supplied replacement hash is accepted only with chain evidence of the same sender and nonce. */
export async function checkWalletReplacement(provider: WalletProvider, pending: PendingWalletTransaction, replacementHash: string): Promise<{ state: 'MINED' | 'REVERTED' | 'CANCELLED' | 'REPLACED'; block: string; hash: string } | null> {
  if (!hash(pending.hash) || !hash(replacementHash) || replacementHash.toLowerCase() === pending.hash.toLowerCase()) throw new Error('provide a different complete replacement transaction hash');
  const chain = await provider.request({ method: 'eth_chainId' });
  if (!quantity(chain) || BigInt(chain) !== BigInt(pending.chainId)) throw new Error(`switch to chain ${pending.chainId} to verify the replacement`);
  type Tx = { hash?: unknown; from?: unknown; to?: unknown; nonce?: unknown; input?: unknown; value?: unknown };
  const [original, replacement] = await Promise.all([pending.hash, replacementHash].map(async (txHash) => provider.request({ method: 'eth_getTransactionByHash', params: [txHash] }) as Promise<Tx | null>));
  if (!original || !replacement || !hash(original.hash) || !hash(replacement.hash) || original.hash.toLowerCase() !== pending.hash.toLowerCase() || replacement.hash.toLowerCase() !== replacementHash.toLowerCase() || !address(original.from) || !address(replacement.from) || original.from.toLowerCase() !== pending.account.toLowerCase() || replacement.from.toLowerCase() !== pending.account.toLowerCase() || !quantity(original.nonce) || !quantity(replacement.nonce) || BigInt(original.nonce) !== BigInt(replacement.nonce)) throw new Error('the node cannot prove this is a replacement from the same wallet and nonce; the original remains unresolved');
  const receipt = await checkWalletTransaction(provider, { ...pending, hash: replacementHash });
  if (receipt === null) return null;
  if (receipt.state === 'REVERTED') return { ...receipt, hash: replacementHash };
  if (!address(original.to) || !address(replacement.to) || typeof original.input !== 'string' || typeof replacement.input !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(original.input) || !/^0x(?:[0-9a-f]{2})*$/i.test(replacement.input) || !quantity(original.value) || !quantity(replacement.value)) throw new Error('incomplete transaction bytes; the replacement outcome cannot be classified');
  const sameAction = original.to.toLowerCase() === replacement.to.toLowerCase() && original.input.toLowerCase() === replacement.input.toLowerCase() && BigInt(original.value) === BigInt(replacement.value);
  const cancellation = replacement.to.toLowerCase() === pending.account.toLowerCase() && replacement.input === '0x' && BigInt(replacement.value) === 0n;
  return { state: sameAction ? 'MINED' : cancellation ? 'CANCELLED' : 'REPLACED', block: receipt.block, hash: replacementHash };
}
