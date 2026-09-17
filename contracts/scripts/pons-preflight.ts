/**
 * The venue's live terms, read in one block and written down — LAUNCH.md's
 * step before the launch transaction. Read only; sends nothing; holds no
 * key. The product owner decided on 17 September 2026 that the CURB token
 * launches on PONS v2 (docs/decisions/TOKEN.md); every term the venue
 * publishes is editable by its owner, so the terms are read again here,
 * from the chain, immediately before a launch is prepared, and pinned: the
 * economics digest this prints is what the launch tool will demand the
 * factory still answers in the block it sends.
 *
 *   node scripts/pons-preflight.ts [--network robinhood-mainnet] [--launcher 0x…] [--pair 0x…]
 *
 * --launcher is the account that would send the launch (the deployer, or
 * the operator's Safe); --pair the pair token (omit for native ETH). One
 * JSON line on stdout with what was read and the block it was read at, and
 * the same into evidence/pons/preflight.<chainId>.<block>.json.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, type Address } from 'viem';
import { address, parseArgs } from './lib/args.ts';
import { describeError, endpointHost, isUnknownBlock, withOneRetry } from './lib/node.ts';
import { NATIVE, PONS_V2, erc20Abi, factoryAbi } from './lib/pons-v2.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545' },
};

const fail: (why: string) => never = (why) => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), ['network', 'launcher', 'pair'], fail);
if (positionals.length > 0) fail('this tool takes flags only');
const networkName = flags.network ?? 'robinhood-mainnet';
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);
const launcher = flags.launcher === undefined ? null : address(flags.launcher, '--launcher', fail);
const pair: Address = flags.pair === undefined ? NATIVE : address(flags.pair, '--pair', fail);

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
const host = endpointHost(network!.rpc, fail);
console.error(`node: ${host}`);

/** A node call that failed is a refusal naming the host and the first line of the cause, never a stack trace carrying a keyed URL. */
async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await withOneRetry(call, isUnknownBlock);
  } catch (cause) {
    return fail(`the node at ${host} did not answer ${what}: ${describeError(cause, network!.rpc)}`);
  }
}

const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
if (chainId !== PONS_V2.chainId) fail(`PONS v2 is recorded on chain ${PONS_V2.chainId}; this tool reads that chain only`);

// Every read at one block, so the record is of one moment.
const block = await ask('eth_blockNumber', () => pub.getBlockNumber());
const at = { blockNumber: block } as const;
const factory = PONS_V2.factory;
const code = await ask('getCode(factory)', () => pub.getCode({ address: factory, ...at }));
if (!code || code === '0x') fail(`no code at the factory ${factory} on chain ${chainId}`);
const read = <T>(what: string, call: () => Promise<T>) => ask(`${what} at block ${block}`, call);

const [launchEnabled, launchFee, configCount, memeHook, locker, poolManager, owner, maxCreatorTaxBps, snipeTaxSeconds, snipeTaxStartBps, rescueDelay] = await Promise.all([
  read('launchEnabled()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'launchEnabled', ...at })),
  read('launchFee()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'launchFee', ...at })),
  read('launchConfigCount()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'launchConfigCount', ...at })),
  read('memeHook()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'memeHook', ...at })),
  read('locker()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'locker', ...at })),
  read('poolManager()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'poolManager', ...at })),
  read('owner()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'owner', ...at })),
  read('maxCreatorTaxBps()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'maxCreatorTaxBps', ...at })),
  read('snipeTaxSeconds()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'snipeTaxSeconds', ...at })),
  read('snipeTaxStartBps()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'snipeTaxStartBps', ...at })),
  read('GRADUATION_RESCUE_DELAY()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'GRADUATION_RESCUE_DELAY', ...at })),
]);
if (memeHook.toLowerCase() !== PONS_V2.hook.toLowerCase()) fail(`the factory's hook is ${memeHook}, not the recorded ${PONS_V2.hook}; the venue has changed and the record must be read again before anything is launched`);
if (poolManager.toLowerCase() !== PONS_V2.poolManager.toLowerCase()) fail(`the factory's PoolManager is ${poolManager}, not Uniswap's recorded ${PONS_V2.poolManager}; the graduated pool would not be where the reader looks`);
if (configCount !== 1n) console.error(`note: the factory has ${configCount} launch configs; this tool reads config 0, the one every launch used on 17 September 2026`);
const config = await read('getLaunchConfig(0)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchConfig', args: [0n], ...at }));
if (!config.enabled) fail('launch config 0 is disabled');

const [approved, economics, digest, canLaunch, whitelisted] = await Promise.all([
  read('approvedPairTokens(pair)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'approvedPairTokens', args: [pair], ...at })),
  read('pairTokenEconomics(pair)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'pairTokenEconomics', args: [pair], ...at })),
  read('previewLaunchEconomics(0, pair)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'previewLaunchEconomics', args: [0n, pair], ...at })),
  launcher === null ? Promise.resolve(null) : read('canLaunch(launcher)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'canLaunch', args: [launcher], ...at })),
  launcher === null ? Promise.resolve(null) : read('whitelistedLaunchers(launcher)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'whitelistedLaunchers', args: [launcher], ...at })),
]);
if (pair !== NATIVE && !approved) fail(`${pair} is not an approved pair token; the factory refuses a launch paired with it (PairTokenNotApproved)`);
let pairSymbol: string | null = null;
let pairDecimals: number | null = null;
if (pair !== NATIVE) {
  [pairSymbol, pairDecimals] = await Promise.all([
    read('pair symbol()', () => pub.readContract({ address: pair, abi: erc20Abi, functionName: 'symbol', ...at })),
    read('pair decimals()', () => pub.readContract({ address: pair, abi: erc20Abi, functionName: 'decimals', ...at })).then(Number),
  ]);
  if (pairDecimals !== Number(economics[2])) fail(`the pair token answers ${pairDecimals} decimals; the factory's economics expect ${economics[2]}`);
}
if (!launchEnabled && launcher !== null && !whitelisted) fail(`public launching is closed on chain (launchEnabled false) and ${launcher} is not whitelisted; canLaunch answers ${canLaunch}`);
if (launcher !== null && !canLaunch) fail(`canLaunch(${launcher}) is false; the factory would refuse a launch from this account (NotWhitelisted)`);

const record = {
  _: 'PONS v2 terms as the chain answered them; every one is editable by the venue and is read again in the block a launch is sent',
  network: networkName,
  chainId,
  block: Number(block),
  readAt: new Date().toISOString(),
  factory,
  hook: memeHook,
  locker,
  poolManager,
  factoryOwner: owner,
  launchEnabled,
  launcher: launcher === null ? null : { address: launcher, canLaunch, whitelisted },
  launchFeeWei: launchFee.toString(),
  launchConfig: { id: 0, supply: config.supply.toString(), curveFeeBps: config.curveFeeBps.toString(), phantomQuote: config.phantomQuote.toString(), graduationThreshold: config.graduationThreshold.toString(), poolFee: config.poolFee, tickSpacing: config.tickSpacing, enabled: config.enabled },
  // A native-ETH launch takes its economics from the launch config; pairTokenEconomics(0x0) answers zeros.
  pair: pair === NATIVE ? { kind: 'native-eth', address: NATIVE, decimals: 18, phantomQuote: config.phantomQuote.toString(), graduationThreshold: config.graduationThreshold.toString() } : { kind: 'erc20', address: pair, symbol: pairSymbol, decimals: pairDecimals, phantomQuote: economics[0].toString(), graduationThreshold: economics[1].toString() },
  /** What the launch tool demands the factory still answers for (config 0, this pair) in the block it sends: a changed term is a refusal, not a surprise. */
  expectedEconomics: digest,
  maxCreatorTaxBps: Number(maxCreatorTaxBps),
  snipeTax: { seconds: snipeTaxSeconds.toString(), startBps: snipeTaxStartBps.toString() },
  graduationRescueDelaySeconds: rescueDelay.toString(),
};
const dir = new URL('../evidence/pons/', import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`../evidence/pons/preflight.${chainId}.${block}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
console.error(`launching ${launchEnabled ? 'open' : 'closed'} · fee ${launchFee} wei · config 0: ${config.phantomQuote} phantom, graduation at ${config.graduationThreshold}, pool fee ${config.poolFee}, tick spacing ${config.tickSpacing} · pair ${pair === NATIVE ? 'native ETH' : `${pairSymbol} ${pair}`} · economics ${digest}`);
console.error(`written ${fileURLToPath(file)}`);
console.log(JSON.stringify(record));
