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
import { createPublicClient, http, keccak256, parseAbi, type Address, type Hex } from 'viem';

const NETWORKS: Record<string, { chainId: number; rpc: string; explorer: string | null }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  'ethereum-mainnet': { chainId: 1, rpc: process.env.CURB_RPC_URL_ETHEREUM ?? 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545', explorer: null },
};

/** EIP-1967: keccak256(label) − 1, per the standard; the same constants the site reads. */
const SLOTS = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
} as const;

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : null;
};
const token = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--'))) as Address | undefined;
const networkName = flag('network') ?? 'robinhood-mainnet';
const treasury = flag('treasury');
const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
if (!isAddress(token)) fail('give the token address as the first argument');
if (treasury !== null && !isAddress(treasury)) fail('--treasury must be a 20-byte hex address');
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);
const out = flag('out') ?? `records/credit-desk.${network!.chainId}.json`;

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
const erc20 = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)', 'function owner() view returns (address)', 'function paused() view returns (bool)']);

const chainId = await pub.getChainId();
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
const block = await pub.getBlock();
const at = { block: Number(block.number), timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };

const code = await pub.getCode({ address: token!, blockNumber: block.number });
if (!code || code === '0x') fail(`the token at ${token} has no code on chain ${chainId}`);
const read = async <T,>(fn: 'name' | 'symbol' | 'decimals' | 'totalSupply' | 'owner' | 'paused'): Promise<T | null> => {
  try {
    return (await pub.readContract({ address: token!, abi: erc20, functionName: fn, blockNumber: block.number })) as T;
  } catch {
    return null;
  }
};
const [name, symbol, decimals, supply, owner, paused] = await Promise.all([read<string>('name'), read<string>('symbol'), read<number>('decimals'), read<bigint>('totalSupply'), read<Address>('owner'), read<boolean>('paused')]);
if (symbol === null || decimals === null || supply === null) fail(`the token at ${token} does not answer symbol(), decimals() and totalSupply()`);

const slot = async (position: Hex): Promise<Address | null> => {
  const word = await pub.getStorageAt({ address: token!, slot: position, blockNumber: block.number });
  if (!word || /^0x0*$/.test(word)) return null;
  return `0x${word.slice(-40)}` as Address;
};
const proxy = { implementation: await slot(SLOTS.implementation), admin: await slot(SLOTS.admin), beacon: await slot(SLOTS.beacon) };
const behindProxy = proxy.implementation !== null || proxy.beacon !== null;

const facts = {
  network: networkName,
  chainId,
  address: token!.toLowerCase(),
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
  _: `Written by scripts/record-token.ts from chain ${chainId} at block ${at.block}, ${at.timestamp}. The token's facts are in tokenAsRead. Fill treasury (the operator multisig), priceSource when the pool exists, and reviewedBy / reviewedAt by name; the deployment tool refuses the record until then.`,
  network: networkName,
  chainId,
  rpcUrl: network!.rpc,
  token: token!,
  decimals: Number(decimals),
  treasury: treasury ?? '0x0000000000000000000000000000000000000000',
  priceSource: null,
  reviewedBy: '',
  reviewedAt: '',
  tokenAsRead: facts,
};
mkdirSync(new URL('../records/', import.meta.url), { recursive: true });
const outUrl = new URL(`../${out}`, import.meta.url);
writeFileSync(outUrl, `${JSON.stringify(record, null, 2)}\n`);
console.error(`written ${outUrl.pathname}`);
// The only line on stdout: the facts, for the record.
console.log(JSON.stringify(facts));
