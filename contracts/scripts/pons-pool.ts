/**
 * The graduated pool, read into the record — LAUNCH.md rows 12 and 13's
 * input. Read only; sends nothing. Once the factory says a launch is in
 * phase PoolCreated, this finds the pool it created, checks the chain says
 * the same thing three ways, and prints the `priceSource` the desk's
 * record takes — nothing in it is typed in:
 *
 *   1. the factory's record of the launch: pair token, pool fee, tick
 *      spacing — and its hook and PoolManager;
 *   2. the key those make, sorted as the factory sorts, and the pool id
 *      derived from it;
 *   3. the factory's PoolGraduated for the token, and in the same block
 *      the PoolManager's Initialize for that id, stating that key; the
 *      Initialize's block is `fromBlock`;
 *   4. the StateView's answer for the id now — a price and liquidity.
 *
 *   node scripts/pons-pool.ts <token> [--network robinhood-mainnet]
 *
 * The quote: a native-ETH pair is priced by the chain's ETH / USD feed;
 * USDG is taken as dollars; any other pair token is refused here — the
 * record has no quote for it and none is invented.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { address, parseArgs } from './lib/args.ts';
import { describeError, endpointHost, isUnknownBlock, withOneRetry } from './lib/node.ts';
import { NATIVE, PHASES, PONS_V2, factoryAbi, graduatedPoolKey, poolIdOf } from './lib/pons-v2.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

const fail: (why: string) => never = (why) => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), ['network'], fail);
if (positionals.length !== 1) fail('usage: node scripts/pons-pool.ts <token> [--network robinhood-mainnet]');
const token = address(positionals[0]!, 'token', fail);
const networkName = flags.network ?? 'robinhood-mainnet';
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
const host = endpointHost(network!.rpc, fail);
console.error(`node: ${host}`);

async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await withOneRetry(call, isUnknownBlock);
  } catch (cause) {
    return fail(`the node at ${host} did not answer ${what}: ${describeError(cause, network!.rpc)}`);
  }
}

/**
 * A log the node may cap the query width for (the operator's keyed endpoint serves 100,000 blocks a query; the public node any width with few matches): walked down from the head in pages the node accepts, newest first, and stopped at the first page that answers with a log. A graduation is looked for from the head because it is recent when this runs.
 */
const WIDTH_CAP = /block range|ranges? over \d+ blocks|range too (?:large|wide)|narrower (?:fromBlock|range)|query timed out|context deadline exceeded/i;
async function newestLogs<T>(what: string, from: bigint, to: bigint, fetch: (from: bigint, to: bigint) => Promise<T[]>): Promise<{ logs: T[]; coveredFrom: bigint }> {
  let width = to - from + 1n;
  let hi = to;
  for (let i = 0; i < 4096; i += 1) {
    const lo = hi - width + 1n < from ? from : hi - width + 1n;
    try {
      const logs = await fetch(lo, hi);
      if (logs.length > 0) return { logs, coveredFrom: lo };
      if (lo <= from) return { logs: [], coveredFrom: from };
      hi = lo - 1n;
    } catch (cause) {
      const m = cause instanceof Error ? [cause.message.split('\n')[0], (cause as { details?: unknown }).details].filter((x) => typeof x === 'string').join(' ') : '';
      if (!WIDTH_CAP.test(m) || width <= 25n) fail(`the node at ${host} would not serve ${what} for blocks ${lo}–${hi}: ${m || 'unknown'}`);
      width = width / 2n;
    }
  }
  return fail(`${what}: too many pages`);
}

const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
const factory = PONS_V2.factory;
const head = await ask('eth_blockNumber', () => pub.getBlockNumber());

// 1. The launch as the factory records it.
const [info, hook, poolManager] = await Promise.all([
  ask('getLaunchedToken(token)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] })),
  ask('memeHook()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'memeHook' })),
  ask('poolManager()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'poolManager' })),
]);
if (!info.exists) fail(`the factory ${factory} has no launch for ${token} on chain ${chainId}`);
if (info.phase !== 2) fail(`the launch is in phase ${PHASES[info.phase] ?? info.phase}, not PoolCreated: there is no pool to record${info.phase === 1 ? ' — anyone may call createGraduatedPool(token) on the factory' : info.phase === 3 ? ' and never will be (rescued)' : ''}`);
if (chainId === PONS_V2.chainId && poolManager.toLowerCase() !== PONS_V2.poolManager.toLowerCase()) fail(`the factory's PoolManager is ${poolManager}, not Uniswap's recorded ${PONS_V2.poolManager}`);
const pair = info.pairToken as Address;
if (pair.toLowerCase() !== NATIVE && pair.toLowerCase() !== PONS_V2.usdg.toLowerCase()) fail(`the pair token is ${pair}: the record has a quote for native ETH (the ETH / USD feed) and for USDG (taken as dollars) only; another pair token needs its own recorded quote first`);

// 2. The key, and the id.
const key = graduatedPoolKey(token, pair, info.poolFee, info.tickSpacing, hook as Address);
const poolId = poolIdOf(key) as Hex;

// 3. The factory's PoolGraduated for the token, then the PoolManager's Initialize for the id in the same transaction, stating the key.
const graduatedEvent = parseAbi(['event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)'])[0];
const found = await newestLogs('PoolGraduated for the token', 0n, head, (lo, hi) => pub.getLogs({ address: factory, event: graduatedEvent, args: { token }, fromBlock: lo, toBlock: hi }));
const graduated = found.logs;
if (graduated.length !== 1) fail(`${graduated.length === 0 ? 'no' : graduated.length} PoolGraduated for ${token} from the factory${graduated.length === 0 ? ` in blocks ${found.coveredFrom}–${head}` : ''}; expected exactly one`);
const g = graduated[0]!;
const initEvent = parseAbi(['event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'])[0];
const initsInBlock = await ask(`getLogs(Initialize, ${poolId.slice(0, 10)}…) in block ${g.blockNumber}`, () => pub.getLogs({ address: poolManager as Address, event: initEvent, args: { id: poolId }, fromBlock: g.blockNumber, toBlock: g.blockNumber }));
// The factory initialises the pool in the call that emits PoolGraduated (createGraduatedPool, verified source): the Initialize is in that transaction, not merely that block.
const inits = initsInBlock.filter((l) => l.transactionHash === g.transactionHash);
if (inits.length !== 1) fail(`${inits.length === 0 ? 'no' : inits.length} Initialize for pool id ${poolId} in the graduation transaction ${g.transactionHash}${initsInBlock.length !== inits.length ? ` (${initsInBlock.length} in its block ${g.blockNumber})` : ''}; the key this tool derives (${JSON.stringify(key)}) may not be the pool the factory created — read the transaction on the explorer`);
const init = inits[0]!.args as { currency0?: Address; currency1?: Address; fee?: number; tickSpacing?: number; hooks?: Address; sqrtPriceX96?: bigint; tick?: number };
if (String(init.currency0).toLowerCase() !== key.currency0 || String(init.currency1).toLowerCase() !== key.currency1 || Number(init.fee) !== key.fee || Number(init.tickSpacing) !== key.tickSpacing || String(init.hooks).toLowerCase() !== key.hooks) {
  fail(`the Initialize states currencies ${init.currency0}/${init.currency1}, fee ${init.fee}, tick spacing ${init.tickSpacing}, hook ${init.hooks}; the key derived from the factory's record differs — nothing is written`);
}
// A pool is initialised once — the PoolManager reverts a second Initialize (PoolAlreadyInitialized, verified source) — so the one in the graduation block is the only one this id will ever have; the pages before it are read as far as the node serves in a few pages, and the desk's own creation check covers the rest, resumably, every tick.
const before = g.blockNumber === 0n ? { logs: [], coveredFrom: 0n } : await newestLogs('an earlier Initialize for the id', g.blockNumber > 400_000n ? g.blockNumber - 400_000n : 0n, g.blockNumber - 1n, (lo, hi) => pub.getLogs({ address: poolManager as Address, event: initEvent, args: { id: poolId }, fromBlock: lo, toBlock: hi }));
if (before.logs.length !== 0) fail(`an Initialize for pool id ${poolId} exists in block ${before.logs[0]!.blockNumber}, before the graduation; a pool is initialised once, so this id is not the graduation's pool`);

// 4. The lens, now.
const lensAbi = parseAbi(['function poolManager() view returns (address)', 'function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)', 'function getLiquidity(bytes32) view returns (uint128)']);
const stateView = PONS_V2.stateView;
const [lensManager, slot0, liquidity] = await Promise.all([
  ask('StateView.poolManager()', () => pub.readContract({ address: stateView, abi: lensAbi, functionName: 'poolManager' })),
  ask('StateView.getSlot0(id)', () => pub.readContract({ address: stateView, abi: lensAbi, functionName: 'getSlot0', args: [poolId] })),
  ask('StateView.getLiquidity(id)', () => pub.readContract({ address: stateView, abi: lensAbi, functionName: 'getLiquidity', args: [poolId] })),
]);
if (String(lensManager).toLowerCase() !== String(poolManager).toLowerCase()) fail(`the StateView ${stateView} answers for PoolManager ${lensManager}, not the factory's ${poolManager}`);
if (slot0[0] === 0n) fail(`the pool ${poolId} has no price (sqrtPriceX96 0)`);
if (liquidity === 0n) fail(`the pool ${poolId} holds no liquidity now; a price nobody can trade at is not a price`);

const quote = pair.toLowerCase() === NATIVE ? { kind: 'chainlink-feed' as const, feed: PONS_V2.ethUsdFeed } : { kind: 'usd-stable' as const };
const priceSource = { kind: 'uniswap-v4-pool' as const, poolManager: String(poolManager).toLowerCase(), stateView: stateView.toLowerCase(), key, poolId, fromBlock: Number(inits[0]!.blockNumber), quote };
const graduation = g.args as { positionId?: bigint; tokenAmount?: bigint; pairTokenAmount?: bigint };
const out = {
  _: `The graduated pool of ${token} as the chain states it: the factory record, the key derived as the factory sorts it, the Initialize in the graduation transaction stating that key, the lens now. priceSource is what a desk record for this token would take (LAUNCH.md rows 12–13); the desk's own record names The Curb's token, and a pool read for any other token is a rehearsal of the tool, nothing of The Curb's.`,
  chainId,
  token,
  readAt: new Date().toISOString(),
  head: Number(head),
  graduation: { block: Number(g.blockNumber), transactionHash: g.transactionHash, positionId: graduation.positionId?.toString() ?? null, tokenAmount: graduation.tokenAmount?.toString() ?? null, pairTokenAmount: graduation.pairTokenAmount?.toString() ?? null },
  initialize: { block: Number(inits[0]!.blockNumber), sqrtPriceX96: init.sqrtPriceX96?.toString() ?? null, tick: init.tick ?? null },
  now: { sqrtPriceX96: slot0[0].toString(), tick: slot0[1], protocolFee: slot0[2], lpFee: slot0[3], liquidity: liquidity.toString() },
  priceSource,
  explorer: network!.explorer ? `${network!.explorer}/tx/${g.transactionHash}` : null,
};
mkdirSync(new URL('../evidence/pons/', import.meta.url), { recursive: true });
const file = new URL(`../evidence/pons/pool.${chainId}.${token.toLowerCase()}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.error(`pool ${poolId} in ${poolManager}: graduated in block ${g.blockNumber}, initialised with sqrtPriceX96 ${init.sqrtPriceX96}, now ${slot0[0]} with liquidity ${liquidity} · key ${key.currency0}/${key.currency1} fee ${key.fee} spacing ${key.tickSpacing} hook ${key.hooks} · quote ${quote.kind}`);
console.error(`written ${fileURLToPath(file)}`);
// The only line on stdout: the priceSource, for the desk record and CURB_CREDITS.
console.log(JSON.stringify(priceSource));
