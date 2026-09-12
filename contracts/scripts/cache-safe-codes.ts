/**
 * Copy Safe's runtime code from the launch chain into the evidence, so the
 * local rehearsal of the operator's multisig runs against the code that is
 * actually deployed there — set into a Hardhat node at the same addresses —
 * and needs no network in CI.
 *
 *   node scripts/cache-safe-codes.ts        # reads Robinhood Chain, writes evidence/safe-1.4.1.robinhood.json
 *
 * Read-only. The code hashes are recorded; a reviewer compares them with
 * Safe's release once.
 */

import { writeFileSync } from 'node:fs';
import { createPublicClient, http, keccak256, type Address } from 'viem';
import { SAFE_1_4_1 } from './lib/safe.ts';

const RPC = process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const chain = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });

const chainId = await pub.getChainId();
if (chainId !== 4663) throw new Error(`the node answers chain id ${chainId}; expected 4663`);
const block = await pub.getBlock();
const contracts: Record<string, { address: Address; code: string; codeHash: string; bytes: number }> = {};
for (const [name, address] of Object.entries(SAFE_1_4_1)) {
  const code = await pub.getCode({ address: address as Address, blockNumber: block.number });
  if (!code || code === '0x') throw new Error(`no code at ${address} (${name})`);
  contracts[name] = { address: address as Address, code, codeHash: keccak256(code), bytes: (code.length - 2) / 2 };
  console.error(`${name}: ${address} · ${(code.length - 2) / 2} bytes · ${keccak256(code).slice(0, 18)}…`);
}
const record = {
  note: 'Safe 1.4.1 runtime code as deployed on Robinhood Chain at the canonical addresses, read for the local rehearsal of the operator multisig; hashes recorded, not verified against the release',
  chainId,
  readAt: { block: Number(block.number), timestamp: new Date(Number(block.timestamp) * 1000).toISOString() },
  contracts,
};
writeFileSync(new URL('../evidence/safe-1.4.1.robinhood.json', import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
console.error(`written evidence/safe-1.4.1.robinhood.json at block ${block.number}`);
