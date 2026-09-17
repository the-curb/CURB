/**
 * The launch of the CURB token on PONS v2 — LAUNCH.md rows 3 and 4 — by
 * the same discipline as the desk's deployment tool: a record a person
 * reviewed, the venue's terms read again in the block the transaction is
 * sent and compared with what was pinned, a simulation before anything is
 * signed, the key only from the shell and never printed, the receipt read
 * back, the launched token read from the factory and compared with what
 * was asked, and everything written to evidence/pons/launch.<chainId>.json.
 *
 *   node scripts/pons-launch.ts <launch.json>                       # the checks and the simulation; nothing sent
 *   node scripts/pons-launch.ts <launch.json> --calldata            # …and the bytes for the operator's Safe to send (safe-tx.ts)
 *   node scripts/pons-launch.ts <launch.json> --send --reviewed     # …and the transaction, from DEPLOYER_PRIVATE_KEY
 *
 * The launch record (records/pons-launch.example.json is refused by design):
 *   { "network": "robinhood-mainnet", "name": "…", "symbol": "CURB", "logo": "…", "description": "…",
 *     "socials": { "twitter": "", "telegram": "", "discord": "", "website": "https://…", "farcaster": "" },
 *     "creatorFeeRecipient": "<the operator's Safe>", "creatorTaxBps": 0, "buybackEnabled": false,
 *     "pairToken": "0x0000000000000000000000000000000000000000", "launchConfigId": 0,
 *     "expectedEconomics": "<the digest pons-preflight.ts pinned>", "salt": "0x…32 bytes…",
 *     "reviewedBy": "…", "reviewedAt": "…" }
 *
 * What the token record decided (docs/decisions/TOKEN.md) is enforced, not
 * assumed: no creator tax, no buyback, the fee recipient is the treasury,
 * and the fee paid is exactly what the factory asks for. A record that
 * says otherwise is refused before the node is asked anything.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, http, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseArgs } from './lib/args.ts';
import { NATIVE, PHASES, PONS_V2, erc20Abi, factoryAbi } from './lib/pons-v2.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

const fail: (why: string) => never = (why) => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), [], fail, ['send', 'reviewed', 'calldata']);
if (positionals.length !== 1) fail('usage: node scripts/pons-launch.ts <launch.json> [--calldata] [--send --reviewed]');
const send = flags.send === 'true';
const wantCalldata = flags.calldata === 'true';
const reviewedFlag = flags.reviewed === 'true';

interface LaunchRecord {
  readonly network: string;
  readonly name: string;
  readonly symbol: string;
  readonly logo: string;
  readonly description: string;
  readonly socials: { readonly twitter: string; readonly telegram: string; readonly discord: string; readonly website: string; readonly farcaster: string };
  readonly creatorFeeRecipient: Address;
  readonly creatorTaxBps: number;
  readonly buybackEnabled: boolean;
  readonly pairToken: Address;
  readonly launchConfigId: number;
  readonly expectedEconomics: Hex;
  readonly salt: Hex;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

const recordPath = positionals[0]!;
if (/example/i.test(recordPath)) fail('the example record is an example; write the real one and name it differently');
let record: LaunchRecord;
try {
  record = JSON.parse(readFileSync(recordPath, 'utf8')) as LaunchRecord;
} catch (cause) {
  fail(`the record could not be read: ${cause instanceof Error ? cause.message : 'unknown'}`);
}
const network = NETWORKS[record.network];
if (!network) fail(`unknown network ${record.network}; one of ${Object.keys(NETWORKS).join(', ')}`);
for (const [field, v] of [['name', record.name], ['symbol', record.symbol], ['description', record.description]] as const) if (typeof v !== 'string' || v.trim() === '') fail(`the record's ${field} is empty`);
if (typeof record.logo !== 'string') fail('the record needs a logo string (an empty string is allowed)');
if (typeof record.socials !== 'object' || record.socials === null) fail('the record needs socials { twitter, telegram, discord, website, farcaster }, each a string (empty allowed)');
for (const k of ['twitter', 'telegram', 'discord', 'website', 'farcaster'] as const) if (typeof record.socials[k] !== 'string') fail(`socials.${k} must be a string`);
if (!isAddress(record.creatorFeeRecipient) || record.creatorFeeRecipient.toLowerCase() === NATIVE) fail('creatorFeeRecipient must be the operator treasury (the Safe), not the zero address');
if (record.creatorTaxBps !== 0) fail(`creatorTaxBps is ${record.creatorTaxBps}; the token record decides no creator tax (0)`);
if (record.buybackEnabled !== false) fail('buybackEnabled is not false; the token record decides no buyback');
if (!isAddress(record.pairToken)) fail('pairToken must be an address (the zero address for native ETH)');
if (!Number.isInteger(record.launchConfigId) || record.launchConfigId < 0) fail('launchConfigId must be a non-negative integer');
if (!/^0x[0-9a-fA-F]{64}$/.test(record.expectedEconomics) || /^0x0{64}$/.test(record.expectedEconomics)) fail('expectedEconomics must be the 32-byte digest pons-preflight.ts pinned; a zero digest waives the check and is refused');
if (!/^0x[0-9a-fA-F]{64}$/.test(record.salt)) fail('salt must be 32 bytes of hex');
if (!record.reviewedBy?.trim() || !record.reviewedAt?.trim()) fail('the record names no reviewer (reviewedBy, reviewedAt); it is not sent unreviewed');
if ((send || wantCalldata) && network!.chainId !== 31337 && !reviewedFlag) fail(`chain ${network!.chainId} is not a local chain and needs --reviewed on top of the record's own review`);
const evidence = new URL(`../evidence/pons/launch.${network!.chainId}.json`, import.meta.url);
if (send && existsSync(evidence)) fail(`${fileURLToPath(evidence)} already exists: a launch was sent from this tool on chain ${network!.chainId} before. Read it; a second token is not launched by accident`);

const chain = { id: network!.chainId, name: record.network, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
console.error(`node: ${new URL(network!.rpc).host}`);

async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    return fail(`the node at ${new URL(network!.rpc).host} did not answer ${what}: ${cause instanceof Error ? [cause.message.split('\n')[0], (cause as { details?: unknown }).details].filter((x) => typeof x === 'string' && x !== '').join(' — ') : 'unknown'}; nothing was sent`);
  }
}

const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the record says ${network!.chainId}`);
if (chainId !== PONS_V2.chainId && chainId !== 31337) fail(`PONS v2 is recorded on chain ${PONS_V2.chainId}`);
const factory = PONS_V2.factory;

// ── the sender: the key from the environment (never printed), or the Safe whose bytes are printed ──
const key = process.env.DEPLOYER_PRIVATE_KEY;
const account = key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as Hex) : null;
if (send && account === null) fail('DEPLOYER_PRIVATE_KEY is not set in the environment (a 32-byte hex key with 0x); nothing was sent');
const sender: Address = account?.address ?? record.creatorFeeRecipient;
console.error(`sender: ${account === null ? `${sender} (the fee recipient, for the calldata; nothing is signed here)` : sender}`);

// ── the venue's terms, in this block, against what was pinned ─────────────
const block = await ask('eth_blockNumber', () => pub.getBlockNumber());
const at = { blockNumber: block } as const;
const read = <T>(what: string, call: () => Promise<T>) => ask(`${what} at block ${block}`, call);
const [launchEnabled, canLaunch, launchFee, digest, hook, poolManager, config] = await Promise.all([
  read('launchEnabled()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'launchEnabled', ...at })),
  read('canLaunch(sender)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'canLaunch', args: [sender], ...at })),
  read('launchFee()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'launchFee', ...at })),
  read('previewLaunchEconomics()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'previewLaunchEconomics', args: [BigInt(record.launchConfigId), record.pairToken], ...at })),
  read('memeHook()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'memeHook', ...at })),
  read('poolManager()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'poolManager', ...at })),
  read('getLaunchConfig()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchConfig', args: [BigInt(record.launchConfigId)], ...at })),
]);
if (!canLaunch) fail(`canLaunch(${sender}) is false at block ${block}${launchEnabled ? '' : ' (public launching is closed on chain)'}; the factory would refuse`);
if (digest.toLowerCase() !== record.expectedEconomics.toLowerCase()) fail(`the venue's economics for config ${record.launchConfigId} and pair ${record.pairToken} are ${digest} at block ${block}, not the pinned ${record.expectedEconomics}: a term changed since the preflight; read it again (pons-preflight.ts) and review the record again`);
if (!config.enabled) fail(`launch config ${record.launchConfigId} is disabled`);
if (config.poolFee !== 0) fail(`launch config ${record.launchConfigId} creates pools with fee ${config.poolFee}; the desk's reader expects the venue's fee-0 pools (the hook takes its cut instead) — read the venue again`);
if (chainId === PONS_V2.chainId && hook.toLowerCase() !== PONS_V2.hook.toLowerCase()) fail(`the factory's hook is ${hook}, not the recorded ${PONS_V2.hook}`);
if (chainId === PONS_V2.chainId && poolManager.toLowerCase() !== PONS_V2.poolManager.toLowerCase()) fail(`the factory's PoolManager is ${poolManager}, not the recorded ${PONS_V2.poolManager}`);
if (record.pairToken !== NATIVE) {
  const approved = await read('approvedPairTokens(pair)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'approvedPairTokens', args: [record.pairToken], ...at }));
  if (!approved) fail(`${record.pairToken} is not an approved pair token at block ${block}`);
}
const treasuryCode = await read('getCode(creatorFeeRecipient)', () => pub.getCode({ address: record.creatorFeeRecipient, ...at }));
if ((!treasuryCode || treasuryCode === '0x') && chainId !== 31337) fail(`the fee recipient ${record.creatorFeeRecipient} has no code: the fee recipient is the operator's Safe, not a key`);
console.error(`venue at block ${block}: launching ${launchEnabled ? 'open' : 'closed'} · canLaunch(sender) true · fee ${launchFee} wei · economics pinned and unchanged · config ${record.launchConfigId}: ${config.phantomQuote} phantom, graduation ${config.graduationThreshold}, tick spacing ${config.tickSpacing}`);

// ── the transaction, simulated before anything is signed ──────────────────
const params = {
  name: record.name,
  symbol: record.symbol,
  logo: record.logo,
  description: record.description,
  socials: record.socials,
  creatorFeeRecipient: record.creatorFeeRecipient,
  creatorTaxBps: 0,
  buybackEnabled: false,
  expectedEconomics: record.expectedEconomics,
  salt: record.salt,
} as const;
const args = [params, BigInt(record.launchConfigId), record.pairToken] as const;
const simulated = await ask('the simulation of launchToken', () => pub.simulateContract({ address: factory, abi: factoryAbi, functionName: 'launchToken', args, value: launchFee, account: sender }));
const [predictedToken, predictedCurve] = simulated.result;
console.error(`simulated: the factory would launch token ${predictedToken} with curve ${predictedCurve}; nothing has been sent`);

const data = encodeFunctionData({ abi: factoryAbi, functionName: 'launchToken', args });
const plan = { network: record.network, chainId, block: Number(block), to: factory, data, value: launchFee.toString(), sender, predictedToken, predictedCurve, params: { ...params, launchConfigId: record.launchConfigId, pairToken: record.pairToken }, reviewedBy: record.reviewedBy, reviewedAt: record.reviewedAt };

if (!send) {
  if (wantCalldata) {
    // The only line on stdout: what the Safe sends (safe-tx.ts takes --to, --data and --value), and what to expect.
    console.log(JSON.stringify({ ...plan, note: 'unsigned; the operator Safe sends these bytes with this value through safe-tx.ts; the launch is then read back with pons-status.ts and recorded with record-token.ts' }));
  } else {
    console.error('every check passed; run again with --calldata for the Safe, or with --send --reviewed and DEPLOYER_PRIVATE_KEY in the shell');
  }
  process.exit(0);
}

// ── --send ────────────────────────────────────────────────────────────────
const balance = await ask('getBalance(sender)', () => pub.getBalance({ address: sender }));
if (balance < launchFee) fail(`the sender ${sender} holds ${balance} wei, less than the launch fee ${launchFee}; nothing was sent`);
const wallet = createWalletClient({ chain, transport: http(network!.rpc), account: account! });
const hash = await ask('the launch', () => wallet.writeContract({ address: factory, abi: factoryAbi, functionName: 'launchToken', args, value: launchFee }));
console.error(`sent ${hash}; recording the hash before waiting for the receipt`);
mkdirSync(new URL('../evidence/pons/', import.meta.url), { recursive: true });
writeFileSync(evidence, `${JSON.stringify({ plan, pending: { transactionHash: hash, sentAt: new Date().toISOString(), note: 'sent; the receipt was not yet read when this was written' } }, null, 2)}\n`);
const receipt = await ask(`the receipt of ${hash}`, () => pub.waitForTransactionReceipt({ hash }));
if (receipt.status !== 'success') fail(`the launch did not succeed: status ${receipt.status}; the pending note in ${fileURLToPath(evidence)} says which transaction`);

// ── read back: the launch as the factory has it, against what was asked ───
type Launched = { token: Address; curve: Address; deployer: Address; pairToken: Address; launchConfigId: bigint; graduationThreshold: bigint };
let launched: Launched | null = null;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
  try {
    const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
    if (ev.eventName === 'TokenLaunched') launched = ev.args as unknown as Launched;
  } catch {
    // Another of the factory's events; not this one.
  }
}
if (launched === null) fail(`the receipt carries no TokenLaunched from the factory; the pending note in ${fileURLToPath(evidence)} says which transaction`);
const got: Launched = launched;
if (got.token.toLowerCase() !== predictedToken.toLowerCase() || got.curve.toLowerCase() !== predictedCurve.toLowerCase()) fail(`the factory launched ${got.token} / ${got.curve}, not the simulated ${predictedToken} / ${predictedCurve}; do not use them until this is understood`);
const [info, name, symbol, decimals, supply] = await Promise.all([
  ask('getLaunchedToken()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [got.token] })),
  ask('name()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'name' })),
  ask('symbol()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'symbol' })),
  ask('decimals()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'decimals' })),
  ask('totalSupply()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'totalSupply' })),
]);
if (!info.exists || info.creatorFeeRecipient.toLowerCase() !== record.creatorFeeRecipient.toLowerCase() || info.creatorTaxBps !== 0 || info.buybackEnabled !== false || info.pairToken.toLowerCase() !== record.pairToken.toLowerCase()) {
  fail(`the factory records fee recipient ${info.creatorFeeRecipient}, creator tax ${info.creatorTaxBps}, buyback ${info.buybackEnabled}, pair ${info.pairToken} — not what was asked; do not use this token until this is understood`);
}
const result = {
  plan,
  launch: { transactionHash: hash, block: Number(receipt.blockNumber), at: new Date().toISOString(), token: got.token, curve: got.curve, deployer: got.deployer, pairToken: got.pairToken, launchConfigId: Number(got.launchConfigId), graduationThreshold: got.graduationThreshold.toString() },
  asRead: { name, symbol, decimals: Number(decimals), totalSupply: supply.toString(), phase: PHASES[info.phase] ?? String(info.phase), creatorFeeRecipient: info.creatorFeeRecipient, creatorTaxBps: info.creatorTaxBps, buybackEnabled: info.buybackEnabled, poolFee: info.poolFee, tickSpacing: info.tickSpacing },
  explorer: network!.explorer ? `${network!.explorer}/address/${got.token}` : null,
  next: `node scripts/record-token.ts ${got.token} --treasury ${record.creatorFeeRecipient} (LAUNCH.md row 4); watch the curve with pons-status.ts; record the pool at graduation with pons-pool.ts`,
};
writeFileSync(evidence, `${JSON.stringify(result, null, 2)}\n`);
console.error(`launched ${symbol} (${name}) at ${got.token} in block ${receipt.blockNumber}: curve ${got.curve}, ${supply} units of ${decimals} decimals, phase ${result.asRead.phase} — as asked`);
console.error(`written ${fileURLToPath(evidence)}`);
// The only line on stdout: the token, for the records that take it.
console.log(JSON.stringify({ token: got.token, curve: got.curve, chainId, block: Number(receipt.blockNumber), transactionHash: hash }));
