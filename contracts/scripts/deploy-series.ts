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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseArgs } from './lib/args.ts';

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
  readonly name: string;
  readonly symbol: string;
  /** Who reviewed this record and when; empty means it was not reviewed and it will not be sent. */
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
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
if (!isAddress(record.operator)) fail('the record needs an operator address (the multisig)');
if (!/^[1-9][0-9]*$/.test(record.q?.A ?? '') || !/^[1-9][0-9]*$/.test(record.q?.B ?? '') || !/^[1-9][0-9]*$/.test(record.capLots ?? '')) fail('q.A, q.B and capLots must be positive integers as strings');
if (!record.reviewedBy || !record.reviewedAt) fail('the record names nobody who reviewed it; a deployment record is reviewed or it is not sent');
if (record.chainId !== 31337 && !reviewedFlag) fail(`chain id ${record.chainId} is not a local chain and needs --reviewed on top of the record’s own review`);
if (record.chainId === 31337 && reviewedFlag) console.error('note: --reviewed is not needed for a local chain');

const chain = { id: record.chainId, name: `chain ${record.chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [record.rpcUrl] } } } as const;
const pub = createPublicClient({ chain, transport: http(record.rpcUrl) });
const erc20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

// ── the chain ─────────────────────────────────────────────────────────────
const chainId = await pub.getChainId();
if (chainId !== record.chainId) fail(`the node answers chain id ${chainId}; the record says ${record.chainId}`);
for (const id of ['A', 'B'] as const) {
  const address = record.components[id];
  const code = await pub.getCode({ address });
  if (!code || code === '0x') fail(`component ${id} at ${address} has no code on chain ${chainId}`);
  const [symbol, decimals] = await Promise.all([
    pub.readContract({ address, abi: erc20, functionName: 'symbol' }).catch(() => null),
    pub.readContract({ address, abi: erc20, functionName: 'decimals' }).catch(() => null),
  ]);
  if (symbol === null || decimals === null) fail(`component ${id} at ${address} does not answer symbol() and decimals()`);
  if (Number(decimals) !== record.decimals[id]) fail(`component ${id} answers ${decimals} decimals; the record expects ${record.decimals[id]}`);
  console.error(`component ${id}: ${address} · ${symbol} · ${decimals} decimals · code present`);
}

const artifact = JSON.parse(readFileSync(new URL('../artifacts/src/CompanySeries.sol/CompanySeries.json', import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex };
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
const wallet = createWalletClient({ chain, transport: http(record.rpcUrl), account });
console.error(`deployer ${account.address}`);

const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: ctor as never });
console.error(`sent ${hash}; waiting for the receipt`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress || receipt.status !== 'success') fail(`the deployment transaction did not succeed: status ${receipt.status}`);
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
  },
};
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
const out = new URL(`../evidence/deployments/${record.seriesId}.${record.chainId}.json`, import.meta.url);
writeFileSync(out, `${JSON.stringify({ record, deployment: { address, block, transactionHash: hash, deployer: account.address, at: new Date().toISOString() }, constructorArguments: ctor.map((x) => (typeof x === 'bigint' ? x.toString() : x)), env }, null, 2)}\n`);
console.error(`written ${fileURLToPath(out)}`);
// The only line on stdout: the env the site needs.
console.log(JSON.stringify(env));
