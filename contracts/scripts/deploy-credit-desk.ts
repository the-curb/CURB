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
 *   - public treasuries must match a reviewed Safe record, including
 *     quorum, singleton, modules, guard and fallback handler at one block;
 *   - current source is compiled and both creation/runtime bytes checked;
 *   - the deployer nonce and expected address are persisted before send;
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
import { execFileSync } from 'node:child_process';
import { createPublicClient, createWalletClient, getContractAddress, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseArgs } from './lib/args.ts';
import { describeError, endpointHost } from './lib/node.ts';
import { safeAbi } from './lib/safe.ts';
import { validateOperatorSafeExpectation, verifyOperatorSafe, type OperatorSafeExpectation } from './lib/operator-safe.ts';
import { assertLoopbackRpc } from './lib/local-chain.ts';
import { assertRecordedSourceCommit, buildCurrentContracts, currentSourceCommit } from './lib/build-provenance.mjs';
import { journaledDeployment } from './lib/journaled-deployment.mjs';
import { poolIdOf, validatePoolKey, V4_TOPICS, type V4PoolKey } from '../../lib/chain/uniswap-v4.ts';

interface DeskRecord {
  readonly network: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly token: Address;
  readonly decimals: number;
  readonly treasury: Address;
  /** Required for public chains. null/absent permits an EOA only on loopback chain 31337. */
  readonly treasurySafe?: OperatorSafeExpectation | null;
  /** The pool, when it exists; `fromBlock` is the block it was created in, read from the chain — a top-up before it is priced at the head when indexed. */
  readonly priceSource:
    | { readonly kind: 'uniswap-v2-pair' | 'uniswap-v3-pool'; readonly pair: Address; readonly fromBlock?: number | null; readonly quote: { readonly kind: 'usd-stable' } | { readonly kind: 'chainlink-feed'; readonly feed: Address } }
    /** A v4 pool: no address; the manager its events come from, the lens its state is read through, and the key its id is derived from. fromBlock is the block of its Initialize. */
    | { readonly kind: 'uniswap-v4-pool'; readonly poolManager: Address; readonly stateView: Address; readonly key: V4PoolKey; readonly poolId?: string; readonly fromBlock?: number | null; readonly quote: { readonly kind: 'usd-stable' } | { readonly kind: 'chainlink-feed'; readonly feed: Address } }
    | null;
  /** Who reviewed this record and when; empty means it was not reviewed and it will not be sent. */
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

function fail(why: string): never {
  console.error(`refused: ${why}`);
  process.exit(1);
}

/**
 * Did the pool emit anything before `top`? One query over [0, top] on a node
 * that serves any width — a refusal for matching too much is itself the
 * answer: logs exist there. On a node that caps a query's width, pages of
 * the width it serves, walked down from `top`, at most 64 of them; the
 * answer then says how far down it looked.
 */
const WIDTH_CAP = /block range|ranges? over \d+ blocks|range too (?:large|wide)|narrower (?:fromBlock|range)/i;
const CONTENT_CAP = /exceeds limit|too many|query returned more than|response size/i;
/** The node's own way of giving up on a query that matched too much (Robinhood Chain's public node on wide PoolManager queries, 17 September 2026): halved, like a width cap. */
const NODE_TIMEOUT = /log query timed out|context deadline exceeded|query timed? ?out/i;
async function logBefore(address: Address, top: number, topics: readonly Hex[] = []): Promise<{ block: number | null; coveredFrom: number }> {
  // viem puts the node's own words in `details`, not on the message's first line (which is its own summary); both are read, the URL-carrying meta lines are not.
  const message = (cause: unknown) => (cause instanceof Error ? [cause.message.split('\n')[0]!, (cause as { details?: unknown }).details].filter((x): x is string => typeof x === 'string' && x !== '').join(' — ') : 'unknown');
  const earliest = (logs: { blockNumber: bigint | null }[]) => logs.map((l) => Number(l.blockNumber)).reduce((a, b) => Math.min(a, b));
  // A pair or a v3 pool: any log of its address. A v4 pool: its own Initialize by id on the manager, which emits every pool's logs and would otherwise answer thousands.
  const query = topics.length === 0 ? {} : { event: { type: 'event' as const, name: 'Initialize', inputs: [{ type: 'bytes32', name: 'id', indexed: true }, { type: 'address', name: 'currency0', indexed: true }, { type: 'address', name: 'currency1', indexed: true }, { type: 'uint24', name: 'fee' }, { type: 'int24', name: 'tickSpacing' }, { type: 'address', name: 'hooks' }, { type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24', name: 'tick' }] }, args: { id: topics[1] } };
  try {
    const logs = await pub.getLogs({ address, fromBlock: 0n, toBlock: BigInt(top), ...query });
    return { block: logs.length === 0 ? null : earliest(logs), coveredFrom: 0 };
  } catch (cause) {
    const m = message(cause);
    if (CONTENT_CAP.test(m) && !WIDTH_CAP.test(m) && !NODE_TIMEOUT.test(m)) return { block: top, coveredFrom: 0 };
    if (!WIDTH_CAP.test(m) && !NODE_TIMEOUT.test(m)) fail(`the node at ${host} would not serve the pool's logs for blocks 0–${top}: ${m}`);
  }
  let width = top + 1;
  let hi = top;
  for (let i = 0; i < 64; i += 1) {
    const lo = Math.max(0, hi - width + 1);
    try {
      const logs = await pub.getLogs({ address, fromBlock: BigInt(lo), toBlock: BigInt(hi), ...query });
      if (logs.length > 0) return { block: earliest(logs), coveredFrom: lo };
      if (lo === 0) return { block: null, coveredFrom: 0 };
      hi = lo - 1;
    } catch (cause) {
      const m = message(cause);
      if (width <= 25) fail(`the node at ${host} would not serve the pool's logs for blocks ${lo}–${hi}: ${m}`);
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
    return fail(`the node at ${host} did not answer ${what}: ${describeError(cause, rpcUrl)}; nothing was sent`);
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
/** The v4 pool's id, derived from the record's key — never taken from the record's own poolId, which is only checked against it. */
let v4PoolId: Hex | null = null;
if (record.priceSource !== null) {
  const ps = record.priceSource;
  if (ps.kind === 'uniswap-v4-pool') {
    if (!isAddress(ps.poolManager) || !isAddress(ps.stateView)) fail('a uniswap-v4-pool needs poolManager and stateView addresses');
    const checked = validatePoolKey(ps.key);
    if ('error' in checked) fail(`priceSource.${checked.error}`);
    if (checked.key.currency0 !== record.token.toLowerCase() && checked.key.currency1 !== record.token.toLowerCase()) fail(`priceSource.key names ${checked.key.currency0} and ${checked.key.currency1}, neither of which is the token`);
    v4PoolId = poolIdOf(checked.key) as Hex;
    if (ps.poolId !== undefined && ps.poolId !== null && (typeof ps.poolId !== 'string' || ps.poolId.toLowerCase() !== v4PoolId)) fail(`priceSource.poolId ${String(ps.poolId)} is not keccak256 of the encoded key (${v4PoolId}); the key and the id name different pools`);
    const quoteCurrency = checked.key.currency0 === record.token.toLowerCase() ? checked.key.currency1 : checked.key.currency0;
    if (/^0x0{40}$/.test(quoteCurrency) && ps.quote.kind === 'usd-stable') fail('the quote currency is native ETH, which is not a dollar: priceSource.quote must be a chainlink-feed for ETH / USD');
    if (typeof ps.fromBlock !== 'number' || !Number.isInteger(ps.fromBlock) || ps.fromBlock < 0) fail('a uniswap-v4-pool needs priceSource.fromBlock: the block of its Initialize, read from the chain');
  } else {
    if ((ps.kind !== 'uniswap-v2-pair' && ps.kind !== 'uniswap-v3-pool') || !isAddress(ps.pair)) fail('priceSource must be a uniswap-v2-pair or a uniswap-v3-pool with the pool address, a uniswap-v4-pool with its key, or null until the pool exists');
    if (ps.fromBlock !== undefined && ps.fromBlock !== null && (!Number.isInteger(ps.fromBlock) || ps.fromBlock < 0)) fail('priceSource.fromBlock must be the block the pool was created in (a non-negative integer), or absent');
  }
  if (ps.quote.kind !== 'usd-stable' && !(ps.quote.kind === 'chainlink-feed' && isAddress(ps.quote.feed))) fail('priceSource.quote must be usd-stable or a chainlink-feed with a feed address');
}
if (record.chainId !== 31337 && !reviewedFlag) fail(`chain id ${record.chainId} is not a local chain and needs --reviewed on top of the record’s own review`);
if (record.chainId === 31337 && reviewedFlag) console.error('note: --reviewed is not needed for a local chain');
if (record.chainId !== 31337 || record.treasurySafe != null) {
  try { validateOperatorSafeExpectation(record.treasurySafe, record.chainId); } catch (cause) { fail(`treasury verification: ${cause instanceof Error ? cause.message : 'invalid Safe expectation'}`); }
}

/** The operator's own endpoint for the profile, read from the environment like every other tool and the site (lib/chain/networks.ts); the record keeps naming the public one, and a keyed URL is never printed. */
const RPC_ENV: Record<string, string> = { 'robinhood-mainnet': 'CURB_RPC_URL', 'robinhood-testnet': 'CURB_RPC_URL_TESTNET', 'ethereum-mainnet': 'CURB_RPC_URL_ETHEREUM', 'ethereum-sepolia': 'CURB_RPC_URL_SEPOLIA', 'hardhat-local': 'CURB_RPC_URL_LOCAL' };
const rpcUrl = process.env[RPC_ENV[record.network]!] || record.rpcUrl;
const host = endpointHost(rpcUrl, fail);
if (record.chainId === 31337) {
  try { assertLoopbackRpc(rpcUrl); } catch { fail('a local-chain rehearsal requires an uncredentialed loopback RPC'); }
}
console.error(`node: ${host}${rpcUrl === record.rpcUrl ? ' (the record’s)' : ` (${RPC_ENV[record.network]} from the environment)`}`);
const chain = { id: record.chainId, name: `chain ${record.chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } as const;
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const erc20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)']);

// ── the chain ─────────────────────────────────────────────────────────────
const chainId = await pub.getChainId().catch((cause: unknown) => fail(`the node at ${host} did not answer: ${describeError(cause, rpcUrl)}; nothing was sent`));
if (chainId !== record.chainId) fail(`the node answers chain id ${chainId}; the record says ${record.chainId}`);
let treasuryAsRead = null;
if (record.treasurySafe != null) {
  try {
    treasuryAsRead = await verifyOperatorSafe(record.treasury, record.treasurySafe, record.chainId, {
      chainId: () => pub.getChainId(), blockNumber: () => pub.getBlockNumber(),
      code: (address, blockNumber) => pub.getCode({ address, blockNumber }),
      owners: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getOwners', blockNumber }),
      threshold: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getThreshold', blockNumber }),
      singleton: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'masterCopy', blockNumber }),
      version: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'VERSION', blockNumber }),
      modules: (address, start, pageSize, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getModulesPaginated', args: [start, pageSize], blockNumber }),
      storage: (address, slot, blockNumber) => pub.getStorageAt({ address, slot, blockNumber }),
    });
  } catch { fail('the treasury Safe did not match its complete reviewed expectations or could not be read; nothing was sent'); }
  console.error(`treasury Safe: ${record.treasury} · ${treasuryAsRead.threshold}-of-${treasuryAsRead.owners.length} · proxy, singleton, modules, guard and fallback match · block ${treasuryAsRead.blockNumber}`);
} else {
  console.error('local rehearsal only: no public treasury Safe verification was requested');
}
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
if (record.priceSource !== null && record.priceSource.kind === 'uniswap-v4-pool' && v4PoolId !== null) {
  const ps = record.priceSource;
  // The manager and the lens must have code, and the lens must answer for this manager: a lens for another manager reads another pool's storage.
  const [managerCode, lensCode] = await Promise.all([ask('getCode(poolManager)', () => pub.getCode({ address: ps.poolManager })), ask('getCode(stateView)', () => pub.getCode({ address: ps.stateView }))]);
  if (!managerCode || managerCode === '0x') fail(`the PoolManager at ${ps.poolManager} has no code on chain ${chainId}`);
  if (!lensCode || lensCode === '0x') fail(`the StateView at ${ps.stateView} has no code on chain ${chainId}`);
  const lensAbi = parseAbi(['function poolManager() view returns (address)', 'function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)', 'function getLiquidity(bytes32) view returns (uint128)']);
  const lensManager = await pub.readContract({ address: ps.stateView, abi: lensAbi, functionName: 'poolManager' }).catch(() => null);
  if (lensManager === null || String(lensManager).toLowerCase() !== ps.poolManager.toLowerCase()) fail(`the StateView at ${ps.stateView} answers poolManager() = ${lensManager ?? 'nothing'}, not the record's ${ps.poolManager}`);
  // The pool's Initialize must sit in fromBlock, state the record's key, and be the only log of this id before it.
  const head = Number(await ask('eth_blockNumber', () => pub.getBlockNumber()));
  if (ps.fromBlock! > head) fail(`priceSource.fromBlock ${ps.fromBlock} is past the head (${head})`);
  const initAbi = { type: 'event' as const, name: 'Initialize', inputs: [{ type: 'bytes32', name: 'id', indexed: true }, { type: 'address', name: 'currency0', indexed: true }, { type: 'address', name: 'currency1', indexed: true }, { type: 'uint24', name: 'fee' }, { type: 'int24', name: 'tickSpacing' }, { type: 'address', name: 'hooks' }, { type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24', name: 'tick' }] };
  const at = await ask(`getLogs(Initialize, ${v4PoolId.slice(0, 10)}…) at block ${ps.fromBlock}`, () => pub.getLogs({ address: ps.poolManager, event: initAbi, args: { id: v4PoolId! }, fromBlock: BigInt(ps.fromBlock!), toBlock: BigInt(ps.fromBlock!) }));
  if (at.length !== 1) fail(`${at.length === 0 ? 'no' : at.length} Initialize for pool id ${v4PoolId} in block ${ps.fromBlock}; fromBlock must be the block the pool was initialised in`);
  const init = at[0]!.args as { currency0?: Address; currency1?: Address; fee?: number; tickSpacing?: number; hooks?: Address; sqrtPriceX96?: bigint };
  const key = ps.key;
  if (String(init.currency0).toLowerCase() !== key.currency0.toLowerCase() || String(init.currency1).toLowerCase() !== key.currency1.toLowerCase() || Number(init.fee) !== key.fee || Number(init.tickSpacing) !== key.tickSpacing || String(init.hooks).toLowerCase() !== key.hooks.toLowerCase()) {
    fail(`the Initialize in block ${ps.fromBlock} states currencies ${init.currency0}/${init.currency1}, fee ${init.fee}, tick spacing ${init.tickSpacing}, hook ${init.hooks}; the record's key differs`);
  }
  const before = ps.fromBlock === 0 ? { block: null, coveredFrom: 0 } : await logBefore(ps.poolManager, ps.fromBlock! - 1, [V4_TOPICS.initialize as Hex, v4PoolId]);
  if (before.block !== null) fail(`an Initialize for this pool id exists in block ${before.block}, before priceSource.fromBlock ${ps.fromBlock}`);
  const [slot0, liquidity] = await Promise.all([
    pub.readContract({ address: ps.stateView, abi: lensAbi, functionName: 'getSlot0', args: [v4PoolId] }).catch(() => null),
    pub.readContract({ address: ps.stateView, abi: lensAbi, functionName: 'getLiquidity', args: [v4PoolId] }).catch(() => null),
  ]);
  if (slot0 === null || liquidity === null) fail(`the StateView does not answer getSlot0/getLiquidity for pool id ${v4PoolId}`);
  const sqrtNow = (slot0 as readonly [bigint, number, number, number])[0];
  if (sqrtNow === 0n) fail(`the pool ${v4PoolId} has no price yet (sqrtPriceX96 0); it is not read until it has one`);
  if ((liquidity as bigint) === 0n) fail(`the pool ${v4PoolId} holds no liquidity now; a price nobody can trade at is not a price, and the record is not sent until it has some`);
  if (ps.quote.kind === 'chainlink-feed') {
    const feedAbi = parseAbi(['function decimals() view returns (uint8)', 'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
    const [fd, round] = await Promise.all([pub.readContract({ address: ps.quote.feed, abi: feedAbi, functionName: 'decimals' }).catch(() => null), pub.readContract({ address: ps.quote.feed, abi: feedAbi, functionName: 'latestRoundData' }).catch(() => null)]);
    if (fd === null || round === null) fail(`the feed at ${ps.quote.feed} does not answer decimals() and latestRoundData()`);
  }
  const quoteSide = key.currency0.toLowerCase() === record.token.toLowerCase() ? key.currency1 : key.currency0;
  console.error(`pool: v4 id ${v4PoolId} in manager ${ps.poolManager} · initialised in block ${ps.fromBlock} (sqrtPriceX96 ${init.sqrtPriceX96}) · fee ${key.fee} · tick spacing ${key.tickSpacing} · hook ${key.hooks} · holds the token against ${quoteSide}${/^0x0{40}$/i.test(quoteSide) ? ' (native ETH)' : ''} · sqrtPriceX96 now ${sqrtNow} · liquidity now ${liquidity} · quote ${ps.quote.kind}`);
} else if (record.priceSource !== null && record.priceSource.kind !== 'uniswap-v4-pool') {
  const v23 = record.priceSource;
  const pairCode = await ask('getCode(pool)', () => pub.getCode({ address: v23.pair }));
  if (!pairCode || pairCode === '0x') fail(`the pool at ${v23.pair} has no code on chain ${chainId}`);
  // The pool must hold the token on one side, and a feed-priced quote must answer as a feed.
  const poolAbi = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)']);
  const [t0, t1] = await Promise.all([
    pub.readContract({ address: v23.pair, abi: poolAbi, functionName: 'token0' }).catch(() => null),
    pub.readContract({ address: v23.pair, abi: poolAbi, functionName: 'token1' }).catch(() => null),
  ]);
  if (t0 === null || t1 === null) fail(`the pool at ${v23.pair} does not answer token0() and token1()`);
  const sides = [String(t0).toLowerCase(), String(t1).toLowerCase()];
  if (!sides.includes(record.token.toLowerCase())) fail(`the pool at ${v23.pair} holds ${t0} and ${t1}, neither of which is the token`);
  if (v23.quote.kind === 'chainlink-feed') {
    const feedAbi = parseAbi(['function decimals() view returns (uint8)', 'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
    const [fd, round] = await Promise.all([
      pub.readContract({ address: v23.quote.feed, abi: feedAbi, functionName: 'decimals' }).catch(() => null),
      pub.readContract({ address: v23.quote.feed, abi: feedAbi, functionName: 'latestRoundData' }).catch(() => null),
    ]);
    if (fd === null || round === null) fail(`the feed at ${v23.quote.feed} does not answer decimals() and latestRoundData()`);
  }
  // fromBlock — the block the pool was created in — decides which top-ups are priced at the head instead of at their own block, so it is not taken on anyone's word: the pool's first log is found, and fromBlock may not be later than it.
  if (typeof v23.fromBlock === 'number') {
    const head = Number(await ask('eth_blockNumber', () => pub.getBlockNumber()));
    if (v23.fromBlock > head) fail(`priceSource.fromBlock ${v23.fromBlock} is past the head (${head})`);
    const before = v23.fromBlock === 0 ? { block: null, coveredFrom: 0 } : await logBefore(v23.pair, v23.fromBlock - 1);
    if (before.block !== null) fail(`priceSource.fromBlock ${v23.fromBlock} is later than a log the pool emitted in block ${before.block}; the pool existed before that block, and a top-up between the two would be priced at the head instead of at its own block`);
    console.error(before.coveredFrom === 0 ? `pool: no log before block ${v23.fromBlock}; fromBlock is at or before the pool's first` : `pool: no log in blocks ${before.coveredFrom}–${v23.fromBlock - 1} (this endpoint caps a query's width; the span below was not read — the public node reads it whole)`);
  } else {
    console.error('note: priceSource.fromBlock is absent — a top-up the pool has no price event for waits instead of going to the head; read the creation block from the chain and add it');
  }
  console.error(`pool: ${v23.pair} · code present · holds the token against ${sides.find((x) => x !== record.token.toLowerCase())} · quote ${v23.quote.kind}`);
} else {
  console.error('pool: none in the record; the CURB_CREDITS line will need priceSource filled when the pool exists');
}

try { buildCurrentContracts(); } catch { fail('current contract source could not be compiled; no artifact is trusted and nothing was sent'); }
const artifact = JSON.parse(readFileSync(new URL('../artifacts/src/CreditDesk.sol/CreditDesk.json', import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex; deployedBytecode: Hex };
// What is sent must be what the site verifies against: the committed build record. A stale artifact or a stale record is refused here, not found by a DARK condition later.
let build: { deployedBytecode: string; creationBytecode?: string; commit?: string; workingTreeClean?: boolean; sourceCommit?: string | null };
try {
  build = JSON.parse(readFileSync(new URL('../evidence/CreditDesk.build.json', import.meta.url), 'utf8')) as typeof build;
} catch {
  build = fail('evidence/CreditDesk.build.json is missing or invalid; record the freshly compiled CreditDesk build before deploying');
}
if (typeof build?.deployedBytecode !== 'string' || build.deployedBytecode.toLowerCase() !== artifact.deployedBytecode.toLowerCase() || build.creationBytecode?.toLowerCase() !== artifact.bytecode.toLowerCase()) fail('the compiled CreditDesk does not match both creation and runtime bytecode in its build record; rebuild and record this source before deploying');
if (record.chainId !== 31337) {
  try { assertRecordedSourceCommit(build, currentSourceCommit('../src/CreditDesk.sol')); } catch { fail('the CreditDesk build sourceCommit does not match clean current committed source and compiler settings; pin and record it before public deployment'); }
  // Pin tooling as well as contract bytes: an uncommitted deployment path has not been reviewed with the release.
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dirty = execFileSync('git', ['status', '--porcelain', '--', '../src', '../hardhat.config.ts', '../evidence/CreditDesk.build.json', './deploy-credit-desk.ts', '../../lib/chain/uniswap-v4.ts', './record-token.ts', './lib', '../../lib/chain/keccak.ts'], { encoding: 'utf8', cwd: here }).trim();
  if (dirty) fail('contract source, compiler settings, build record or deployment tooling has uncommitted changes; pin and review the release before public deployment');
  console.error(`repository at ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: here }).trim().slice(0, 10)}; build source at ${String(build.sourceCommit).slice(0, 10)}`);
}
console.error(`fresh creation and runtime bytecode match the build record; source ${build.sourceCommit ?? 'unattributed local rehearsal'}`);
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

const nonce = await ask('getTransactionCount(deployer)', () => pub.getTransactionCount({ address: account.address, blockTag: 'pending' }));
const expectedAddress = getContractAddress({ from: account.address, nonce: BigInt(nonce) });
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
const buildAsRecorded = { sourceCommit: build.sourceCommit ?? null, workingTreeClean: build.workingTreeClean === true, recordedAtCommit: build.commit ?? null };
const { hash, receipt } = await journaledDeployment(out, { record, treasuryAsRead, buildAsRecorded, pending: { deployer: account.address, nonce, expectedAddress, preparedAt: new Date().toISOString() } }, async () => {
  const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: ctor as never, nonce });
  console.error(`sent ${hash}; recording the hash before waiting for the receipt`);
  return hash;
}, (hash: Hex) => pub.waitForTransactionReceipt({ hash })).catch(() => fail('deployment outcome is unconfirmed or an intent already exists; preserve and reconcile the journal, deployer nonce and expected address before any retry'));
if (!receipt.contractAddress || receipt.status !== 'success') fail(`the deployment transaction did not succeed: status ${receipt.status}`);
if (receipt.contractAddress.toLowerCase() !== expectedAddress.toLowerCase()) fail('the receipt address differs from the prepared deployer nonce; the pending journal is retained for investigation');
const address = receipt.contractAddress!;
const block = Number(receipt.blockNumber);
console.error(`deployed the credit desk at ${address} in block ${block}`);

const env = { network: record.network, token: record.token, desk: address, treasury: record.treasury, fromBlock: block, priceSource: record.priceSource };
mkdirSync(new URL('../evidence/deployments/', import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify({ record, treasuryAsRead, buildAsRecorded, deployment: { address, block, transactionHash: hash, deployer: account.address, nonce, expectedAddress, at: new Date().toISOString() }, constructorArguments: ctor, env }, null, 2)}\n`, { flush: true });
console.error(`written ${fileURLToPath(out)}`);
// The only line on stdout: the env the site needs (priceSource null until the pool exists).
console.log(JSON.stringify(env));
