/**
 * Plan the operator's multisig — a Safe — on the launch chain, unsigned.
 *
 * The operator policy proposes a multisig of at least three signers with a
 * quorum of two, and the token record makes it the credit desk's treasury.
 * Safe's canonical 1.4.1 contracts answer at their canonical addresses on
 * Robinhood Chain (read 12 September 2026). This tool holds no key and
 * sends nothing: it builds the one transaction that creates the Safe —
 * `createProxyWithNonce(singleton, setup(...), saltNonce)` on the proxy
 * factory — predicts the address the factory will give it (CREATE2), asks
 * the node to simulate the call and compares, and prints `to`, `data` and
 * the address for whoever holds a funded account to send, from any wallet.
 *
 *   node scripts/plan-safe.ts <owner> <owner> <owner> [--threshold 2] [--network robinhood-mainnet] [--nonce <uint>]
 *
 * After the transaction is mined: verify the owners and the threshold on
 * the explorer, then the Safe's address is the `treasury` of the credit
 * desk's record and the `operator` of a series' record. Nothing here
 * decides who the signers are — the register's A4 stays open until named
 * people are.
 */

import { createPublicClient, http, keccak256, type Address, type Hex } from 'viem';
import { address, parseArgs, unsigned } from './lib/args.ts';
import { SAFE_1_4_1, factoryAbi, planCreation } from './lib/safe.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'ethereum-mainnet': { chainId: 1, rpc: process.env.CURB_RPC_URL_ETHEREUM ?? 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const { positionals, flags } = parseArgs(process.argv.slice(2), ['threshold', 'network', 'nonce'], fail);
const owners = positionals.map((o, i) => address(o, `owner ${i + 1}`, fail));
const threshold = unsigned(flags.threshold ?? '2', '--threshold', fail);
const networkName = flags.network ?? 'robinhood-mainnet';
const saltNonce = unsigned(flags.nonce ?? String(Math.floor(Date.now() / 1000)), '--nonce', fail);

if (owners.length < 3) fail('an operator multisig has at least three owners (the operator policy); give three or more addresses');
if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length) fail('an owner is listed twice');
if (threshold < 2n || threshold > BigInt(owners.length)) fail(`the threshold must be at least 2 and at most the number of owners (${owners.length})`);
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });

// ── the chain, and Safe's contracts on it ─────────────────────────────────
const chainId = await pub.getChainId();
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

console.error(`a ${threshold}-of-${owners.length} Safe (1.4.1, L2 singleton) will be created at ${predicted} by the transaction below; nothing has been sent`);
if (network!.explorer) console.error(`after it is mined: ${network!.explorer}/address/${predicted}`);
// The only line on stdout: what a wallet sends, and what to expect.
console.log(JSON.stringify({ network: networkName, chainId, to: SAFE_1_4_1.proxyFactory, data, value: '0', predictedAddress: predicted, owners, threshold: threshold.toString(), saltNonce: saltNonce.toString(), singleton: SAFE_1_4_1.singletonL2, fallbackHandler: SAFE_1_4_1.fallbackHandler, note: 'unsigned; send from any funded account on this chain; verify owners and threshold on the explorer before the address is used as treasury or operator' }));
