/**
 * Deploy the credit desk from a reviewed record (docs/decisions/TOKEN.md,
 * "the order of work", step 3).
 *
 * The operator's tool for the day the token exists. It holds no key of its
 * own, runs on no schedule, and refuses more than it does:
 *
 *   - the record is a file, reviewed and named in it (`reviewedBy`), never
 *     arguments typed on a command line;
 *   - the node must answer with the record's chain id, or nothing is sent;
 *   - any chain but a local one (31337) needs `--reviewed` on top of the
 *     record's own review, so a rehearsal record cannot be sent to a public
 *     chain by habit;
 *   - the token must be a contract that answers symbol(), decimals() and
 *     totalSupply(), with the decimals the record expects;
 *   - the treasury must be a contract — the operator multisig — except on
 *     a local chain, where an unlocked account will do for a rehearsal;
 *   - `--dry-run` does every check and prints the plan without a key.
 *
 * The key comes from DEPLOYER_PRIVATE_KEY in the environment of the shell
 * that runs this, and is never printed. What is printed: the address, the
 * constructor arguments, and — when the record names the pool — the
 * CURB_CREDITS line the site needs; after which the site's own tick
 * verifies the desk's code and its treasury against the build in this
 * repository. Without a pool in the record, the line is printed with the
 * price source left to be filled when the pool exists.
 *
 *   node scripts/deploy-credit-desk.ts records/credit-desk.json --dry-run
 *   DEPLOYER_PRIVATE_KEY=… node scripts/deploy-credit-desk.ts records/credit-desk.json [--reviewed]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

interface DeskRecord {
  readonly network: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly token: Address;
  readonly decimals: number;
  readonly treasury: Address;
  readonly priceSource: { readonly kind: 'uniswap-v2-pair' | 'uniswap-v3-pool'; readonly pair: Address; readonly quote: { readonly kind: 'usd-stable' } | { readonly kind: 'chainlink-feed'; readonly feed: Address } } | null;
  /** Who reviewed this record and when; empty means it was not reviewed and it will not be sent. */
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const reviewedFlag = args.includes('--reviewed');
if (!file) {
  console.error('usage: node scripts/deploy-credit-desk.ts <record.json> [--dry-run] [--reviewed]');
  process.exit(2);
}

const record = JSON.parse(readFileSync(file, 'utf8')) as DeskRecord;
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};

// ── the record itself ─────────────────────────────────────────────────────
if (!record.reviewedBy || !record.reviewedAt) fail('the record names nobody who reviewed it; a deployment record is reviewed or it is not sent');
/** The site's profiles and their chain ids (lib/chain/networks.ts); a record naming any other pair prints a line the site would refuse. */
const PROFILES: Record<string, number> = { 'robinhood-mainnet': 4663, 'robinhood-testnet': 46630, 'ethereum-mainnet': 1, 'ethereum-sepolia': 11155111, 'hardhat-local': 31337 };
if (!record.network || !Number.isInteger(record.chainId) || !record.rpcUrl) fail('the record needs network, chainId and rpcUrl');
if (PROFILES[record.network] === undefined) fail(`network ${record.network} is not a profile the site knows (${Object.keys(PROFILES).join(', ')})`);
if (PROFILES[record.network] !== record.chainId) fail(`network ${record.network} is chain ${PROFILES[record.network]} on the site; the record says ${record.chainId}`);
if (!isAddress(record.token)) fail('the record needs the token address');
if (!isAddress(record.treasury)) fail('the record needs the treasury address (the operator multisig)');
if (record.token.toLowerCase() === record.treasury.toLowerCase()) fail('the treasury cannot be the token');
if (!Number.isInteger(record.decimals) || record.decimals < 0 || record.decimals > 36) fail('decimals must be an integer between 0 and 36');
if (record.priceSource !== null) {
  const ps = record.priceSource;
  if ((ps.kind !== 'uniswap-v2-pair' && ps.kind !== 'uniswap-v3-pool') || !isAddress(ps.pair)) fail('priceSource must be a uniswap-v2-pair or a uniswap-v3-pool with the pool address, or null until the pool exists');
  if (ps.quote.kind !== 'usd-stable' && !(ps.quote.kind === 'chainlink-feed' && isAddress(ps.quote.feed))) fail('priceSource.quote must be usd-stable or a chainlink-feed with a feed address');
}
if (record.chainId !== 31337 && !reviewedFlag) fail(`chain id ${record.chainId} is not a local chain and needs --reviewed on top of the record’s own review`);
if (record.chainId === 31337 && reviewedFlag) console.error('note: --reviewed is not needed for a local chain');

const chain = { id: record.chainId, name: `chain ${record.chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [record.rpcUrl] } } } as const;
const pub = createPublicClient({ chain, transport: http(record.rpcUrl) });
const erc20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)']);

// ── the chain ─────────────────────────────────────────────────────────────
const chainId = await pub.getChainId();
if (chainId !== record.chainId) fail(`the node answers chain id ${chainId}; the record says ${record.chainId}`);
const tokenCode = await pub.getCode({ address: record.token });
if (!tokenCode || tokenCode === '0x') fail(`the token at ${record.token} has no code on chain ${chainId}`);
const [symbol, decimals, supply] = await Promise.all([
  pub.readContract({ address: record.token, abi: erc20, functionName: 'symbol' }).catch(() => null),
  pub.readContract({ address: record.token, abi: erc20, functionName: 'decimals' }).catch(() => null),
  pub.readContract({ address: record.token, abi: erc20, functionName: 'totalSupply' }).catch(() => null),
]);
if (symbol === null || decimals === null || supply === null) fail(`the token at ${record.token} does not answer symbol(), decimals() and totalSupply()`);
if (Number(decimals) !== record.decimals) fail(`the token answers ${decimals} decimals; the record expects ${record.decimals}`);
console.error(`token: ${record.token} · ${symbol} · ${decimals} decimals · supply ${supply} · code present`);
const treasuryCode = await pub.getCode({ address: record.treasury });
if ((!treasuryCode || treasuryCode === '0x') && record.chainId !== 31337) fail(`the treasury at ${record.treasury} has no code: the treasury is the operator multisig, not a key`);
console.error(`treasury: ${record.treasury} · ${treasuryCode && treasuryCode !== '0x' ? 'a contract' : 'an unlocked local account (rehearsal only)'}`);
if (record.priceSource !== null) {
  const pairCode = await pub.getCode({ address: record.priceSource.pair });
  if (!pairCode || pairCode === '0x') fail(`the pool at ${record.priceSource.pair} has no code on chain ${chainId}`);
  console.error(`pool: ${record.priceSource.pair} · code present · quote ${record.priceSource.quote.kind}`);
} else {
  console.error('pool: none in the record; the CURB_CREDITS line will need priceSource filled when the pool exists');
}

const artifact = JSON.parse(readFileSync(new URL('../artifacts/src/CreditDesk.sol/CreditDesk.json', import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex; deployedBytecode: Hex };
// What is sent must be what the site verifies against: the committed build record. A stale artifact or a stale record is refused here, not found by a DARK condition later.
let build: { deployedBytecode: string; commit: string } | null = null;
try {
  build = JSON.parse(readFileSync(new URL('../evidence/CreditDesk.build.json', import.meta.url), 'utf8')) as { deployedBytecode: string; commit: string };
} catch {
  fail('evidence/CreditDesk.build.json is missing; run npm run record:build and commit it before deploying');
}
if (build!.deployedBytecode.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) fail(`the compiled CreditDesk is not the committed build record (commit ${build!.commit.slice(0, 10)}); rebuild and re-record, or check out the recorded commit, before deploying`);
console.error(`the artifact is the committed build at ${build!.commit.slice(0, 10)}`);
const out = new URL(`../evidence/deployments/credit-desk.${record.chainId}.json`, import.meta.url);
if (existsSync(out) && !dryRun) fail(`${out.pathname} already exists: a desk was deployed from this record before. Read it; if a second desk is really wanted, move that file aside first`);
const ctor = [record.token, record.treasury] as const;
console.error('constructor arguments:', JSON.stringify(ctor));

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
// The hash is written down before the receipt is waited for, so a cut-off here leaves a note, not a second deployment on the next run.
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify({ record, pending: { transactionHash: hash, deployer: account.address, sentAt: new Date().toISOString(), note: 'sent; the receipt was not yet read when this was written' } }, null, 2)}\n`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress || receipt.status !== 'success') fail(`the deployment transaction did not succeed: status ${receipt.status}`);
const address = receipt.contractAddress!;
const block = Number(receipt.blockNumber);
console.error(`deployed the credit desk at ${address} in block ${block}`);

const env = { network: record.network, token: record.token, desk: address, treasury: record.treasury, fromBlock: block, priceSource: record.priceSource };
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify({ record, deployment: { address, block, transactionHash: hash, deployer: account.address, at: new Date().toISOString() }, constructorArguments: ctor, env }, null, 2)}\n`);
console.error(`written ${out.pathname}`);
// The only line on stdout: the env the site needs (priceSource null until the pool exists).
console.log(JSON.stringify(env));
