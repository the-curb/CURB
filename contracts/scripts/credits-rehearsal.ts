/**
 * A rehearsal of the credit desk, on a Hardhat node on this machine.
 *
 * Deploys a mock CURB (18 decimals), a mock dollar (6 decimals), a mock
 * pool holding both, and the credit desk pointing at the mock CURB with the
 * node's second account as treasury. Sets the pool to 4,000,000 CURB
 * against 20,000 dollars — US$0.005 a CURB — mints CURB to a payer, and
 * has the payer top up a key hash with 4,000 CURB (US$20.00, the opening
 * minimum) and then 1,000 more after the pool has doubled (US$10.00).
 * Prints the CURB_CREDITS record the site needs, with the key, so the site
 * can be shown reading the rate, crediting the hash and charging a call.
 *
 *   npx hardhat node                      # in one terminal
 *   node scripts/credits-rehearsal.ts     # in another; prints one JSON line
 *
 * Nothing here touches a public chain, holds a key that matters, or is a
 * token anyone should rely on. No CURB exists.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';

const RPC = process.env.REHEARSAL_RPC_URL ?? 'http://127.0.0.1:8545';

function artifact(path: string): { abi: unknown[]; bytecode: Hex } {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex };
}

const chain = { id: 31337, name: 'Hardhat (local)', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;

async function main() {
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const accounts = (await pub.request({ method: 'eth_accounts' })) as Address[];
  const [deployer, treasury, payer] = accounts;
  if (!deployer || !treasury || !payer) throw new Error('the node exposes fewer than three unlocked accounts');
  const wallet = (account: Address) => createWalletClient({ chain, transport: http(RPC), account });

  const token = artifact('artifacts/src/mocks/MockToken.sol/MockToken.json');
  const pair = artifact('artifacts/src/mocks/MockPair.sol/MockPair.json');
  const desk = artifact('artifacts/src/CreditDesk.sol/CreditDesk.json');
  const erc20 = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
  const pairAbi = parseAbi(['function setReserves(uint112,uint112)']);
  const deskAbi = parseAbi(['function topUp(bytes32,uint256)']);

  const deploy = async (abi: unknown[], bytecode: Hex, args: unknown[]) => {
    const hash = await wallet(deployer).deployContract({ abi: abi as never, bytecode, args: args as never });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('no contract address in the receipt');
    return { address: receipt.contractAddress, block: Number(receipt.blockNumber) };
  };
  const tx = async (from: Address, to: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const hash = await wallet(from).writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never });
    return pub.waitForTransactionReceipt({ hash });
  };

  const curb = await deploy(token.abi, token.bytecode, ['The Curb (rehearsal)', 'CURB', 18]);
  const usd = await deploy(token.abi, token.bytecode, ['A dollar (rehearsal)', 'USD', 6]);
  const pool = await deploy(pair.abi, pair.bytecode, [curb.address, usd.address]);
  const credit = await deploy(desk.abi, desk.bytecode, [curb.address, treasury]);
  console.error(`deployed CURB ${curb.address} USD ${usd.address} pool ${pool.address} desk ${credit.address} at block ${credit.block}; treasury ${treasury}`);

  // Supply: 1,000,000,000 CURB — 4,000,000 of it in the pool, 100,000 to the payer, the rest with the deployer.
  const E18 = 10n ** 18n;
  await tx(deployer, curb.address, erc20, 'mint', [pool.address, 4_000_000n * E18]);
  await tx(deployer, curb.address, erc20, 'mint', [payer, 100_000n * E18]);
  await tx(deployer, curb.address, erc20, 'mint', [deployer, 995_900_000n * E18]);
  await tx(deployer, usd.address, erc20, 'mint', [pool.address, 20_000n * 10n ** 6n]);
  await tx(deployer, pool.address, pairAbi, 'setReserves', [4_000_000n * E18, 20_000n * 10n ** 6n]);

  const key = `curb_${randomBytes(32).toString('base64url')}`;
  const keyHash = `0x${createHash('sha256').update(key, 'utf8').digest('hex')}` as Hex;
  await tx(payer, curb.address, erc20, 'approve', [credit.address, 2n ** 256n - 1n]);
  const first = await tx(payer, credit.address, deskAbi, 'topUp', [keyHash, 4_000n * E18]);
  // The pool doubles in dollars: US$0.01 a CURB. The second top-up is priced at its own block.
  await tx(deployer, usd.address, erc20, 'mint', [pool.address, 20_000n * 10n ** 6n]);
  await tx(deployer, pool.address, pairAbi, 'setReserves', [4_000_000n * E18, 40_000n * 10n ** 6n]);
  const second = await tx(payer, credit.address, deskAbi, 'topUp', [keyHash, 1_000n * E18]);

  const held = (await pub.readContract({ address: curb.address, abi: erc20, functionName: 'balanceOf', args: [treasury] })) as bigint;
  const atDesk = (await pub.readContract({ address: curb.address, abi: erc20, functionName: 'balanceOf', args: [credit.address] })) as bigint;
  console.error(`treasury holds ${held} base units; the desk holds ${atDesk}; top-ups at blocks ${first.blockNumber} and ${second.blockNumber}`);
  if (held !== 5_000n * E18 || atDesk !== 0n) throw new Error('the top-ups did not land as the record says');

  const record = {
    credits: { network: 'hardhat-local', token: curb.address, desk: credit.address, fromBlock: credit.block, priceSource: { kind: 'uniswap-v2-pair', pair: pool.address, quote: { kind: 'usd-stable' } } },
    key,
    keyHash,
    treasury,
    payer,
    topUps: [
      { block: Number(first.blockNumber), amount: (4_000n * E18).toString(), expectCents: '2000' },
      { block: Number(second.blockNumber), amount: (1_000n * E18).toString(), expectCents: '1000' },
    ],
  };
  // The only line on stdout: what the site's rehearsal test reads.
  console.log(JSON.stringify(record));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
