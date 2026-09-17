/**
 * Where a launch stands on the venue — LAUNCH.md's watch between the
 * launch and the graduation. Read only; sends nothing.
 *
 *   node scripts/pons-status.ts <token> [--network robinhood-mainnet]
 *
 * Prints the factory's record of the token (phase, curve, pair, fee
 * recipient, the terms snapshotted at launch), and while the token is on
 * its curve, the curve's own figures: the quote collected so far against
 * the graduation threshold, the tokens still sellable, whether it is ready
 * to graduate. A curve that does not answer these is said to be one this
 * tool cannot read — the per-launch curves are not verified on Sourcify —
 * not guessed at. Nothing here is a price the desk quotes: the curve is
 * not read by the desk (the token record's rule 5).
 */

import { createPublicClient, http, type Address } from 'viem';
import { address, parseArgs } from './lib/args.ts';
import { NATIVE, PHASES, PONS_V2, curveAbi, erc20Abi, factoryAbi } from './lib/pons-v2.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

const fail: (why: string) => never = (why) => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), ['network'], fail);
if (positionals.length !== 1) fail('usage: node scripts/pons-status.ts <token> [--network robinhood-mainnet]');
const token = address(positionals[0]!, 'token', fail);
const networkName = flags.network ?? 'robinhood-mainnet';
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
console.error(`node: ${new URL(network!.rpc).host}`);

async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    return fail(`the node at ${new URL(network!.rpc).host} did not answer ${what}: ${cause instanceof Error ? [cause.message.split('\n')[0], (cause as { details?: unknown }).details].filter((x) => typeof x === 'string' && x !== '').join(' — ') : 'unknown'}`);
  }
}
/** A read the curve may not answer (its source is not verified): null, said so, never guessed. */
const maybe = async <T>(call: () => Promise<T>): Promise<T | null> => call().catch(() => null);

const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
const block = await ask('eth_blockNumber', () => pub.getBlockNumber());
const at = { blockNumber: block } as const;
const factory = PONS_V2.factory;
const info = await ask('getLaunchedToken(token)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token], ...at }));
if (!info.exists) fail(`the factory ${factory} has no launch for ${token} on chain ${chainId}`);
const [name, symbol, decimals, supply, policy] = await Promise.all([
  ask('name()', () => pub.readContract({ address: token, abi: erc20Abi, functionName: 'name', ...at })),
  ask('symbol()', () => pub.readContract({ address: token, abi: erc20Abi, functionName: 'symbol', ...at })),
  ask('decimals()', () => pub.readContract({ address: token, abi: erc20Abi, functionName: 'decimals', ...at })),
  ask('totalSupply()', () => pub.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply', ...at })),
  ask('getLaunchFeePolicy(token)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchFeePolicy', args: [token], ...at })),
]);
const phase = PHASES[info.phase] ?? `unknown (${info.phase})`;

let curve: Record<string, unknown> | null = null;
if (info.phase === 0) {
  const c = info.curve as Address;
  const [ready, realQuote, sellable, reserved, tokenReserve, reserves, feeBps, native] = await Promise.all([
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'readyToGraduate', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'realQuoteReserve', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'sellableTokens', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'reservedTokens', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'tokenReserve', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'getReserves', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'feeBps', ...at })),
    maybe(() => pub.readContract({ address: c, abi: curveAbi, functionName: 'isNativeQuote', ...at })),
  ]);
  const threshold = info.graduationThreshold;
  curve = {
    address: c,
    answers: ready !== null && realQuote !== null,
    readyToGraduate: ready,
    realQuoteReserve: realQuote === null ? null : realQuote.toString(),
    graduationThreshold: threshold.toString(),
    progressBps: realQuote === null || threshold === 0n ? null : Number((realQuote * 10_000n) / threshold),
    sellableTokens: sellable === null ? null : sellable.toString(),
    reservedTokens: reserved === null ? null : reserved.toString(),
    tokenReserve: tokenReserve === null ? null : tokenReserve.toString(),
    reserves: reserves === null ? null : { quoteWithPhantom: reserves[0].toString(), tokens: reserves[1].toString() },
    feeBps: feeBps === null ? null : feeBps.toString(),
    isNativeQuote: native,
    note: ready === null || realQuote === null ? 'the curve did not answer the reads this tool knows; its source is not verified and its interface may differ — read it on the explorer' : 'the desk does not read the curve; nothing here is a rate',
  };
}

const out = {
  network: networkName,
  chainId,
  block: Number(block),
  readAt: new Date().toISOString(),
  token: { address: token, name, symbol, decimals: Number(decimals), totalSupply: supply.toString() },
  launch: {
    phase,
    curve: info.curve,
    deployer: info.deployer,
    creatorFeeRecipient: info.creatorFeeRecipient,
    pairToken: info.pairToken,
    pair: info.pairToken.toLowerCase() === NATIVE ? 'native ETH' : info.pairToken,
    graduationThreshold: info.graduationThreshold.toString(),
    poolFee: info.poolFee,
    tickSpacing: info.tickSpacing,
    creatorTaxBps: info.creatorTaxBps,
    buybackEnabled: info.buybackEnabled,
    swept: info.phase >= 1 ? { quote: info.sweptQuote.toString(), tokens: info.sweptTokens.toString(), at: info.sweptAt.toString() } : null,
  },
  feePolicy: { protocolFeeRecipient: policy.protocolFeeRecipient, protocolFeeShareBps: policy.protocolFeeShareBps, buybackBurnBps: policy.buybackBurnBps, hookFeeBps: policy.hookFeeBps, maxInternalPriceImpactBps: policy.maxInternalPriceImpactBps },
  curve,
  explorer: network!.explorer ? `${network!.explorer}/address/${token}` : null,
  next: info.phase === 0 ? 'on the curve: nothing is quoted; when phase becomes PoolCreated, record the pool with pons-pool.ts' : info.phase === 1 ? 'swept, no pool yet: anyone may call createGraduatedPool(token) on the factory; then pons-pool.ts' : info.phase === 2 ? 'graduated: node scripts/pons-pool.ts <token> prints the priceSource for CURB_CREDITS' : 'rescued: the launch ended without a pool; the desk will never quote this token',
};
console.error(`${symbol} ${token} · phase ${phase} · pair ${out.launch.pair} · fee recipient ${info.creatorFeeRecipient} · creator tax ${info.creatorTaxBps} · buyback ${info.buybackEnabled}${curve !== null && curve.progressBps !== null ? ` · curve ${(Number(curve.progressBps) / 100).toFixed(2)}% of the way to graduation` : ''}`);
console.log(JSON.stringify(out));
