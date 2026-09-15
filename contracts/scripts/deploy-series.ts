/**
 * Deploy one series from a reviewed deployment record (blueprint G02).
 *
 * This is the operator's tool for the day a gate decision says so. It does
 * not run on a schedule, it holds no key of its own, and it refuses more
 * than it does:
 *
 *   - the record is a file, reviewed and named in it (`reviewedBy`), never
 *     an argument typed on a command line;
 *   - the node must answer with the record's chain id, or nothing is sent;
 *   - any chain but a local one (31337) needs `--reviewed` on top of the
 *     record's own review, so a rehearsal record cannot be sent to a public
 *     chain by habit;
 *   - both components must be contracts that answer symbol() and decimals()
 *     with the decimals the record expects, and must differ;
 *   - `--dry-run` does every check and prints the plan without a key.
 *
 * The key comes from DEPLOYER_PRIVATE_KEY in the environment of the shell
 * that runs this, and is never printed. What is printed: the address, the
 * constructor arguments (for anyone verifying the source elsewhere), and
 * the CURB_SERIES_DEPLOYMENTS line the site needs — after which the site's
 * own tick verifies the code against the build in this repository.
 *
 *   node scripts/deploy-series.ts records/apple-s1.json --dry-run
 *   DEPLOYER_PRIVATE_KEY=… node scripts/deploy-series.ts records/apple-s1.json [--reviewed]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, getContractAddress, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseArgs } from './lib/args.ts';
import { safeAbi } from './lib/safe.ts';
import { validateOperatorSafeExpectation, verifyOperatorSafe, type OperatorSafeExpectation } from './lib/operator-safe.ts';
import { assertLoopbackRpc } from './lib/local-chain.ts';
import { assertRecordedSourceCommit, buildCurrentContracts, currentSourceCommit } from './lib/build-provenance.mjs';
import { journaledDeployment } from './lib/journaled-deployment.mjs';

interface DeploymentRecord {
  readonly seriesId: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly components: { readonly A: Address; readonly B: Address };
  readonly decimals: { readonly A: number; readonly B: number };
  /** Base units per lot, as decimal strings. */
  readonly q: { readonly A: string; readonly B: string };
  readonly capLots: string;
  readonly operator: Address;
  /** Mandatory on public chains. These explicit reviewed expectations are checked at one block. */
  readonly operatorSafe?: OperatorSafeExpectation;
  readonly name: string;
  readonly symbol: string;
  /** Who reviewed this record and when; empty means it was not reviewed and it will not be sent. */
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

function fail(why: string): never {
  console.error(`refused: ${why}`);
  process.exit(1);
}
// Strict: a misspelt --dry-run is a refusal, never a real deployment.
const { positionals, flags } = parseArgs(process.argv.slice(2), [], fail, ['dry-run', 'reviewed']);
const file = positionals[0];
const dryRun = flags['dry-run'] === 'true';
const reviewedFlag = flags.reviewed === 'true';
if (!file || positionals.length !== 1) {
  console.error('usage: node scripts/deploy-series.ts <record.json> [--dry-run] [--reviewed]');
  process.exit(2);
}

const record = JSON.parse(readFileSync(file, 'utf8')) as DeploymentRecord;
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

// ── the record itself ─────────────────────────────────────────────────────
if (!record.seriesId || !Number.isInteger(record.chainId) || !record.rpcUrl) fail('the record needs seriesId, chainId and rpcUrl');
if (!isAddress(record.components?.A) || !isAddress(record.components?.B)) fail('the record needs two component addresses');
if (record.components.A.toLowerCase() === record.components.B.toLowerCase()) fail('the two components are the same address');
if (!isAddress(record.operator) || /^0x0{40}$/i.test(record.operator)) fail('the record needs a nonzero operator address (the multisig)');
if (!/^[1-9][0-9]*$/.test(record.q?.A ?? '') || !/^[1-9][0-9]*$/.test(record.q?.B ?? '') || !/^[1-9][0-9]*$/.test(record.capLots ?? '')) fail('q.A, q.B and capLots must be positive integers as strings');
if (!record.reviewedBy || !record.reviewedAt) fail('the record names nobody who reviewed it; a deployment record is reviewed or it is not sent');
if (record.chainId !== 31337 && !reviewedFlag) fail(`chain id ${record.chainId} is not a local chain and needs --reviewed on top of the record’s own review`);
if (record.chainId === 31337 && reviewedFlag) console.error('note: --reviewed is not needed for a local chain');
if (record.chainId !== 31337 || record.operatorSafe !== undefined) {
  try { validateOperatorSafeExpectation(record.operatorSafe, record.chainId); } catch (cause) { fail(cause instanceof Error ? cause.message : 'operator Safe expectation is invalid'); }
}
const uint256Max = (1n << 256n) - 1n;
if (BigInt(record.q.A) * BigInt(record.capLots) > uint256Max || BigInt(record.q.B) * BigInt(record.capLots) > uint256Max) fail('capLots multiplied by each component amount must fit uint256');
if (!record.name?.trim() || !record.symbol?.trim()) fail('the receipt name and symbol are required');

/** The operator's own endpoint for the chain, from the environment like every other tool (lib/chain/networks.ts); the record keeps naming the public one, and a keyed URL is never printed. */
const RPC_ENV: Record<number, string> = { 4663: 'CURB_RPC_URL', 46630: 'CURB_RPC_URL_TESTNET', 1: 'CURB_RPC_URL_ETHEREUM', 11155111: 'CURB_RPC_URL_SEPOLIA', 31337: 'CURB_RPC_URL_LOCAL' };
const rpcUrl = (RPC_ENV[record.chainId] !== undefined && process.env[RPC_ENV[record.chainId]!]) || record.rpcUrl;
if (record.chainId === 31337) assertLoopbackRpc(rpcUrl);
console.error(`node: ${new URL(rpcUrl).host}${rpcUrl === record.rpcUrl ? ' (the record’s)' : ' (from the environment)'}`);
const chain = { id: record.chainId, name: `chain ${record.chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const erc20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

/** A node call that failed is a refusal naming the host and the first line of the cause — never viem's full message, which carries the URL the key is in. */
async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    return fail(`the node at ${new URL(rpcUrl).host} did not answer ${what}: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}; nothing was sent`);
  }
}

// ── the chain ─────────────────────────────────────────────────────────────
const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== record.chainId) fail(`the node answers chain id ${chainId}; the record says ${record.chainId}`);
let operatorAsRead = null;
if (record.operatorSafe !== undefined) {
  try {
    operatorAsRead = await verifyOperatorSafe(record.operator, record.operatorSafe, record.chainId, {
      chainId: () => pub.getChainId(), blockNumber: () => pub.getBlockNumber(),
      code: (address, blockNumber) => pub.getCode({ address, blockNumber }),
      owners: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getOwners', blockNumber }),
      threshold: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getThreshold', blockNumber }),
      singleton: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'masterCopy', blockNumber }),
      version: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'VERSION', blockNumber }),
      modules: (address, start, pageSize, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getModulesPaginated', args: [start, pageSize], blockNumber }),
      storage: (address, slot, blockNumber) => pub.getStorageAt({ address, slot, blockNumber }),
    });
  } catch (cause) { fail(`the operator Safe could not be verified: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}`); }
  console.error(`operator Safe: ${record.operator} · ${operatorAsRead.threshold}-of-${operatorAsRead.owners.length} · proxy, singleton, modules, guard and fallback match · block ${operatorAsRead.blockNumber}`);
} else {
  console.error('local rehearsal only: no public operator Safe verification was requested');
}
for (const id of ['A', 'B'] as const) {
  const address = record.components[id];
  const code = await ask(`getCode(component ${id})`, () => pub.getCode({ address }));
  if (!code || code === '0x') fail(`component ${id} at ${address} has no code on chain ${chainId}`);
  const [symbol, decimals] = await Promise.all([
    pub.readContract({ address, abi: erc20, functionName: 'symbol' }).catch(() => null),
    pub.readContract({ address, abi: erc20, functionName: 'decimals' }).catch(() => null),
  ]);
  if (symbol === null || decimals === null) fail(`component ${id} at ${address} does not answer symbol() and decimals()`);
  if (Number(decimals) !== record.decimals[id]) fail(`component ${id} answers ${decimals} decimals; the record expects ${record.decimals[id]}`);
  console.error(`component ${id}: ${address} · ${symbol} · ${decimals} decimals · code present`);
}

try { buildCurrentContracts(); } catch (cause) { fail(`the contracts did not compile: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}`); }
const artifact = JSON.parse(readFileSync(new URL('../artifacts/src/CompanySeries.sol/CompanySeries.json', import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex; deployedBytecode: Hex };
const build = JSON.parse(readFileSync(new URL('../evidence/CompanySeries.build.json', import.meta.url), 'utf8')) as { deployedBytecode: string; creationBytecode?: string; workingTreeClean: boolean; sourceCommit: string | null };
if (build.deployedBytecode.toLowerCase() !== artifact.deployedBytecode.toLowerCase() || build.creationBytecode?.toLowerCase() !== artifact.bytecode.toLowerCase()) fail('the compiled series does not match both creation and runtime bytecode in its build record; rebuild and record this source before deploying');
if (record.chainId !== 31337) {
  if (!build.workingTreeClean || !build.sourceCommit || !/^[0-9a-f]{40}$/i.test(build.sourceCommit)) fail('the build is not recorded from clean committed source; local rehearsal evidence cannot authorize a public deployment');
  try { assertRecordedSourceCommit(build, currentSourceCommit()); } catch (cause) { fail(cause instanceof Error ? cause.message : 'the build source provenance is stale'); }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dirty = execFileSync('git', ['status', '--porcelain', '--', '../src', '../hardhat.config.ts', '../evidence/CompanySeries.build.json', './deploy-series.ts', './lib', '../../lib/chain/keccak.ts'], { cwd: here, encoding: 'utf8' }).trim();
  if (dirty) fail('contract source, compiler settings, build record or deployment tooling has uncommitted changes; pin and review the release before public deployment');
}
const out = new URL(`../evidence/deployments/${record.seriesId}.${record.chainId}.json`, import.meta.url);
if (!/^[a-z0-9][a-z0-9-]*$/.test(record.seriesId)) fail('seriesId must contain only lowercase letters, digits and hyphens');
if (existsSync(out)) {
  if (!dryRun) fail('a deployment record for this series and chain already exists; review it before any additional deployment');
  console.error('note: an existing deployment record would prevent a real deployment');
}
const ctor = [record.components.A, record.components.B, BigInt(record.q.A), BigInt(record.q.B), BigInt(record.capLots), record.operator, record.name, record.symbol] as const;
console.error('constructor arguments:', JSON.stringify(ctor.map((x) => (typeof x === 'bigint' ? x.toString() : x))));

if (dryRun) {
  console.error('dry run: every check passed; nothing was sent');
  process.exit(0);
}

// ── the key, from the environment, never printed ──────────────────────────
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('DEPLOYER_PRIVATE_KEY is not set in the environment (a 32-byte hex key with 0x); nothing was sent');
const account = privateKeyToAccount(key as Hex);
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
console.error(`deployer ${account.address}`);

const balance = await ask('getBalance(deployer)', () => pub.getBalance({ address: account.address }));
if (balance === 0n) fail(`the deployer ${account.address} holds no ETH on chain ${chainId}; nothing was sent`);
const nonce = await ask('getTransactionCount(deployer)', () => pub.getTransactionCount({ address: account.address, blockTag: 'pending' }));
const expectedAddress = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
const { hash, receipt } = await journaledDeployment(out, { record, operatorAsRead, pending: { deployer: account.address, nonce, expectedAddress, preparedAt: new Date().toISOString() } }, async () => {
  const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: ctor as never, nonce });
  console.error(`sent ${hash}; recording the hash before waiting for the receipt`);
  return hash;
}, (hash: Hex) => pub.waitForTransactionReceipt({ hash })).catch((cause: unknown) => fail(`the deployment did not complete: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}; if a hash was journaled in ${fileURLToPath(out)}, preserve and reconcile the journal before any second attempt`));
if (!receipt.contractAddress || receipt.status !== 'success') fail(`the deployment transaction did not succeed: status ${receipt.status}`);
if (receipt.contractAddress.toLowerCase() !== expectedAddress.toLowerCase()) fail('the receipt address differs from the prepared deployer nonce; the pending journal is retained for investigation');
const address = receipt.contractAddress!;
const block = Number(receipt.blockNumber);
console.error(`deployed ${record.seriesId} at ${address} in block ${block}`);

const env = {
  [record.seriesId]: {
    chainId: record.chainId,
    address,
    components: { A: record.components.A, B: record.components.B },
    fromBlock: block,
    q: { A: record.q.A, B: record.q.B },
    capLots: record.capLots,
    operator: record.operator,
  },
};
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify({ record, operatorAsRead, deployment: { address, block, transactionHash: hash, deployer: account.address, at: new Date().toISOString() }, constructorArguments: ctor.map((x) => (typeof x === 'bigint' ? x.toString() : x)), env }, null, 2)}\n`);
console.error(`written ${fileURLToPath(out)}`);
// The only line on stdout: the env the site needs.
console.log(JSON.stringify(env));
