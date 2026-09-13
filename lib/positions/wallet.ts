/** Browser-safe wallet operations. A prepared action never implies a wallet is still on the same account or chain. */
import { selector } from '../chain/keccak.ts';
import { claimCall, SIGNATURES, type PreparedCall } from './calldata.ts';

export type PositionAction = 'mint' | 'allocate' | 'claimA' | 'claimB';
export interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
export interface WalletIdentity { readonly account: string; readonly chainId: number }
export type WalletStepState = 'WAITING' | 'SUBMITTING' | 'PENDING' | 'MINED' | 'REVERTED' | 'REFUSED' | 'BLOCKED' | 'UNCERTAIN';
export interface WalletStep {
  readonly call: PreparedCall;
  readonly state: WalletStepState;
  readonly hash: string | null;
  readonly detail: string | null;
}
export interface PendingWalletTransaction extends WalletIdentity {
  readonly hash: string | null;
  readonly action: PositionAction;
}
export interface MinedWalletTransaction { readonly state: 'MINED' | 'REVERTED'; readonly block: string }

const UINT256_MAX = (1n << 256n) - 1n;
const isAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const isHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'the wallet or node did not answer';

/** Reject partial parses, exponent notation and values that cannot fit a contract integer. Never pass through Number. */
export function parsePositionLots(raw: string): bigint | null {
  const text = raw.trim();
  if (text.length > 78 || !/^[1-9][0-9]*$/.test(text)) return null;
  const lots = BigInt(text);
  return lots <= UINT256_MAX ? lots : null;
}

export function callsForPositionAction(action: PositionAction, series: string, prepared: readonly PreparedCall[] = []): readonly PreparedCall[] {
  if (action === 'claimA' || action === 'claimB') return [claimCall(series, action === 'claimA' ? 'A' : 'B')];
  const calls = action === 'allocate' ? prepared.filter((call) => call.signature === SIGNATURES.allocateExit) : prepared;
  const expected = action === 'allocate' ? [SIGNATURES.allocateExit] : [SIGNATURES.approve, SIGNATURES.approve, SIGNATURES.mint];
  if (calls.length !== expected.length || calls.some((call, i) => call.signature !== expected[i])) throw new Error('the preview did not prepare the expected action');
  if (calls.some((call) => !isAddress(call.to) || !/^0x[0-9a-fA-F]+$/.test(call.data))) throw new Error('the preview contains invalid transaction bytes');
  if (calls.at(-1)!.to.toLowerCase() !== series.toLowerCase()) throw new Error('the preview targets a different series');
  return calls;
}

async function walletChain(provider: WalletProvider): Promise<number> {
  const raw = await provider.request({ method: 'eth_chainId' });
  if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw)) throw new Error('the wallet did not return a chain id');
  const chain = BigInt(raw);
  if (chain <= 0n || chain > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('the wallet returned an unsupported chain id');
  return Number(chain);
}

export async function readWalletIdentity(provider: WalletProvider): Promise<WalletIdentity> {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const account = Array.isArray(accounts) ? accounts[0] : null;
  if (!isAddress(account)) throw new Error('no account is connected; connect the wallet again');
  return { account: account.toLowerCase(), chainId: await walletChain(provider) };
}

export async function assertWalletIdentity(provider: WalletProvider, expected: WalletIdentity): Promise<void> {
  const actual = await readWalletIdentity(provider);
  if (actual.account !== expected.account.toLowerCase()) throw new Error('the wallet account changed; reconnect and review a new action. Nothing further was sent.');
  if (actual.chainId !== expected.chainId) throw new Error(`the wallet is on chain ${actual.chainId}; this action is for chain ${expected.chainId}. Nothing further was sent.`);
}

/** Checks a known hash only. It never submits or replaces a transaction. */
export async function checkWalletTransaction(provider: WalletProvider, pending: PendingWalletTransaction): Promise<MinedWalletTransaction | null> {
  if (!isHash(pending.hash)) throw new Error('no transaction hash was returned; inspect the wallet activity before preparing another action');
  const chain = await walletChain(provider);
  if (chain !== pending.chainId) throw new Error(`switch to chain ${pending.chainId} to check this transaction; nothing was resent`);
  const raw = await provider.request({ method: 'eth_getTransactionReceipt', params: [pending.hash] }) as { status?: unknown; blockNumber?: unknown; transactionHash?: unknown } | null;
  if (await walletChain(provider) !== pending.chainId) throw new Error(`the wallet chain changed while checking; switch to chain ${pending.chainId} and check again`);
  if (raw === null) return null;
  if (!isHash(raw.transactionHash) || raw.transactionHash.toLowerCase() !== pending.hash.toLowerCase()) throw new Error('the node did not bind the receipt to this transaction hash; its outcome is still unknown');
  if (typeof raw?.status !== 'string' || !/^0x(?:0|1)$/.test(raw.status) || typeof raw.blockNumber !== 'string' || !/^0x[0-9a-f]+$/i.test(raw.blockNumber)) {
    throw new Error('the node did not return a complete transaction receipt; its outcome is still unknown');
  }
  return { state: raw.status === '0x1' ? 'MINED' : 'REVERTED', block: BigInt(raw.blockNumber).toString() };
}

export function blocksAnotherSubmission(steps: readonly WalletStep[]): boolean {
  return steps.some((step) => ['SUBMITTING', 'PENDING', 'UNCERTAIN'].includes(step.state));
}

/** Resume only untouched steps. Confirmed steps are skipped; unknown or pending sends are never retried. */
export async function runWalletSteps(
  provider: WalletProvider,
  expected: WalletIdentity,
  action: PositionAction,
  previous: readonly WalletStep[],
  changed: (steps: readonly WalletStep[]) => void,
  options: { readonly attempts?: number; readonly delay?: () => Promise<void> } = {},
): Promise<readonly WalletStep[]> {
  const steps = [...previous];
  if (blocksAnotherSubmission(steps) || steps.some((step) => ['REVERTED', 'REFUSED', 'BLOCKED'].includes(step.state))) return steps;
  const delay = options.delay ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));
  const update = (index: number, patch: Partial<WalletStep>) => {
    steps[index] = { ...steps[index]!, ...patch };
    changed([...steps]);
  };
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index]!.state === 'MINED') continue;
    try { await assertWalletIdentity(provider, expected); }
    catch (error) { update(index, { state: 'BLOCKED', detail: errorText(error) }); break; }
    const call = steps[index]!.call;
    update(index, { state: 'SUBMITTING', detail: 'waiting for the wallet; do not submit the action again' });
    let hash: unknown;
    try {
      hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: expected.account, to: call.to, data: call.data, chainId: `0x${expected.chainId.toString(16)}` }] });
      if (!isHash(hash)) throw new Error('the wallet did not return a transaction hash');
    } catch (error) {
      const refused = typeof error === 'object' && error !== null && 'code' in error && error.code === 4001;
      update(index, { state: refused ? 'REFUSED' : 'UNCERTAIN', detail: refused ? 'the wallet request was rejected' : `${errorText(error)}. The transaction may have been submitted; check wallet activity before starting again.` });
      break;
    }
    update(index, { state: 'PENDING', hash, detail: 'submitted; waiting for a receipt' });
    try {
      let receipt: MinedWalletTransaction | null = null;
      for (let attempt = 0; attempt < (options.attempts ?? 120); attempt += 1) {
        receipt = await checkWalletTransaction(provider, { ...expected, action, hash });
        if (receipt !== null) break;
        if (attempt + 1 < (options.attempts ?? 120)) await delay();
      }
      if (receipt === null) {
        update(index, { detail: 'still pending; check this hash instead of submitting the action again' });
        break;
      }
      update(index, { state: receipt.state, detail: `block ${receipt.block}` });
      if (receipt.state !== 'MINED') break;
    } catch (error) {
      update(index, { detail: `${errorText(error)}. The submitted transaction remains unresolved.` });
      break;
    }
  }
  return steps;
}

/** Internal series getters only: neither underlying token is called, even when one cannot transfer. */
export async function readWalletPosition(provider: WalletProvider, series: string, expected: WalletIdentity): Promise<{ receipts: string; claims: { A: string; B: string }; block: string }> {
  if (!isAddress(series) || !isAddress(expected.account)) throw new Error('invalid series or wallet address');
  await assertWalletIdentity(provider, expected);
  const block = await provider.request({ method: 'eth_blockNumber' });
  if (typeof block !== 'string' || !/^0x[0-9a-f]+$/i.test(block)) throw new Error('the wallet did not return a block');
  const values = await Promise.all(['balanceOf(address)', 'claimA(address)', 'claimB(address)'].map(async (signature) => {
    const data = `${selector(signature)}${expected.account.slice(2).padStart(64, '0')}`;
    const raw = await provider.request({ method: 'eth_call', params: [{ to: series, data }, block] });
    if (typeof raw !== 'string' || !/^0x[0-9a-f]{64}$/i.test(raw)) throw new Error('the series did not return a complete balance; it is not shown as zero');
    return BigInt(raw).toString();
  }));
  await assertWalletIdentity(provider, expected);
  return { receipts: values[0]!, claims: { A: values[1]!, B: values[2]! }, block: BigInt(block).toString() };
}

/** Storage is only used to recover an unresolved hash, never to recover bytes for signing. */
export function parsePendingWalletTransaction(raw: string | null): PendingWalletTransaction | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingWalletTransaction>;
    if (!isAddress(value.account) || !Number.isSafeInteger(value.chainId) || (value.chainId ?? 0) <= 0 || !(value.hash === null || isHash(value.hash)) || !['mint', 'allocate', 'claimA', 'claimB'].includes(value.action ?? '')) return null;
    return { account: value.account.toLowerCase(), chainId: value.chainId!, hash: value.hash!, action: value.action! };
  } catch { return null; }
}
