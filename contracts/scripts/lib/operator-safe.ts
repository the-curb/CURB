/** Reviewed expectations, not Safe approval: every value is read again on the target chain. */
import { keccak256, toHex } from '../../../lib/chain/keccak.ts';

type Address = `0x${string}`;
type Hex = `0x${string}`;
const runtimeHash = (code: Hex): Hex => toHex(keccak256(Buffer.from(code.slice(2), 'hex'))) as Hex;
const ZERO = '0x0000000000000000000000000000000000000000';
export const MODULE_SENTINEL = '0x0000000000000000000000000000000000000001';
// Safe 1.4.1 GuardManager.sol and FallbackManager.sol; VERSION is checked before these slots are interpreted.
export const GUARD_STORAGE_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';
export const FALLBACK_STORAGE_SLOT = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';
const MODULE_PAGE_SIZE = 16;
const MAX_MODULES = 256;

interface ReviewedContract { readonly address: Address; readonly runtimeCodeHash: Hex }

export interface OperatorSafeExpectation {
  readonly chainId: number;
  readonly version: '1.4.1';
  readonly owners: readonly Address[];
  readonly threshold: number;
  readonly runtimeCodeHash: Hex;
  readonly singleton: { readonly address: Address; readonly runtimeCodeHash: Hex };
  /** Exact complete set; an empty array explicitly expects no enabled modules. */
  readonly modules: readonly ReviewedContract[];
  /** null explicitly expects the zero address; missing is never equivalent to absent. */
  readonly guard: ReviewedContract | null;
  readonly fallbackHandler: ReviewedContract | null;
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
  version(address: Address, blockNumber: bigint): Promise<unknown>;
  modules(address: Address, start: Address, pageSize: bigint, blockNumber: bigint): Promise<unknown>;
  storage(address: Address, slot: Hex, blockNumber: bigint): Promise<unknown>;
}

const address = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v) && !/^0x0{64}$/i.test(v);
function fail(why: string): never { throw new Error(`operator Safe: ${why}`); }
function reviewedContract(value: unknown, label: string): asserts value is ReviewedContract {
  const v = value as ReviewedContract | undefined;
  if (!address(v?.address) || v.address.toLowerCase() === MODULE_SENTINEL || !hash(v.runtimeCodeHash)) fail(`${label} needs a nonzero contract address and reviewed runtime hash`);
}
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
  if (v.version !== '1.4.1') fail('the reviewed Safe version must be 1.4.1; other storage layouts are unsupported');
  const owners = ownerSet(v.owners, 'the expectation');
  if (!Number.isSafeInteger(v.threshold) || v.threshold < 2 || v.threshold > owners.length) fail('the expected quorum must be at least two and no greater than the owner count');
  if (!hash(v.runtimeCodeHash) || !address(v.singleton?.address) || !hash(v.singleton?.runtimeCodeHash)) fail('reviewed proxy and singleton runtime hashes and the singleton address are required');
  if (!Array.isArray(v.modules) || v.modules.length > MAX_MODULES) fail(`an explicit complete modules array of at most ${MAX_MODULES} entries is required`);
  for (const module of v.modules) reviewedContract(module, 'each module');
  if (new Set(v.modules.map((module) => module.address.toLowerCase())).size !== v.modules.length) fail('the expected modules contain duplicates');
  if (v.guard !== null) reviewedContract(v.guard, 'the guard (or explicit null)');
  if (v.fallbackHandler !== null) reviewedContract(v.fallbackHandler, 'the fallback handler (or explicit null)');
  if (typeof v.reviewedBy !== 'string' || !v.reviewedBy.trim() || typeof v.reviewedAt !== 'string' || !v.reviewedAt.trim() || !Number.isFinite(Date.parse(v.reviewedAt))) fail('the expectation must name its reviewer and a valid review date');
  return v;
}

async function readModules(operator: Address, blockNumber: bigint, read: OperatorSafeReader): Promise<Address[]> {
  const found: Address[] = [];
  const seen = new Set<string>();
  let cursor: Address = MODULE_SENTINEL;
  for (let pageNumber = 0; pageNumber < MAX_MODULES / MODULE_PAGE_SIZE; pageNumber++) {
    const result = await read.modules(operator, cursor, BigInt(MODULE_PAGE_SIZE), blockNumber);
    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || result[0].length > MODULE_PAGE_SIZE || !address(result[1])) fail('unreadable or malformed module pagination');
    const [page, next] = result as [unknown[], Address];
    for (const module of page) {
      if (!address(module) || module.toLowerCase() === MODULE_SENTINEL || seen.has(module.toLowerCase())) fail('module pagination contains an invalid address, duplicate or cycle');
      seen.add(module.toLowerCase());
      found.push(module);
    }
    if (next.toLowerCase() === MODULE_SENTINEL) return found.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    // Safe 1.4.1 returns the last module on a full page as the next cursor, not the next unseen module.
    if (page.length !== MODULE_PAGE_SIZE || next.toLowerCase() !== (page.at(-1) as Address).toLowerCase()) fail('module pagination is incomplete or has an invalid continuation');
    cursor = next;
  }
  fail(`module pagination did not terminate within ${MAX_MODULES} entries`);
}

function storageAddress(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(value)) fail(`${label} storage is unreadable or is not an address word`);
  return `0x${value.slice(-40)}` as Address;
}

async function verifyExtension(actual: Address, expected: ReviewedContract | null, label: string, blockNumber: bigint, read: OperatorSafeReader) {
  if (expected === null) {
    if (actual.toLowerCase() !== ZERO) fail(`${label} differs: reviewed as absent but configured on-chain`);
    return null;
  }
  if (actual.toLowerCase() !== expected.address.toLowerCase()) fail(`${label} differs from the reviewed address`);
  const code = await read.code(actual, blockNumber);
  if (!code || code === '0x' || runtimeHash(code).toLowerCase() !== expected.runtimeCodeHash.toLowerCase()) fail(`${label} runtime code differs from the reviewed hash`);
  return { address: actual, runtimeCodeHash: runtimeHash(code) };
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
  const [owners, threshold, singleton, version] = await Promise.all([
    read.owners(operator, blockNumber), read.threshold(operator, blockNumber), read.singleton(operator, blockNumber), read.version(operator, blockNumber),
  ]);
  if (version !== expected.version) fail('on-chain Safe version differs from the supported reviewed version');
  const actualOwners = ownerSet(owners, 'the on-chain Safe');
  if (actualOwners.join(',') !== ownerSet(expected.owners, 'the expectation').join(',')) fail('on-chain owners differ from the reviewed owner set');
  if (typeof threshold !== 'bigint' || threshold !== BigInt(expected.threshold)) fail('on-chain threshold differs from the reviewed quorum');
  if (!address(singleton) || singleton.toLowerCase() !== expected.singleton.address.toLowerCase()) fail('the proxy singleton differs from the reviewed address');
  const singletonCode = await read.code(singleton, blockNumber);
  if (!singletonCode || singletonCode === '0x' || runtimeHash(singletonCode).toLowerCase() !== expected.singleton.runtimeCodeHash.toLowerCase()) fail('singleton runtime code differs from the reviewed hash');
  const [modules, guardWord, fallbackWord] = await Promise.all([
    readModules(operator, blockNumber, read), read.storage(operator, GUARD_STORAGE_SLOT, blockNumber), read.storage(operator, FALLBACK_STORAGE_SLOT, blockNumber),
  ]);
  const reviewedModules = [...expected.modules].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  if (modules.map((m) => m.toLowerCase()).join(',') !== reviewedModules.map((m) => m.address.toLowerCase()).join(',')) fail('enabled modules differ from the complete reviewed module set');
  const [moduleContracts, guard, fallbackHandler] = await Promise.all([
    Promise.all(modules.map((module, i) => verifyExtension(module, reviewedModules[i]!, 'module', blockNumber, read))),
    verifyExtension(storageAddress(guardWord, 'guard'), expected.guard, 'guard', blockNumber, read),
    verifyExtension(storageAddress(fallbackWord, 'fallback handler'), expected.fallbackHandler, 'fallback handler', blockNumber, read),
  ]);
  return { chainId, operator, version, blockNumber: blockNumber.toString(), owners: actualOwners, threshold: expected.threshold, runtimeCodeHash: runtimeHash(code), singleton: { address: singleton, runtimeCodeHash: runtimeHash(singletonCode) }, modules: moduleContracts, guard, fallbackHandler, note: 'matches reviewed expectations at this block; signer control, extension internals and upgrade authority still require independent review; this check does not grant security or launch approval' };
}
