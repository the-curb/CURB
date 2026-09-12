/**
 * A rehearsal of the operator's multisig, on a Hardhat node on this
 * machine, with Safe's own code.
 *
 * Safe 1.4.1's runtime code as deployed on Robinhood Chain (cached in
 * evidence/safe-1.4.1.robinhood.json) is set into the local node at the
 * canonical addresses. Then, as on the day: a 2-of-3 Safe is planned and
 * created (the plan's predicted address must be where it lands); it is
 * made the treasury of a mock CURB by minting to it; a payment of 100 CURB
 * to a payee is built as a Safe transaction; the hash computed here must
 * equal the Safe's own `getTransactionHash`; one owner approves it on chain
 * and the payment cannot yet be executed (GS020); a second owner approves
 * and anyone executes it with pre-validated signatures; the payee holds
 * 100 CURB and the Safe 900. No hosted interface, no off-chain signature,
 * no key that matters.
 *
 *   npx hardhat node                 # one terminal
 *   node scripts/safe-rehearsal.ts   # another; prints one JSON line
 */

import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from 'viem';
import { SAFE_1_4_1, approveHashData, execTransactionData, factoryAbi, planCreation, plainSafeTx, safeAbi, safeTxHash } from './lib/safe.ts';

const RPC = process.env.REHEARSAL_RPC_URL ?? 'http://127.0.0.1:8545';
const chain = { id: 31337, name: 'Hardhat (local)', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;

async function main() {
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const accounts = (await pub.request({ method: 'eth_accounts' })) as Address[];
  const [deployer, , , , owner1, owner2, owner3, payee, anyone] = accounts;
  if (!deployer || !owner1 || !owner2 || !owner3 || !payee || !anyone) throw new Error('the node exposes fewer than nine unlocked accounts');
  const wallet = (account: Address) => createWalletClient({ chain, transport: http(RPC), account });
  const tx = async (from: Address, to: Address, data: Hex) => {
    const hash = await wallet(from).sendTransaction({ to, data });
    return pub.waitForTransactionReceipt({ hash });
  };
  const attempt = async (from: Address, to: Address, data: Hex): Promise<{ ok: boolean; detail: string | null }> => {
    try {
      await pub.call({ account: from, to, data });
      return { ok: true, detail: null };
    } catch (cause) {
      // Safe's reasons are three-digit codes (GS020: not enough signatures; GS025: the hash was not approved).
      const message = cause instanceof Error ? cause.message : 'unknown';
      return { ok: false, detail: /GS\d{3}/.exec(message)?.[0] ?? message.split('\n')[0]! };
    }
  };

  // ── Safe's code, as Robinhood Chain has it, at the canonical addresses ─
  const cached = JSON.parse(readFileSync(new URL('../evidence/safe-1.4.1.robinhood.json', import.meta.url), 'utf8')) as { chainId: number; readAt: { block: number }; contracts: Record<string, { address: Address; code: Hex; codeHash: Hex }> };
  for (const [name, c] of Object.entries(cached.contracts)) {
    await pub.request({ method: 'hardhat_setCode' as never, params: [c.address, c.code] as never });
    const now = await pub.getCode({ address: c.address });
    if (now !== c.code) throw new Error(`${name}: the code did not land`);
  }
  console.error(`Safe 1.4.1 code from Robinhood Chain (block ${cached.readAt.block}) set at the canonical addresses`);

  // ── the Safe: planned, created where the plan said ────────────────────
  const creationCode = (await pub.readContract({ address: SAFE_1_4_1.proxyFactory, abi: factoryAbi, functionName: 'proxyCreationCode' })) as Hex;
  const owners = [owner1, owner2, owner3] as const;
  const plan = planCreation(owners, 2n, 7n, creationCode);
  const created = await tx(anyone, SAFE_1_4_1.proxyFactory, plan.data);
  const code = await pub.getCode({ address: plan.predicted });
  if (!code || code === '0x') throw new Error(`no Safe at the predicted address ${plan.predicted}`);
  const safe = plan.predicted;
  const onChainOwners = (await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getOwners' })) as Address[];
  const threshold = (await pub.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold' })) as bigint;
  if (threshold !== 2n || onChainOwners.length !== 3 || !owners.every((o) => onChainOwners.map((x) => x.toLowerCase()).includes(o.toLowerCase()))) throw new Error('the Safe is not the 2-of-3 that was planned');
  console.error(`Safe ${safe} created in block ${created.blockNumber}: ${onChainOwners.length} owners, threshold ${threshold}`);

  // ── the treasury: a mock CURB minted to the Safe ──────────────────────
  const token = JSON.parse(readFileSync(new URL('../artifacts/src/mocks/MockToken.sol/MockToken.json', import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex };
  const erc20 = parseAbi(['function mint(address,uint256)', 'function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
  const deployHash = await wallet(deployer).deployContract({ abi: token.abi as never, bytecode: token.bytecode, args: ['The Curb (rehearsal)', 'CURB', 18] as never });
  const curb = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;
  const E18 = 10n ** 18n;
  await tx(deployer, curb, encodeFunctionData({ abi: erc20, functionName: 'mint', args: [safe, 1_000n * E18] }));

  // ── the payment, as a Safe transaction ────────────────────────────────
  const nonce = (await pub.readContract({ address: safe, abi: safeAbi, functionName: 'nonce' })) as bigint;
  const payment = plainSafeTx(curb, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [payee, 100n * E18] }), nonce);
  const local = safeTxHash(chain.id, safe, payment);
  const theirs = (await pub.readContract({
    address: safe,
    abi: safeAbi,
    functionName: 'getTransactionHash',
    args: [payment.to, payment.value, payment.data, payment.operation, payment.safeTxGas, payment.baseGas, payment.gasPrice, payment.gasToken, payment.refundReceiver, payment.nonce],
  })) as Hex;
  if (local.toLowerCase() !== theirs.toLowerCase()) throw new Error(`the hash computed here (${local}) is not the Safe's (${theirs})`);
  console.error(`SafeTx hash ${local} — the Safe agrees`);

  // One approval is not a quorum; the second is; then anyone executes.
  await tx(owner1, safe, approveHashData(local));
  const short = await attempt(anyone, safe, execTransactionData(payment, [owner1]));
  if (short.ok) throw new Error('one approval executed a 2-of-3 payment');
  const notOwner = await attempt(anyone, safe, execTransactionData(payment, [owner1, payee]));
  if (notOwner.ok) throw new Error('a non-owner counted as an approval');
  await tx(owner2, safe, approveHashData(local));
  const unapproved = await attempt(anyone, safe, execTransactionData(payment, [owner1, owner3]));
  if (unapproved.ok) throw new Error('an owner who did not approve counted');
  const exec = await tx(anyone, safe, execTransactionData(payment, [owner1, owner2]));
  const payeeBalance = (await pub.readContract({ address: curb, abi: erc20, functionName: 'balanceOf', args: [payee] })) as bigint;
  const safeBalance = (await pub.readContract({ address: curb, abi: erc20, functionName: 'balanceOf', args: [safe] })) as bigint;
  if (payeeBalance !== 100n * E18 || safeBalance !== 900n * E18) throw new Error(`the payment did not land: payee ${payeeBalance}, safe ${safeBalance}`);
  const replay = await attempt(anyone, safe, execTransactionData(payment, [owner1, owner2]));
  if (replay.ok) throw new Error('the same transaction executed twice');
  console.error(`payment executed in block ${exec.blockNumber}: payee 100 CURB, Safe 900 CURB; one approval refused (${short.detail}); a non-owner refused (${notOwner.detail}); an unapproving owner refused (${unapproved.detail}); a replay refused (${replay.detail})`);

  // The only line on stdout.
  console.log(
    JSON.stringify({
      chainId: chain.id,
      safe,
      owners,
      threshold: 2,
      createdInBlock: Number(created.blockNumber),
      curb,
      safeTxHash: local,
      executedInBlock: Number(exec.blockNumber),
      refused: { oneApproval: short.detail, nonOwner: notOwner.detail, unapprovingOwner: unapproved.detail, replay: replay.detail },
      safeCodeFrom: { chainId: cached.chainId, block: cached.readAt.block, hashes: Object.fromEntries(Object.entries(cached.contracts).map(([k, v]) => [k, v.codeHash])) },
    }),
  );
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
