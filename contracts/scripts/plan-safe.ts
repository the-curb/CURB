/**
 * Plan the operator's multisig — a Safe — on the launch chain, unsigned.
 *
 * The operator policy proposes a multisig of at least three signers with a
 * quorum of two, and the token record makes it the credit desk's treasury.
 * Safe's canonical 1.4.1 contracts answer at their canonical addresses on
 * Robinhood Chain (read 12 September 2026). Without `--send` this tool
 * holds no key and sends nothing: it builds the one transaction that
 * creates the Safe — `createProxyWithNonce(singleton, setup(...), saltNonce)`
 * on the proxy factory — predicts the address the factory will give it
 * (CREATE2), asks the node to simulate the call and compares, and prints
 * `to`, `data` and the address for whoever holds a funded account to send,
 * from any wallet.
 *
 *   node scripts/plan-safe.ts <owner> <owner> <owner> [--threshold 2] [--network robinhood-mainnet] [--nonce <uint>]
 *   node scripts/plan-safe.ts <owner> <owner> <owner> --send --reviewed        (with DEPLOYER_PRIVATE_KEY in the shell)
 *
 * With `--send` it sends that transaction itself, by the same discipline as
 * the deployment tools: the key only from the operator's shell, never
 * printed; `--reviewed` on any chain but a local one, so the owners were
 * read twice by a person; a deployer with no ETH is a refusal; the receipt
 * is read back, the owners and the threshold are read from the new Safe on
 * chain and compared with what was asked, and
 * `evidence/safes/safe.<chainId>.json` is written with all of it.
 *
 * After the transaction is mined: verify the owners and the threshold on
 * the explorer, then the Safe's address is the `treasury` of the credit
 * desk's record and the `operator` of a series' record. Nothing here
 * decides who the signers are — the register's A4 stays open until named
 * people are.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { address, parseArgs, unsigned } from './lib/args.ts';
import { SAFE_1_4_1, factoryAbi, planCreation, safeAbi } from './lib/safe.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'ethereum-mainnet': { chainId: 1, rpc: process.env.CURB_RPC_URL_ETHEREUM ?? 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), ['threshold', 'network', 'nonce'], fail, ['send', 'reviewed']);
const send = flags.send === 'true';
const reviewedFlag = flags.reviewed === 'true';
const owners = positionals.map((o, i) => address(o, `owner ${i + 1}`, fail));
const threshold = unsigned(flags.threshold ?? '2', '--threshold', fail);
const networkName = flags.network ?? 'robinhood-mainnet';
const saltNonce = unsigned(flags.nonce ?? String(Math.floor(Date.now() / 1000)), '--nonce', fail);

if (owners.length < 3) fail('an operator multisig has at least three owners (the operator policy); give three or more addresses');
if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length) fail('an owner is listed twice');
if (threshold < 2n || threshold > BigInt(owners.length)) fail(`the threshold must be at least 2 and at most the number of owners (${owners.length})`);
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);
if (send && network!.chainId !== 31337 && !reviewedFlag) fail(`--send on chain ${network!.chainId} needs --reviewed: the owners and the threshold were read twice by a person before a Safe is created with them`);
const evidence = new URL(`../evidence/safes/safe.${network!.chainId}.json`, import.meta.url);
if (send && existsSync(evidence)) fail(`${fileURLToPath(evidence)} already exists: a Safe was created from this tool on chain ${network!.chainId} before. Read it; if a second Safe is really wanted, move that file aside first`);

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
console.error(`node: ${new URL(network!.rpc).host}`);

/** A node call that failed is a refusal naming the host, never a stack trace carrying a keyed URL. */
async function ask<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    return fail(`the node at ${new URL(network!.rpc).host} did not answer ${what}: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}; nothing was sent`);
  }
}

// ── the chain, and Safe's contracts on it ─────────────────────────────────
const chainId = await ask('eth_chainId', () => pub.getChainId());
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
for (const [name, address] of Object.entries(SAFE_1_4_1)) {
  const code = await pub.getCode({ address: address as Address });
  if (!code || code === '0x') fail(`Safe's ${name} has no code at ${address} on chain ${chainId}; a Safe cannot be created there from these addresses`);
  console.error(`${name}: ${address} · code present (${(code.length - 2) / 2} bytes, keccak ${keccak256(code).slice(0, 18)}…)`);
}

// ── the transaction, and the address the factory will give it ────────────
const creationCode = (await pub.readContract({ address: SAFE_1_4_1.proxyFactory, abi: factoryAbi, functionName: 'proxyCreationCode' })) as Hex;
const { initializer, data, predicted } = planCreation(owners, threshold, saltNonce, creationCode);
const existing = await pub.getCode({ address: predicted });
if (existing && existing !== '0x') fail(`a contract already sits at ${predicted} — this --nonce (${saltNonce}) was used with these owners before; choose another`);

// ── the node's own simulation of the call, sent by nobody ─────────────────
let simulated: Address | null = null;
try {
  const { result } = await pub.simulateContract({ address: SAFE_1_4_1.proxyFactory, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE_1_4_1.singletonL2, initializer, saltNonce], account: owners[0] });
  simulated = result as Address;
} catch (cause) {
  fail(`the node refused to simulate the creation: ${cause instanceof Error ? cause.message.split('\n')[0] : 'unknown'}`);
}
if (simulated!.toLowerCase() !== predicted.toLowerCase()) fail(`the simulation gave ${simulated}, the prediction ${predicted}; the factory is not the one this tool knows`);

const plan = { network: networkName, chainId, to: SAFE_1_4_1.proxyFactory, data, value: '0', predictedAddress: predicted, owners, threshold: threshold.toString(), saltNonce: saltNonce.toString(), singleton: SAFE_1_4_1.singletonL2, fallbackHandler: SAFE_1_4_1.fallbackHandler };

if (!send) {
  console.error(`a ${threshold}-of-${owners.length} Safe (1.4.1, L2 singleton) will be created at ${predicted} by the transaction below; nothing has been sent`);
  if (network!.explorer) console.error(`after it is mined: ${network!.explorer}/address/${predicted}`);
  // The only line on stdout: what a wallet sends, and what to expect.
  console.log(JSON.stringify({ ...plan, note: 'unsigned; send from any funded account on this chain, or run again with --send; verify owners and threshold on the explorer before the address is used as treasury or operator' }));
  process.exit(0);
}

// ── --send: the key from the environment, never printed ──────────────────
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail('DEPLOYER_PRIVATE_KEY is not set in the environment (a 32-byte hex key with 0x); nothing was sent');
const account = privateKeyToAccount(key as Hex);
const balance = await ask('getBalance(sender)', () => pub.getBalance({ address: account.address }));
if (balance === 0n) fail(`the sender ${account.address} holds no ETH on chain ${chainId}; nothing was sent`);
console.error(`sender ${account.address} · ${balance} wei · creating a ${threshold}-of-${owners.length} Safe at ${predicted}`);
const wallet = createWalletClient({ chain, transport: http(network!.rpc), account });
const hash = await ask('the creation', () => wallet.writeContract({ address: SAFE_1_4_1.proxyFactory, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE_1_4_1.singletonL2, initializer, saltNonce] }));
console.error(`sent ${hash}; waiting for the receipt`);
// The hash is written down before the receipt is waited for, so a cut-off here leaves a note, not a second Safe on the next run.
mkdirSync(new URL('../evidence/safes/', import.meta.url), { recursive: true });
writeFileSync(evidence, `${JSON.stringify({ plan, pending: { transactionHash: hash, sender: account.address, sentAt: new Date().toISOString(), note: 'sent; the receipt was not yet read when this was written' } }, null, 2)}\n`);
const receipt = await ask(`the receipt of ${hash}`, () => pub.waitForTransactionReceipt({ hash }));
if (receipt.status !== 'success') fail(`the creation did not succeed: status ${receipt.status}; the pending note in ${fileURLToPath(evidence)} says which transaction`);

// ── read back: the Safe as the chain has it, against what was asked ───────
const code = await ask('getCode(safe)', () => pub.getCode({ address: predicted }));
if (!code || code === '0x') fail(`no code at ${predicted} after the receipt; the pending note in ${fileURLToPath(evidence)} says which transaction`);
const [ownersOnChain, thresholdOnChain] = await Promise.all([
  ask('getOwners()', () => pub.readContract({ address: predicted, abi: safeAbi, functionName: 'getOwners' })) as Promise<readonly Address[]>,
  ask('getThreshold()', () => pub.readContract({ address: predicted, abi: safeAbi, functionName: 'getThreshold' })) as Promise<bigint>,
]);
const same = ownersOnChain.length === owners.length && ownersOnChain.every((o, i) => o.toLowerCase() === owners[i]!.toLowerCase());
if (!same || thresholdOnChain !== threshold) fail(`the Safe at ${predicted} answers owners [${ownersOnChain.join(', ')}] and threshold ${thresholdOnChain}, not what was asked; do not use it`);
const record = { plan, creation: { transactionHash: hash, block: Number(receipt.blockNumber), sender: account.address, at: new Date().toISOString() }, asRead: { owners: ownersOnChain, threshold: thresholdOnChain.toString(), codeBytes: (code.length - 2) / 2 }, explorer: network!.explorer ? `${network!.explorer}/address/${predicted}` : null };
writeFileSync(evidence, `${JSON.stringify(record, null, 2)}\n`);
console.error(`created the Safe at ${predicted} in block ${receipt.blockNumber}: ${ownersOnChain.length} owners, threshold ${thresholdOnChain} — as asked`);
console.error(`written ${fileURLToPath(evidence)}`);
// The only line on stdout: the Safe's address, for the records that take it.
console.log(JSON.stringify({ safe: predicted, chainId, owners: ownersOnChain, threshold: thresholdOnChain.toString(), block: Number(receipt.blockNumber), transactionHash: hash }));
