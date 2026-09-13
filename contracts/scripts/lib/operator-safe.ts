/** Reviewed expectations, not Safe approval: every value is read again on the target chain. */
import { keccak256, toHex } from '../../../lib/chain/keccak.ts';

type Address = `0x${string}`;
type Hex = `0x${string}`;
const runtimeHash = (code: Hex): Hex => toHex(keccak256(Buffer.from(code.slice(2), 'hex'))) as Hex;

export interface OperatorSafeExpectation {
  readonly chainId: number;
  readonly owners: readonly Address[];
  readonly threshold: number;
  readonly runtimeCodeHash: Hex;
  readonly singleton: { readonly address: Address; readonly runtimeCodeHash: Hex };
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

export interface OperatorSafeReader {
  chainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  code(address: Address, blockNumber: bigint): Promise<Hex | undefined>;
  owners(address: Address, blockNumber: bigint): Promise<unknown>;
  threshold(address: Address, blockNumber: bigint): Promise<unknown>;
  singleton(address: Address, blockNumber: bigint): Promise<unknown>;
}

const address = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v) && !/^0x0{64}$/i.test(v);
function fail(why: string): never { throw new Error(`operator Safe: ${why}`); }
function ownerSet(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2 || !value.every(address)) fail(`${label} needs at least two nonzero owner addresses`);
  const owners = (value as Address[]).map((o) => o.toLowerCase()).sort();
  if (new Set(owners).size !== owners.length) fail(`${label} contains duplicate owners`);
  return owners;
}

export function validateOperatorSafeExpectation(value: unknown, chainId: number): OperatorSafeExpectation {
  if (!value || typeof value !== 'object') fail('a reviewed operatorSafe expectation is required on public chains');
  const v = value as OperatorSafeExpectation;
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || v.chainId !== chainId) fail('the expectation must name the deployment chain');
  const owners = ownerSet(v.owners, 'the expectation');
  if (!Number.isSafeInteger(v.threshold) || v.threshold < 2 || v.threshold > owners.length) fail('the expected quorum must be at least two and no greater than the owner count');
  if (!hash(v.runtimeCodeHash) || !address(v.singleton?.address) || !hash(v.singleton?.runtimeCodeHash)) fail('reviewed proxy and singleton runtime hashes and the singleton address are required');
  if (typeof v.reviewedBy !== 'string' || !v.reviewedBy.trim() || typeof v.reviewedAt !== 'string' || !v.reviewedAt.trim() || !Number.isFinite(Date.parse(v.reviewedAt))) fail('the expectation must name its reviewer and a valid review date');
  return v;
}

/** Reads at one block. A matching owner set is insufficient if proxy or singleton code differs. */
export async function verifyOperatorSafe(operator: Address, expected: OperatorSafeExpectation, targetChainId: number, read: OperatorSafeReader) {
  if (!address(operator)) fail('the operator must be a nonzero address');
  validateOperatorSafeExpectation(expected, targetChainId);
  const chainId = await read.chainId();
  if (chainId !== targetChainId) fail(`the endpoint answers chain ${chainId}, expected ${targetChainId}`);
  const blockNumber = await read.blockNumber();
  const code = await read.code(operator, blockNumber);
  if (!code || code === '0x') fail('the operator has no code on the target chain');
  if (runtimeHash(code).toLowerCase() !== expected.runtimeCodeHash.toLowerCase()) fail('proxy runtime code differs from the reviewed hash');
  const [owners, threshold, singleton] = await Promise.all([
    read.owners(operator, blockNumber), read.threshold(operator, blockNumber), read.singleton(operator, blockNumber),
  ]);
  const actualOwners = ownerSet(owners, 'the on-chain Safe');
  if (actualOwners.join(',') !== ownerSet(expected.owners, 'the expectation').join(',')) fail('on-chain owners differ from the reviewed owner set');
  if (typeof threshold !== 'bigint' || threshold !== BigInt(expected.threshold)) fail('on-chain threshold differs from the reviewed quorum');
  if (!address(singleton) || singleton.toLowerCase() !== expected.singleton.address.toLowerCase()) fail('the proxy singleton differs from the reviewed address');
  const singletonCode = await read.code(singleton, blockNumber);
  if (!singletonCode || singletonCode === '0x' || runtimeHash(singletonCode).toLowerCase() !== expected.singleton.runtimeCodeHash.toLowerCase()) fail('singleton runtime code differs from the reviewed hash');
  return { chainId, operator, blockNumber: blockNumber.toString(), owners: actualOwners, threshold: expected.threshold, runtimeCodeHash: runtimeHash(code), singleton: { address: singleton, runtimeCodeHash: runtimeHash(singletonCode) }, note: 'matches reviewed expectations at this block; this check does not grant independent security or launch approval' };
}
