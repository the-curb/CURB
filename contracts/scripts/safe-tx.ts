/**
 * One transaction of the operator's Safe, without a hosted interface.
 *
 * The operator policy has the multisig act by quorum; Safe's own contract
 * lets a quorum act with nothing off chain: each approving owner sends
 * `approveHash(hash)` from their own wallet — an ordinary transaction —
 * and then anyone sends `execTransaction` with pre-validated signatures
 * naming the owners that approved. No signing tool, no relay, no hosted
 * page has to support the chain. This tool prints those bytes, unsigned:
 *
 *   node scripts/safe-tx.ts --safe <safe> --to <address> --data <hex> [--value <wei>] [--nonce <n>] [--network robinhood-mainnet]
 *     → the SafeTx hash (computed here and checked against the Safe's own getTransactionHash),
 *       the approveHash calldata each signer sends to the Safe, and who has approved so far
 *   node scripts/safe-tx.ts … --approved-by <owner>,<owner>
 *     → also the execTransaction calldata for anyone to send once the quorum has approved
 *
 * The hash is refused unless the Safe agrees with it; the execution bytes
 * are refused unless every named approver is an owner and has approved on
 * chain. Pair it with operator-calldata.mjs, which prints the inner call.
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { approveHashData, execTransactionData, plainSafeTx, safeAbi, safeTxHash } from './lib/safe.ts';

const NETWORKS: Record<string, { chainId: number; rpc: string }> = {
  'robinhood-mainnet': { chainId: 4663, rpc: process.env.CURB_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com' },
  'ethereum-mainnet': { chainId: 1, rpc: process.env.CURB_RPC_URL_ETHEREUM ?? 'https://ethereum-rpc.publicnode.com' },
  'hardhat-local': { chainId: 31337, rpc: process.env.CURB_RPC_URL_LOCAL ?? 'http://127.0.0.1:8545' },
};

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : null;
};
const fail = (why: string): never => {
  console.error(`refused: ${why}`);
  process.exit(1);
};
const isAddress = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

const safe = flag('safe');
const to = flag('to');
const data = (flag('data') ?? '0x') as Hex;
const value = BigInt(flag('value') ?? '0');
const networkName = flag('network') ?? 'robinhood-mainnet';
const approvedBy = (flag('approved-by') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '') as Address[];
if (!isAddress(safe)) fail('--safe must be the Safe’s address');
if (!isAddress(to)) fail('--to must be the address the Safe calls');
if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) fail('--data must be hex bytes (0x for none)');
if (!approvedBy.every(isAddress)) fail('--approved-by is a comma-separated list of owner addresses');
const network = NETWORKS[networkName];
if (!network) fail(`unknown network ${networkName}; one of ${Object.keys(NETWORKS).join(', ')}`);

const chain = { id: network!.chainId, name: networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network!.rpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(network!.rpc) });
const chainId = await pub.getChainId();
if (chainId !== network!.chainId) fail(`the node answers chain id ${chainId}; the ${networkName} profile expects ${network!.chainId}`);
const code = await pub.getCode({ address: safe! });
if (!code || code === '0x') fail(`no code at ${safe} on chain ${chainId}`);

const [owners, threshold, currentNonce] = await Promise.all([
  pub.readContract({ address: safe!, abi: safeAbi, functionName: 'getOwners' }) as Promise<Address[]>,
  pub.readContract({ address: safe!, abi: safeAbi, functionName: 'getThreshold' }) as Promise<bigint>,
  pub.readContract({ address: safe!, abi: safeAbi, functionName: 'nonce' }) as Promise<bigint>,
]);
const nonce = flag('nonce') === null ? currentNonce : BigInt(flag('nonce')!);
if (nonce < currentNonce) fail(`nonce ${nonce} is already used; the Safe is at ${currentNonce}`);
console.error(`Safe ${safe} on chain ${chainId}: ${owners.length} owners, threshold ${threshold}, nonce ${currentNonce}${nonce !== currentNonce ? ` (this transaction at ${nonce})` : ''}`);

const tx = plainSafeTx(to!, data, nonce, value);
const local = safeTxHash(chainId, safe!, tx);
const theirs = (await pub.readContract({
  address: safe!,
  abi: safeAbi,
  functionName: 'getTransactionHash',
  args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce],
})) as Hex;
if (local.toLowerCase() !== theirs.toLowerCase()) fail(`the hash computed here (${local}) is not the Safe's (${theirs}); nothing is printed`);

const lower = owners.map((o) => o.toLowerCase());
const approvals = await Promise.all(owners.map(async (owner) => ({ owner, approved: ((await pub.readContract({ address: safe!, abi: safeAbi, functionName: 'approvedHashes', args: [owner, local] })) as bigint) === 1n })));
const approvedSoFar = approvals.filter((a) => a.approved).map((a) => a.owner);
console.error(`approved so far: ${approvedSoFar.length === 0 ? 'nobody' : approvedSoFar.join(', ')} (${approvedSoFar.length} of ${threshold} needed)`);

let execution: { to: Address; data: Hex } | null = null;
if (approvedBy.length > 0) {
  for (const a of approvedBy) {
    if (!lower.includes(a.toLowerCase())) fail(`${a} is not an owner of this Safe`);
    if (!approvedSoFar.map((o) => o.toLowerCase()).includes(a.toLowerCase())) fail(`${a} has not approved ${local} on chain yet`);
  }
  if (BigInt(approvedBy.length) < threshold) fail(`${approvedBy.length} approver(s) named; the threshold is ${threshold}`);
  execution = { to: safe!, data: execTransactionData(tx, approvedBy) };
}

// The only line on stdout.
console.log(
  JSON.stringify({
    network: networkName,
    chainId,
    safe,
    nonce: nonce.toString(),
    call: { to, value: value.toString(), data },
    safeTxHash: local,
    approve: { to: safe, data: approveHashData(local), note: 'each approving owner sends this from their own wallet; an ordinary transaction' },
    approvedSoFar,
    threshold: threshold.toString(),
    execute: execution ? { ...execution, value: '0', note: `anyone sends this once the ${threshold} named owners have approved; the Safe checks the approvals itself` } : null,
  }),
);
