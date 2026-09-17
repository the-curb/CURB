/**
 * The launch of the CURB token on PONS v2 — LAUNCH.md rows 3 and 4 — by
 * the same discipline as the desk's deployment tool: a record a person
 * reviewed, the venue's terms read again in one block just before anything
 * is sent and compared with what was pinned (the economics digest and the
 * fee), a simulation before anything is signed, the key only from the shell
 * and never printed, the intent journaled before the broadcast, the receipt
 * read back, the launched token read from the factory and compared field by
 * field with what was asked, and everything written to
 * evidence/pons/launch.<chainId>.json.
 *
 *   node scripts/pons-launch.ts <launch.json>                          # the checks and the simulation; nothing sent, nothing written
 *   node scripts/pons-launch.ts <launch.json> --calldata --reviewed    # …the intent journaled, and the bytes for the operator's Safe (safe-tx.ts)
 *   node scripts/pons-launch.ts <launch.json> --send --reviewed        # …and the transaction, from DEPLOYER_PRIVATE_KEY, journaled before it is sent
 *   node scripts/pons-launch.ts <launch.json> --receipt <hash>         # after the Safe sent the bytes: the launch read back and the evidence completed
 *
 * The launch record (records/pons-launch.example.json is refused by design):
 *   { "network": "robinhood-mainnet", "name": "…", "symbol": "CURB", "logo": "…", "description": "…",
 *     "socials": { "twitter": "", "telegram": "", "discord": "", "website": "https://…", "farcaster": "" },
 *     "creatorFeeRecipient": "<the operator's Safe, as evidence/safes/safe.<chainId>.json records it>",
 *     "creatorTaxBps": 0, "buybackEnabled": false,
 *     "pairToken": "0x0000000000000000000000000000000000000000", "launchConfigId": 0,
 *     "launchFeeWei": "<the fee pons-preflight.ts pinned>", "expectedEconomics": "<the digest pons-preflight.ts pinned>",
 *     "salt": "0x…32 bytes…", "reviewedBy": "…", "reviewedAt": "…" }
 *
 * What the token record decided (docs/decisions/TOKEN.md) is enforced, not
 * assumed: no creator tax, no buyback, the fee recipient is the operator's
 * Safe as recorded (its owners and threshold read again), and the fee paid
 * is exactly the pinned fee, which must be what the factory asks for in the
 * block before the send. A record that says otherwise is refused before the
 * node is asked anything.
 *
 * Who sends: `--send` is the deployer key in the shell; `--calldata` is the
 * Safe named as the fee recipient, and every check and the prediction are
 * made for it, whatever the shell holds. Either way the intent — sender,
 * nonce or bytes, predicted token and curve — is on disk before anything
 * leaves this machine, and an existing journal is refused until it is
 * reconciled or completed; a second token is never launched by accident.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, http, isAddress, type Address, type Hex, type TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseArgs } from './lib/args.ts';
import { journaledDeployment } from './lib/journaled-deployment.mjs';
import { describeError, endpointHost, isUnknownBlock, withOneRetry } from './lib/node.ts';
import { NATIVE, PHASES, PONS_V2, erc20Abi, factoryAbi } from './lib/pons-v2.ts';
import { safeAbi } from './lib/safe.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

const fail: (why: string) => never = (why) => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), ['receipt'], fail, ['send', 'reviewed', 'calldata']);
if (positionals.length !== 1) fail('usage: node scripts/pons-launch.ts <launch.json> [--calldata --reviewed | --send --reviewed | --receipt <hash>]');
const send = flags.send === 'true';
const wantCalldata = flags.calldata === 'true';
const reviewedFlag = flags.reviewed === 'true';
const receiptHash = flags.receipt;
if ([send, wantCalldata, receiptHash !== undefined].filter(Boolean).length > 1) fail('--send, --calldata and --receipt are three different steps; give one');
if (receiptHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(receiptHash)) fail('--receipt takes the 32-byte transaction hash the Safe sent');
const mode: 'check' | 'calldata' | 'send' | 'receipt' = send ? 'send' : wantCalldata ? 'calldata' : receiptHash !== undefined ? 'receipt' : 'check';

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
  readonly launchFeeWei: string;
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
if (typeof record.launchFeeWei !== 'string' || !/^\d+$/.test(record.launchFeeWei)) fail('launchFeeWei must be the launch fee pons-preflight.ts pinned, in wei, as a decimal string; the fee paid is exactly this, and the factory must ask for exactly this');
const pinnedFee = BigInt(record.launchFeeWei);
if (!/^0x[0-9a-fA-F]{64}$/.test(record.expectedEconomics) || /^0x0{64}$/.test(record.expectedEconomics)) fail('expectedEconomics must be the 32-byte digest pons-preflight.ts pinned; a zero digest waives the check and is refused');
if (!/^0x[0-9a-fA-F]{64}$/.test(record.salt)) fail('salt must be 32 bytes of hex');
if (!record.reviewedBy?.trim() || !record.reviewedAt?.trim()) fail('the record names no reviewer (reviewedBy, reviewedAt); it is not sent unreviewed');
const chainIdRecorded = network!.chainId;
const acts = mode === 'send' || mode === 'calldata';
if (acts && chainIdRecorded !== 31337 && !reviewedFlag) fail(`chain ${chainIdRecorded} is not a local chain and needs --reviewed on top of the record's own review`);
if (chainIdRecorded !== PONS_V2.chainId && chainIdRecorded !== 31337) fail(`PONS v2 is recorded on chain ${PONS_V2.chainId}`);

// Pin the tooling as the desk does: an uncommitted launch path has not been reviewed with the release.
const here = fileURLToPath(new URL('.', import.meta.url));
if (chainIdRecorded !== 31337) {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', './pons-launch.ts', './lib', '../../lib/chain/uniswap-v4.ts', '../../lib/chain/keccak.ts'], { encoding: 'utf8', cwd: here }).trim();
  if (dirty && acts) fail('the launch tooling has uncommitted changes; pin and review the release before a public launch');
  if (dirty) console.error('note: the launch tooling has uncommitted changes; --calldata and --send would be refused until they are committed');
  else console.error(`repository at ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: here }).trim().slice(0, 10)}`);
}

// The operator's Safe as recorded by plan-safe.ts: the fee recipient must be it, and it is read again below.
interface SafeEvidence { readonly plan: { readonly predictedAddress: Address; readonly owners: readonly Address[]; readonly threshold: string }; readonly asRead: { readonly owners: readonly Address[]; readonly threshold: string } }
const safeFile = new URL(`../evidence/safes/safe.${chainIdRecorded}.json`, import.meta.url);
let safeEvidence: SafeEvidence | null = null;
if (existsSync(safeFile)) {
  try {
    safeEvidence = JSON.parse(readFileSync(safeFile, 'utf8')) as SafeEvidence;
  } catch {
    fail(`${fileURLToPath(safeFile)} could not be read`);
  }
  if (!isAddress(safeEvidence!.plan?.predictedAddress) || !Array.isArray(safeEvidence!.asRead?.owners)) fail(`${fileURLToPath(safeFile)} does not carry the Safe's address and its owners as read`);
  if (safeEvidence!.plan.predictedAddress.toLowerCase() !== record.creatorFeeRecipient.toLowerCase()) fail(`creatorFeeRecipient is ${record.creatorFeeRecipient}; the operator's Safe on chain ${chainIdRecorded} is ${safeEvidence!.plan.predictedAddress} (${fileURLToPath(safeFile)}). The launch's only proceeds go to the fee recipient; it is the Safe, not another contract`);
} else if (chainIdRecorded !== 31337) {
  fail(`${fileURLToPath(safeFile)} does not exist: the operator's Safe on chain ${chainIdRecorded} is not recorded, so the fee recipient cannot be checked against it`);
}

const evidence = new URL(`../evidence/pons/launch.${chainIdRecorded}.json`, import.meta.url);
interface Journal { readonly plan?: { readonly sender?: Address; readonly predictedToken?: Address; readonly predictedCurve?: Address; readonly data?: Hex; readonly value?: string; readonly params?: { readonly salt?: Hex } }; readonly pending?: { readonly state?: string; readonly transactionHash?: string | null; readonly sender?: Address; readonly nonce?: number; readonly predictedToken?: Address; readonly predictedCurve?: Address }; readonly launch?: { readonly token?: Address; readonly transactionHash?: string } }
let journal: Journal | null = null;
if (existsSync(evidence)) {
  try {
    journal = JSON.parse(readFileSync(evidence, 'utf8')) as Journal;
  } catch {
    fail(`${fileURLToPath(evidence)} exists and could not be read; nothing is sent over a journal nobody can read`);
  }
}
if (mode === 'receipt' && journal === null) fail(`${fileURLToPath(evidence)} does not exist: --receipt completes a launch this tool journaled with --calldata; there is none on chain ${chainIdRecorded}`);
if (mode === 'receipt' && journal!.launch) fail(`${fileURLToPath(evidence)} is complete: the launch at ${journal!.launch.token} was read back in transaction ${journal!.launch.transactionHash}; nothing to complete`);

const chain = { id: chainIdRecorded, name: record.network, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const host = endpointHost(network!.rpc, fail);
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
console.error(`node: ${host}`);

let broadcast = false;
async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await withOneRetry(call, isUnknownBlock);
  } catch (cause) {
    return fail(`the node at ${host} did not answer ${what}: ${describeError(cause, network!.rpc)}${broadcast ? `; the launch may be on chain — the journal ${fileURLToPath(evidence)} says what was sent` : '; nothing was sent'}`);
  }
}

const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== chainIdRecorded) fail(`the node answers chain id ${chainId}; the record says ${chainIdRecorded}`);
const factory = PONS_V2.factory;

// ── an existing journal: what is on chain decides what may happen next ────
if (journal !== null && mode !== 'receipt') {
  const file = fileURLToPath(evidence);
  if (journal.launch?.token) {
    if (acts) fail(`${file} records a completed launch: token ${journal.launch.token} in transaction ${journal.launch.transactionHash}. A second token is not launched by accident; if one is really wanted, move that file aside first`);
    console.error(`note: ${file} records a completed launch at ${journal.launch.token}; --calldata and --send would be refused`);
  } else {
    const predicted = journal.pending?.predictedToken;
    const onChain = predicted && isAddress(predicted) ? await ask(`getLaunchedToken(${predicted})`, () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [predicted] })) : null;
    const state = journal.pending?.state ?? 'unknown';
    const what = onChain?.exists
      ? `the launch it predicted is on chain: the factory records token ${predicted} (deployer ${onChain.deployer}). Complete the evidence with --receipt <hash> (the transaction that launched it); do not send again`
      : `an intent in state ${state} (sender ${journal.pending?.sender ?? '?'}${journal.pending?.nonce !== undefined ? `, nonce ${journal.pending.nonce}` : ''}, predicted token ${predicted ?? '?'}${journal.pending?.transactionHash ? `, transaction ${journal.pending.transactionHash}` : ''}) and the factory does not record that token yet. Reconcile it on chain — the sender's nonce, the transaction if one was sent, the Safe's queue if the bytes were given to it — before anything is sent again; if the intent is abandoned, move the file aside; do not change the salt`;
    if (acts) fail(`${file} exists: ${what}`);
    console.error(`note: ${file} exists: ${what}; --calldata and --send would be refused`);
  }
}

// ── the sender: the key from the environment (never printed), or the Safe whose bytes are printed ──
const key = process.env.DEPLOYER_PRIVATE_KEY;
const keyed = key !== undefined && /^0x[0-9a-fA-F]{64}$/.test(key);
const account = mode === 'send' || (mode === 'check' && keyed) ? (keyed ? privateKeyToAccount(key as Hex) : null) : null;
if (mode === 'send' && account === null) fail('DEPLOYER_PRIVATE_KEY is not set in the environment (a 32-byte hex key with 0x); nothing was sent');
if (mode === 'calldata' && keyed) console.error('note: DEPLOYER_PRIVATE_KEY is set but not used: --calldata is the Safe sending, and every check below is for the Safe');
const sender: Address = mode === 'receipt' ? ((journal!.pending?.sender ?? journal!.plan?.sender ?? record.creatorFeeRecipient) as Address) : (account?.address ?? record.creatorFeeRecipient);
console.error(`sender: ${sender}${account === null ? ' (the Safe; nothing is signed here)' : ' (the key in the shell)'}${mode === 'check' ? ` — this check is for it; --calldata checks for the Safe, --send for the key's address` : ''}`);

// ── read back: the launch as the factory has it, against what was asked ───
type Launched = { token: Address; curve: Address; deployer: Address; pairToken: Address; launchConfigId: bigint; graduationThreshold: bigint };
async function complete(plan: Record<string, unknown>, hash: Hex, receipt: TransactionReceipt, predictedToken: Address, predictedCurve: Address): Promise<never> {
  const file = fileURLToPath(evidence);
  if (receipt.status !== 'success') fail(`the launch did not succeed: status ${receipt.status} for ${hash}; the journal ${file} is kept — reconcile before anything is sent again, or move it aside if the attempt is abandoned`);
  let launched: Launched | null = null;
  let seen = 0;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (ev.eventName === 'TokenLaunched') {
        seen += 1;
        launched = ev.args as unknown as Launched;
      }
    } catch {
      // Another of the factory's events; not this one.
    }
  }
  if (launched === null) fail(`the receipt of ${hash} carries no TokenLaunched from the factory; the journal ${file} is kept — this is not the launch, or not from this venue`);
  if (seen !== 1) fail(`the receipt of ${hash} carries ${seen} TokenLaunched events; expected one — the journal ${file} is kept, read the transaction on the explorer`);
  const got: Launched = launched;
  const wrong: string[] = [];
  if (got.token.toLowerCase() !== predictedToken.toLowerCase()) wrong.push(`token ${got.token}, simulated ${predictedToken}`);
  if (got.curve.toLowerCase() !== predictedCurve.toLowerCase()) wrong.push(`curve ${got.curve}, simulated ${predictedCurve}`);
  if (got.deployer.toLowerCase() !== sender.toLowerCase()) wrong.push(`deployer ${got.deployer}, the sender was ${sender}`);
  if (got.pairToken.toLowerCase() !== record.pairToken.toLowerCase()) wrong.push(`pair ${got.pairToken}, asked ${record.pairToken}`);
  if (got.launchConfigId !== BigInt(record.launchConfigId)) wrong.push(`launch config ${got.launchConfigId}, asked ${record.launchConfigId}`);
  if (wrong.length > 0) fail(`the factory's TokenLaunched in ${hash} is not what was asked: ${wrong.join('; ')}. The journal ${file} is kept; do not use this token until this is understood`);
  const [info, name, symbol, decimals, supply] = await Promise.all([
    ask('getLaunchedToken()', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [got.token] })),
    ask('name()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'name' })),
    ask('symbol()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'symbol' })),
    ask('decimals()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'decimals' })),
    ask('totalSupply()', () => pub.readContract({ address: got.token, abi: erc20Abi, functionName: 'totalSupply' })),
  ]);
  if (!info.exists) wrong.push(`the factory does not record ${got.token} as launched`);
  if (info.creatorFeeRecipient.toLowerCase() !== record.creatorFeeRecipient.toLowerCase()) wrong.push(`fee recipient ${info.creatorFeeRecipient}, asked ${record.creatorFeeRecipient}`);
  if (info.creatorTaxBps !== 0) wrong.push(`creator tax ${info.creatorTaxBps} bps, asked 0`);
  if (info.buybackEnabled !== false) wrong.push('buyback enabled, asked disabled');
  if (info.pairToken.toLowerCase() !== record.pairToken.toLowerCase()) wrong.push(`pair ${info.pairToken}, asked ${record.pairToken}`);
  if (info.curve.toLowerCase() !== got.curve.toLowerCase()) wrong.push(`curve ${info.curve} in the factory's record, ${got.curve} in the event`);
  if (name !== record.name) wrong.push(`name ${JSON.stringify(name)}, asked ${JSON.stringify(record.name)}`);
  if (symbol !== record.symbol) wrong.push(`symbol ${JSON.stringify(symbol)}, asked ${JSON.stringify(record.symbol)}`);
  if (wrong.length > 0) fail(`the factory records the launch differently from what was asked: ${wrong.join('; ')}. The journal ${file} is kept; do not use this token until this is understood`);
  const result = {
    plan,
    launch: { transactionHash: hash, block: Number(receipt.blockNumber), at: new Date().toISOString(), token: got.token, curve: got.curve, deployer: got.deployer, pairToken: got.pairToken, launchConfigId: Number(got.launchConfigId), graduationThreshold: got.graduationThreshold.toString() },
    asRead: { name, symbol, decimals: Number(decimals), totalSupply: supply.toString(), phase: PHASES[info.phase] ?? String(info.phase), creatorFeeRecipient: info.creatorFeeRecipient, creatorTaxBps: info.creatorTaxBps, buybackEnabled: info.buybackEnabled, poolFee: info.poolFee, tickSpacing: info.tickSpacing },
    explorer: network!.explorer ? `${network!.explorer}/address/${got.token}` : null,
    next: `node scripts/record-token.ts ${got.token} --treasury ${record.creatorFeeRecipient} (LAUNCH.md row 4); watch the curve with pons-status.ts; record the pool at graduation with pons-pool.ts`,
  };
  writeFileSync(evidence, `${JSON.stringify(result, null, 2)}\n`, { flush: true });
  console.error(`launched ${symbol} (${name}) at ${got.token} in block ${receipt.blockNumber}: curve ${got.curve}, ${supply} units of ${decimals} decimals, phase ${result.asRead.phase}, fee recipient ${info.creatorFeeRecipient}, creator tax ${info.creatorTaxBps}, buyback ${info.buybackEnabled}, pair ${info.pairToken} — every field as asked`);
  console.error(`written ${file}`);
  // The only line on stdout: the token, for the records that take it.
  console.log(JSON.stringify({ token: got.token, curve: got.curve, chainId, block: Number(receipt.blockNumber), transactionHash: hash }));
  process.exit(0);
}

// ── --receipt: the Safe sent the journaled bytes; read the launch back ────
if (mode === 'receipt') {
  const pending = journal!.pending;
  const plan = journal!.plan;
  if (!pending || !plan || !isAddress(String(pending.predictedToken)) || !isAddress(String(pending.predictedCurve))) fail(`${fileURLToPath(evidence)} carries no journaled intent with a predicted token and curve; nothing to complete`);
  if (plan.params?.salt?.toLowerCase() !== record.salt.toLowerCase()) fail(`the journal was written for salt ${plan.params?.salt}, the record says ${record.salt}; the record given is not the one the journal is for`);
  broadcast = true;
  const hash = receiptHash as Hex;
  console.error(`completing the journaled launch (state ${pending.state ?? '?'}, sender ${sender}, predicted token ${pending.predictedToken}) from transaction ${hash}`);
  const receipt = await ask(`the receipt of ${hash}`, () => pub.waitForTransactionReceipt({ hash }));
  await complete(plan as Record<string, unknown>, hash, receipt, pending.predictedToken as Address, pending.predictedCurve as Address);
}

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
if (launchFee !== pinnedFee) fail(`the venue's launch fee is ${launchFee} wei at block ${block}, not the pinned ${pinnedFee}: a term changed since the preflight; read it again (pons-preflight.ts) and review the record again — the fee paid is never what the factory happens to ask`);
if (digest.toLowerCase() !== record.expectedEconomics.toLowerCase()) fail(`the venue's economics for config ${record.launchConfigId} and pair ${record.pairToken} are ${digest} at block ${block}, not the pinned ${record.expectedEconomics}: a term changed since the preflight; read it again (pons-preflight.ts) and review the record again`);
if (!config.enabled) fail(`launch config ${record.launchConfigId} is disabled`);
if (config.poolFee !== 0) fail(`launch config ${record.launchConfigId} creates pools with fee ${config.poolFee}; the desk's reader expects the venue's fee-0 pools (the hook takes its cut instead) — read the venue again`);
if (chainId === PONS_V2.chainId && hook.toLowerCase() !== PONS_V2.hook.toLowerCase()) fail(`the factory's hook is ${hook}, not the recorded ${PONS_V2.hook}`);
if (chainId === PONS_V2.chainId && poolManager.toLowerCase() !== PONS_V2.poolManager.toLowerCase()) fail(`the factory's PoolManager is ${poolManager}, not the recorded ${PONS_V2.poolManager}`);
if (record.pairToken !== NATIVE) {
  const approved = await read('approvedPairTokens(pair)', () => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'approvedPairTokens', args: [record.pairToken], ...at }));
  if (!approved) fail(`${record.pairToken} is not an approved pair token at block ${block}`);
}
// The fee recipient: the Safe as recorded, read again — its code, its owners and its threshold.
const treasuryCode = await read('getCode(creatorFeeRecipient)', () => pub.getCode({ address: record.creatorFeeRecipient, ...at }));
if ((!treasuryCode || treasuryCode === '0x') && (chainId !== 31337 || safeEvidence !== null)) fail(`the fee recipient ${record.creatorFeeRecipient} has no code at block ${block}: the fee recipient is the operator's Safe, not a key`);
if (safeEvidence !== null) {
  const [owners, threshold] = await Promise.all([
    read('Safe.getOwners()', () => pub.readContract({ address: record.creatorFeeRecipient, abi: safeAbi, functionName: 'getOwners', ...at })),
    read('Safe.getThreshold()', () => pub.readContract({ address: record.creatorFeeRecipient, abi: safeAbi, functionName: 'getThreshold', ...at })),
  ]);
  const expected = [...safeEvidence.asRead.owners].map((o) => o.toLowerCase()).sort();
  const found = [...owners].map((o) => o.toLowerCase()).sort();
  if (expected.length !== found.length || expected.some((o, i) => o !== found[i])) fail(`the Safe ${record.creatorFeeRecipient} answers owners ${owners.join(', ')} at block ${block}; the record ${fileURLToPath(safeFile)} says ${safeEvidence.asRead.owners.join(', ')} — the treasury changed; review it before it takes the launch's proceeds`);
  if (threshold !== BigInt(safeEvidence.asRead.threshold)) fail(`the Safe ${record.creatorFeeRecipient} answers threshold ${threshold} at block ${block}; the record says ${safeEvidence.asRead.threshold}`);
  console.error(`fee recipient: the operator's Safe ${record.creatorFeeRecipient}, ${owners.length} owners and threshold ${threshold} as recorded`);
}
console.error(`venue at block ${block}: launching ${launchEnabled ? 'open' : 'closed'} · canLaunch(sender) true · fee ${launchFee} wei as pinned · economics pinned and unchanged · config ${record.launchConfigId}: ${config.phantomQuote} phantom, graduation ${config.graduationThreshold}, tick spacing ${config.tickSpacing}`);

// The sender's balance, whoever sends: the node will not simulate a value the sender cannot pay, and the Safe must hold the fee before its bytes are worth printing.
const balance = await read('getBalance(sender)', () => pub.getBalance({ address: sender, ...at }));
if (balance < launchFee) fail(`the sender ${sender} holds ${balance} wei at block ${block}, less than the launch fee ${launchFee} (and gas on top): fund it, then run this again — the simulation is not run for a sender the factory would refuse; nothing was sent`);
console.error(`sender balance ${balance} wei at block ${block}; the launch fee is ${launchFee}`);

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
const simulated = await ask('the simulation of launchToken', () => pub.simulateContract({ address: factory, abi: factoryAbi, functionName: 'launchToken', args, value: launchFee, account: sender, ...at }));
const [predictedToken, predictedCurve] = simulated.result;
console.error(`simulated as ${sender}: the factory would launch token ${predictedToken} with curve ${predictedCurve}; nothing has been sent`);

const data = encodeFunctionData({ abi: factoryAbi, functionName: 'launchToken', args });
const plan = { network: record.network, chainId, block: Number(block), to: factory, data, value: launchFee.toString(), sender, predictedToken, predictedCurve, params: { ...params, launchConfigId: record.launchConfigId, pairToken: record.pairToken }, reviewedBy: record.reviewedBy, reviewedAt: record.reviewedAt };

if (mode === 'check') {
  console.error('every check passed; run again with --calldata --reviewed for the Safe, or with --send --reviewed and DEPLOYER_PRIVATE_KEY in the shell');
  process.exit(0);
}

mkdirSync(new URL('../evidence/pons/', import.meta.url), { recursive: true });

// ── --calldata: the intent journaled, then the bytes for the Safe ─────────
if (mode === 'calldata') {
  const pending = { sender, predictedToken, predictedCurve, salt: record.salt, transactionHash: null, state: 'PREPARED', preparedAt: new Date().toISOString(), note: 'the bytes were printed for the Safe to send through safe-tx.ts; complete with --receipt <hash> once it has, or move this file aside if it never will; a second --calldata is refused while this exists' };
  try {
    writeFileSync(evidence, `${JSON.stringify({ plan, pending }, null, 2)}\n`, { flag: 'wx', flush: true });
  } catch {
    fail(`${fileURLToPath(evidence)} could not be written (it may have appeared since it was checked); nothing is printed over a journal that was not written`);
  }
  console.error(`journaled the intent in ${fileURLToPath(evidence)}`);
  // The only line on stdout: what the Safe sends (safe-tx.ts takes --to, --data and --value), and what to expect.
  console.log(JSON.stringify({ ...plan, note: `unsigned; the operator Safe ${sender} sends these bytes with this value through safe-tx.ts; then node scripts/pons-launch.ts <record> --receipt <hash> reads the launch back and completes the evidence` }));
  process.exit(0);
}

// ── --send ────────────────────────────────────────────────────────────────
const nonce = await ask('getTransactionCount(sender)', () => pub.getTransactionCount({ address: sender, blockTag: 'pending' }));
const wallet = createWalletClient({ chain, transport: http(network!.rpc), account: account! });
// The intent is on disk before the broadcast (flag wx: an existing journal is never overwritten), the hash before the receipt is waited for.
const { hash, receipt } = await journaledDeployment(evidence, { plan, pending: { sender, nonce, predictedToken, predictedCurve, salt: record.salt, preparedAt: new Date().toISOString() } }, async () => {
  broadcast = true;
  const h = await wallet.writeContract({ address: factory, abi: factoryAbi, functionName: 'launchToken', args, value: launchFee, nonce });
  console.error(`sent ${h}; recording the hash before waiting for the receipt`);
  return h;
}, (h: Hex) => pub.waitForTransactionReceipt({ hash: h })).catch((cause: unknown) => fail(`the launch's outcome is unconfirmed, or an intent already exists in ${fileURLToPath(evidence)}: ${describeError(cause, network!.rpc)}. Read the journal; reconcile the sender's nonce (${nonce}) and getLaunchedToken(${predictedToken}) on chain before any retry; do not change the salt and do not send from the Safe until reconciled`));
await complete(plan, hash, receipt, predictedToken, predictedCurve);
