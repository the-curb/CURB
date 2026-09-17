/**
 * Record the token as the chain has it, and write the credit desk's
 * deployment record from that — never from a launchpad's page.
 *
 * The token record's order of work, step 3: the token's address, decimals
 * and supply are read from the chain. This tool reads them — plus its name
 * and symbol, its code hash, whether it sits behind a proxy (the EIP-1967
 * implementation, admin and beacon slots), and whether `owner()` and
 * `paused()` answer — at a stated block, and writes
 * `records/credit-desk.<chainId>.json` with those facts beside the record
 * the deployment tool takes. `reviewedBy` is left empty on purpose: the
 * record is refused until a named person has reviewed what was read.
 *
 *   node scripts/record-token.ts <token> [--network robinhood-mainnet] [--treasury 0x…] [--out records/credit-desk.4663.json]
 *
 * A token behind a proxy is written down as such: its code can change under
 * its admin, and the desk neither controls nor vouches for it — the site
 * will verify the desk's code every tick, not the token's.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, createPublicClient, http, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { address as checkedAddress, parseArgs } from './lib/args.ts';
import { describeError, endpointHost } from './lib/node.ts';

/** The public endpoint is what the record names; an operator's own endpoint (which may carry a key) is read through the environment and never written down. */
const NETWORKS: Record<string, { chainId: number; rpc: string; publicRpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', publicRpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'ethereum-mainnet': { chainId: 1, rpc: process.env.CURB_RPC_URL_ETHEREUM ?? 'https://ethereum-rpc.publicnode.com', publicRpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', publicRpc: 'http://127.0.0.1:8545', explorer: null },
};

/** EIP-1967: keccak256(label) − 1, per the standard; the same constants the site reads. */
const SLOTS = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
} as const;

function fail(why: string): never {
  console.error(`refused: ${why}`);
  process.exit(1);
}
const { positionals, flags } = parseArgs(process.argv.slice(2), ['network', 'treasury', 'out'], fail);
if (positionals.length !== 1) fail('give exactly one token address as the argument');
const token: Address = checkedAddress(positionals[0]!, 'the token', fail);
const networkName = flags.network ?? 'robinhood-mainnet';
const treasury = flags.treasury === undefined ? null : checkedAddress(flags.treasury, '--treasury', fail);
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);
const out = flags.out ?? `records/credit-desk.${network!.chainId}.json`;

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
const erc20 = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)', 'function owner() view returns (address)', 'function paused() view returns (bool)']);

const chainId = await pub.getChainId().catch((cause: unknown) => fail(`the node at ${endpointHost(network!.rpc, fail)} did not answer: ${describeError(cause, network!.rpc)}`));
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
const block = await pub.getBlock();
const at = { block: Number(block.number), timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };

const code = await pub.getCode({ address: token, blockNumber: block.number });
if (!code || code === '0x') fail(`the token at ${token} has no code on chain ${chainId}`);
// A function the contract does not answer is written down as null; a node that did not answer is a refusal, never a fact about the token.
const read = async <T,>(fn: 'name' | 'symbol' | 'decimals' | 'totalSupply' | 'owner' | 'paused'): Promise<T | null> => {
  try {
    return (await pub.readContract({ address: token, abi: erc20, functionName: fn, blockNumber: block.number })) as T;
  } catch (cause) {
    const reverted = cause instanceof BaseError && (cause.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError) !== null || /reverted|returned no data|0x/.test(cause.shortMessage));
    if (reverted) return null;
    return fail(`the node did not answer ${fn}() for ${token}: ${describeError(cause, network!.rpc)}; nothing is written down`);
  }
};
const [name, symbol, decimals, supply, owner, paused] = await Promise.all([read<string>('name'), read<string>('symbol'), read<number>('decimals'), read<bigint>('totalSupply'), read<Address>('owner'), read<boolean>('paused')]);
if (symbol === null || decimals === null || supply === null) fail(`the token at ${token} does not answer symbol(), decimals() and totalSupply()`);

const slot = async (position: Hex): Promise<Address | null> => {
  const word = await pub.getStorageAt({ address: token, slot: position, blockNumber: block.number });
  if (!word || /^0x0*$/.test(word)) return null;
  return `0x${word.slice(-40)}` as Address;
};
const proxy = { implementation: await slot(SLOTS.implementation), admin: await slot(SLOTS.admin), beacon: await slot(SLOTS.beacon) };
const behindProxy = proxy.implementation !== null || proxy.beacon !== null;

const facts = {
  network: networkName,
  chainId,
  address: token.toLowerCase(),
  readAt: at,
  name,
  symbol,
  decimals: Number(decimals),
  totalSupply: supply.toString(),
  codeHash: keccak256(code),
  codeBytes: (code.length - 2) / 2,
  proxy,
  behindProxy,
  owner,
  paused,
  explorer: network!.explorer ? `${network!.explorer}/address/${token}` : null,
};
console.error(`${symbol} (${name ?? 'no name'}) at ${token} on chain ${chainId} · ${decimals} decimals · supply ${supply} · code ${facts.codeBytes} bytes · read at block ${at.block} (${at.timestamp})`);
if (behindProxy) console.error(`note: the token is behind a proxy (implementation ${proxy.implementation ?? '—'}, admin ${proxy.admin ?? '—'}, beacon ${proxy.beacon ?? '—'}); its code can change under its admin, and the desk does not control it`);
if (owner !== null) console.error(`note: owner() answers ${owner}`);
if (paused !== null) console.error(`note: paused() answers ${paused}`);

const record = {
  _: `Written by scripts/record-token.ts from chain ${chainId} at block ${at.block}, ${at.timestamp}. The token's facts are in tokenAsRead. Fill treasury and its independently reviewed treasurySafe expectation on public chains (version, quorum, code, modules, guard and fallback), priceSource when the pool exists, and reviewedBy / reviewedAt by name; the deployment tool refuses incomplete public records.`,
  network: networkName,
  chainId,
  rpcUrl: network!.publicRpc,
  token,
  decimals: Number(decimals),
  treasury: treasury ?? '0x0000000000000000000000000000000000000000',
  treasurySafe: null,
  priceSource: null,
  reviewedBy: '',
  reviewedAt: '',
  tokenAsRead: facts,
};
mkdirSync(new URL('../records/', import.meta.url), { recursive: true });
const outPath = path.isAbsolute(out) ? out : path.join(fileURLToPath(new URL('..', import.meta.url)), out);
writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
console.error(`written ${outPath}`);
// The only line on stdout: the facts, for the record.
console.log(JSON.stringify(facts));
