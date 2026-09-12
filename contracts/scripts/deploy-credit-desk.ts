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
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseArgs } from './lib/args.ts';

interface DeskRecord {
  readonly network: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly token: Address;
  readonly decimals: number;
  readonly treasury: Address;
  /** The pool, when it exists; `fromBlock` is the block it was created in, read from the chain — a top-up before it is priced at the head when indexed. */
  readonly priceSource: { readonly kind: 'uniswap-v2-pair' | 'uniswap-v3-pool'; readonly pair: Address; readonly fromBlock?: number | null; readonly quote: { readonly kind: 'usd-stable' } | { readonly kind: 'chainlink-feed'; readonly feed: Address } } | null;
  /** Who reviewed this record and when; empty means it was not reviewed and it will not be sent. */
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};

/**
 * Did the pool emit anything before `top`? One query over [0, top] on a node
 * that serves any width — a refusal for matching too much is itself the
 * answer: logs exist there. On a node that caps a query's width, pages of
 * the width it serves, walked down from `top`, at most 64 of them; the
 * answer then says how far down it looked.
 */
const WIDTH_CAP = /block range|ranges? over \d+ blocks|range too (?:large|wide)|narrower (?:fromBlock|range)/i;
const CONTENT_CAP = /exceeds limit|too many|query returned more than|response size/i;
async function logBefore(address: Address, top: number): Promise<{ block: number | null; coveredFrom: number }> {
  const message = (cause: unknown) => (cause instanceof Error ? cause.message.split('\n')[0]! : 'unknown');
  const earliest = (logs: { blockNumber: bigint | null }[]) => logs.map((l) => Number(l.blockNumber)).reduce((a, b) => Math.min(a, b));
  try {
    const logs = await pub.getLogs({ address, fromBlock: 0n, toBlock: BigInt(top) });
    return { block: logs.length === 0 ? null : earliest(logs), coveredFrom: 0 };
  } catch (cause) {
    const m = message(cause);
    if (CONTENT_CAP.test(m) && !WIDTH_CAP.test(m)) return { block: top, coveredFrom: 0 };
    if (!WIDTH_CAP.test(m)) fail(`the node at ${new URL(rpcUrl).host} would not serve the pool's logs for blocks 0–${top}: ${m}`);
  }
  let width = top + 1;
  let hi = top;
  for (let i = 0; i < 64; i += 1) {
    const lo = Math.max(0, hi - width + 1);
    try {
      const logs = await pub.getLogs({ address, fromBlock: BigInt(lo), toBlock: BigInt(hi) });
      if (logs.length > 0) return { block: earliest(logs), coveredFrom: lo };
      if (lo === 0) return { block: null, coveredFrom: 0 };
      hi = lo - 1;
    } catch (cause) {
      const m = message(cause);
      if (width <= 25) fail(`the node at ${new URL(rpcUrl).host} would not serve the pool's logs for blocks ${lo}–${hi}: ${m}`);
      width = Math.floor(width / 2);
    }
  }
  return { block: null, coveredFrom: hi + 1 };
}

/** A node call that failed is a refusal naming the host, never a stack trace carrying the keyed URL. */
async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    return fail(`the node at ${new URL(rpcUrl).host} did not answer ${what}: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}; nothing was sent`);
  }
}
// Strict: a misspelt --dry-run is a refusal, never a real deployment.
const { positionals, flags } = parseArgs(process.argv.slice(2), [], fail, ['dry-run', 'reviewed']);
const file = positionals[0];
const dryRun = flags['dry-run'] === 'true';
const reviewedFlag = flags.reviewed === 'true';
if (!file || positionals.length !== 1) {
  console.error('usage: node scripts/deploy-credit-desk.ts <record.json> [--dry-run] [--reviewed]');
  process.exit(2);
}

let record: DeskRecord;
try {
  record = JSON.parse(readFileSync(file, 'utf8')) as DeskRecord;
} catch (cause) {
  record = fail(`the record at ${file} could not be read as JSON: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}`);
}
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const ZERO = '0x0000000000000000000000000000000000000000';

// ── the record itself ─────────────────────────────────────────────────────
// A name and a date, not whitespace: the review is a person's, written down.
if (typeof record.reviewedBy !== 'string' || record.reviewedBy.trim() === '' || typeof record.reviewedAt !== 'string' || record.reviewedAt.trim() === '') fail('the record names nobody who reviewed it; a deployment record is reviewed or it is not sent');
/** The site's profiles and their chain ids (lib/chain/networks.ts); a record naming any other pair prints a line the site would refuse. */
const PROFILES: Record<string, number> = { 'robinhood-mainnet': 4663, 'robinhood-testnet': 46630, 'ethereum-mainnet': 1, 'ethereum-sepolia': 11155111, 'hardhat-local': 31337 };
if (!record.network || !Number.isInteger(record.chainId) || !record.rpcUrl) fail('the record needs network, chainId and rpcUrl');
if (PROFILES[record.network] === undefined) fail(`network ${record.network} is not a profile the site knows (${Object.keys(PROFILES).join(', ')})`);
if (PROFILES[record.network] !== record.chainId) fail(`network ${record.network} is chain ${PROFILES[record.network]} on the site; the record says ${record.chainId}`);
if (!isAddress(record.token) || record.token.toLowerCase() === ZERO) fail('the record needs the token address');
if (!isAddress(record.treasury) || record.treasury.toLowerCase() === ZERO) fail('the record needs the treasury address (the operator multisig); record-token.ts leaves it zero until --treasury is given');
if (record.token.toLowerCase() === record.treasury.toLowerCase()) fail('the treasury cannot be the token');
if (!Number.isInteger(record.decimals) || record.decimals < 0 || record.decimals > 36) fail('decimals must be an integer between 0 and 36');
if (record.priceSource !== null) {
  const ps = record.priceSource;
  if ((ps.kind !== 'uniswap-v2-pair' && ps.kind !== 'uniswap-v3-pool') || !isAddress(ps.pair)) fail('priceSource must be a uniswap-v2-pair or a uniswap-v3-pool with the pool address, or null until the pool exists');
  if (ps.quote.kind !== 'usd-stable' && !(ps.quote.kind === 'chainlink-feed' && isAddress(ps.quote.feed))) fail('priceSource.quote must be usd-stable or a chainlink-feed with a feed address');
  if (ps.fromBlock !== undefined && ps.fromBlock !== null && (!Number.isInteger(ps.fromBlock) || ps.fromBlock < 0)) fail('priceSource.fromBlock must be the block the pool was created in (a non-negative integer), or absent');
}
if (record.chainId !== 31337 && !reviewedFlag) fail(`chain id ${record.chainId} is not a local chain and needs --reviewed on top of the record’s own review`);
if (record.chainId === 31337 && reviewedFlag) console.error('note: --reviewed is not needed for a local chain');

/** The operator's own endpoint for the profile, read from the environment like every other tool and the site (lib/chain/networks.ts); the record keeps naming the public one, and a keyed URL is never printed. */
const RPC_ENV: Record<string, string> = { 'robinhood-mainnet': 'CURB_RPC_URL', 'robinhood-testnet': 'CURB_RPC_URL_TESTNET', 'ethereum-mainnet': 'CURB_RPC_URL_ETHEREUM', 'ethereum-sepolia': 'CURB_RPC_URL_SEPOLIA', 'hardhat-local': 'CURB_RPC_URL_LOCAL' };
const rpcUrl = process.env[RPC_ENV[record.network]!] || record.rpcUrl;
console.error(`node: ${new URL(rpcUrl).host}${rpcUrl === record.rpcUrl ? ' (the record’s)' : ` (${RPC_ENV[record.network]} from the environment)`}`);
const chain = { id: record.chainId, name: `chain ${record.chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const erc20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)']);

// ── the chain ─────────────────────────────────────────────────────────────
const chainId = await pub.getChainId().catch((cause: unknown) => fail(`the node at ${new URL(rpcUrl).host} did not answer: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}; nothing was sent`));
if (chainId !== record.chainId) fail(`the node answers chain id ${chainId}; the record says ${record.chainId}`);
const tokenCode = await ask('getCode(token)', () => pub.getCode({ address: record.token }));
if (!tokenCode || tokenCode === '0x') fail(`the token at ${record.token} has no code on chain ${chainId}`);
const [symbol, decimals, supply] = await Promise.all([
  pub.readContract({ address: record.token, abi: erc20, functionName: 'symbol' }).catch(() => null),
  pub.readContract({ address: record.token, abi: erc20, functionName: 'decimals' }).catch(() => null),
  pub.readContract({ address: record.token, abi: erc20, functionName: 'totalSupply' }).catch(() => null),
]);
if (symbol === null || decimals === null || supply === null) fail(`the token at ${record.token} does not answer symbol(), decimals() and totalSupply()`);
if (Number(decimals) !== record.decimals) fail(`the token answers ${decimals} decimals; the record expects ${record.decimals}`);
console.error(`token: ${record.token} · ${symbol} · ${decimals} decimals · supply ${supply} · code present`);
const treasuryCode = await ask('getCode(treasury)', () => pub.getCode({ address: record.treasury }));
if ((!treasuryCode || treasuryCode === '0x') && record.chainId !== 31337) fail(`the treasury at ${record.treasury} has no code: the treasury is the operator multisig, not a key`);
console.error(`treasury: ${record.treasury} · ${treasuryCode && treasuryCode !== '0x' ? 'a contract' : 'an unlocked local account (rehearsal only)'}`);
if (record.priceSource !== null) {
  const pairCode = await ask('getCode(pool)', () => pub.getCode({ address: record.priceSource!.pair }));
  if (!pairCode || pairCode === '0x') fail(`the pool at ${record.priceSource.pair} has no code on chain ${chainId}`);
  // The pool must hold the token on one side, and a feed-priced quote must answer as a feed.
  const poolAbi = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
  const [t0, t1] = await Promise.all([
    pub.readContract({ address: record.priceSource.pair, abi: poolAbi, functionName: 'token0' }).catch(() => null),
    pub.readContract({ address: record.priceSource.pair, abi: poolAbi, functionName: 'token1' }).catch(() => null),
  ]);
  if (t0 === null || t1 === null) fail(`the pool at ${record.priceSource.pair} does not answer token0() and token1()`);
  const sides = [String(t0).toLowerCase(), String(t1).toLowerCase()];
  if (!sides.includes(record.token.toLowerCase())) fail(`the pool at ${record.priceSource.pair} holds ${t0} and ${t1}, neither of which is the token`);
  if (record.priceSource.quote.kind === 'chainlink-feed') {
    const feedAbi = parseAbi(['function decimals() view returns (uint8)', 'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
    const [fd, round] = await Promise.all([
      pub.readContract({ address: record.priceSource.quote.feed, abi: feedAbi, functionName: 'decimals' }).catch(() => null),
      pub.readContract({ address: record.priceSource.quote.feed, abi: feedAbi, functionName: 'latestRoundData' }).catch(() => null),
    ]);
    if (fd === null || round === null) fail(`the feed at ${record.priceSource.quote.feed} does not answer decimals() and latestRoundData()`);
  }
  // fromBlock — the block the pool was created in — decides which top-ups are priced at the head instead of at their own block, so it is not taken on anyone's word: the pool's first log is found, and fromBlock may not be later than it.
  if (typeof record.priceSource.fromBlock === 'number') {
    const head = Number(await ask('eth_blockNumber', () => pub.getBlockNumber()));
    if (record.priceSource.fromBlock > head) fail(`priceSource.fromBlock ${record.priceSource.fromBlock} is past the head (${head})`);
    const before = record.priceSource.fromBlock === 0 ? { block: null, coveredFrom: 0 } : await logBefore(record.priceSource.pair, record.priceSource.fromBlock - 1);
    if (before.block !== null) fail(`priceSource.fromBlock ${record.priceSource.fromBlock} is later than a log the pool emitted in block ${before.block}; the pool existed before that block, and a top-up between the two would be priced at the head instead of at its own block`);
    console.error(before.coveredFrom === 0 ? `pool: no log before block ${record.priceSource.fromBlock}; fromBlock is at or before the pool's first` : `pool: no log in blocks ${before.coveredFrom}–${record.priceSource.fromBlock - 1} (this endpoint caps a query's width; the span below was not read — the public node reads it whole)`);
  } else {
    console.error('note: priceSource.fromBlock is absent — a top-up the pool has no price event for waits instead of going to the head; read the creation block from the chain and add it');
  }
  console.error(`pool: ${record.priceSource.pair} · code present · holds the token against ${sides.find((x) => x !== record.token.toLowerCase())} · quote ${record.priceSource.quote.kind}`);
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
if (record.chainId !== 31337 && (build!.workingTreeClean !== true || typeof build!.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(build!.sourceCommit))) fail('the build record was written from a dirty tree (--allow-dirty) or names no source commit; re-record it from a clean tree and commit it before deploying to a public chain');
if (record.chainId !== 31337) {
  // What is sent is what the repository holds: nothing under src/, the compiler settings or the build record may be uncommitted.
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dirty = execSync('git status --porcelain -- ../src ../hardhat.config.ts ../evidence/CreditDesk.build.json', { encoding: 'utf8', cwd: here }).trim();
  if (dirty.length > 0) fail(`uncommitted changes under contracts/src, hardhat.config.ts or the build record:\n${dirty}\ncommit them (and re-record the build if the source moved) before deploying to a public chain`);
  console.error(`repository at ${execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: here }).trim().slice(0, 10)}; build record at ${String(build!.commit).slice(0, 10)}, source at ${String(build!.sourceCommit).slice(0, 10)}`);
}
if (build!.deployedBytecode.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) fail(`the compiled CreditDesk is not the committed build record (commit ${build!.commit.slice(0, 10)}); rebuild and re-record, or check out the recorded commit, before deploying`);
console.error(`the artifact is the committed build at ${build!.commit.slice(0, 10)}`);
const out = new URL(`../evidence/deployments/credit-desk.${record.chainId}.json`, import.meta.url);
if (existsSync(out)) {
  if (!dryRun) fail(`${fileURLToPath(out)} already exists: a desk was deployed from this record before. Read it; if a second desk is really wanted, move that file aside first`);
  console.error(`note: ${fileURLToPath(out)} already exists; a real run would be refused until it is moved aside`);
}
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
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
// An unfunded deployer is a refusal here, not a transport error from inside the send.
const balance = await ask('getBalance(deployer)', () => pub.getBalance({ address: account.address }));
if (balance === 0n) fail(`the deployer ${account.address} holds no ETH on chain ${chainId}; nothing was sent`);
console.error(`deployer ${account.address} · ${balance} wei`);

const hash = await ask('the deployment', () => wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: ctor as never }));
console.error(`sent ${hash}; waiting for the receipt`);
// The hash is written down before the receipt is waited for, so a cut-off here leaves a note, not a second deployment on the next run.
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify({ record, pending: { transactionHash: hash, deployer: account.address, sentAt: new Date().toISOString(), note: 'sent; the receipt was not yet read when this was written' } }, null, 2)}\n`);
const receipt = await ask(`the receipt of ${hash}`, () => pub.waitForTransactionReceipt({ hash }));
if (!receipt.contractAddress || receipt.status !== 'success') fail(`the deployment transaction did not succeed: status ${receipt.status}`);
const address = receipt.contractAddress!;
const block = Number(receipt.blockNumber);
console.error(`deployed the credit desk at ${address} in block ${block}`);

const env = { network: record.network, token: record.token, desk: address, treasury: record.treasury, fromBlock: block, priceSource: record.priceSource };
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify({ record, deployment: { address, block, transactionHash: hash, deployer: account.address, at: new Date().toISOString() }, constructorArguments: ctor, env }, null, 2)}\n`);
console.error(`written ${fileURLToPath(out)}`);
// The only line on stdout: the env the site needs (priceSource null until the pool exists).
console.log(JSON.stringify(env));
