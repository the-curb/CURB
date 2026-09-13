/**
 * A rehearsal of a deployed series, on a Hardhat node on this machine.
 *
 * Deploys two mock components and the series prototype, runs the worked
 * example against them as real transactions — Alice mints 25, others 75,
 * Alice allocates 25 for exit, the issuer halts A, Alice's A claim reverts
 * and her B claim pays, A resumes, Bob mints 10 — and prints the
 * CURB_SERIES_DEPLOYMENTS entry the site needs to index and reconcile it.
 *
 *   npx hardhat node                # in one terminal
 *   node scripts/rehearsal.ts       # in another; prints the env line
 *
 * Nothing here touches a public chain, holds a key, or is a deployment
 * anyone should rely on. It exists so the index, the reconciliation and
 * the wallet endpoints can be shown working against a chain with real
 * events before there is a chain that matters.
 */

import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { assertLoopbackRpc } from './lib/local-chain.ts';

const RPC = process.env.REHEARSAL_RPC_URL ?? 'http://127.0.0.1:8545';
assertLoopbackRpc(RPC);
const QA = 10n * 10n ** 18n;
const QB = 20n * 10n ** 18n;
const CAP = 1_000n;

function artifact(name: string): { abi: unknown[]; bytecode: Hex } {
  const path = name === 'MockToken' ? 'artifacts/src/mocks/MockToken.sol/MockToken.json' : 'artifacts/src/CompanySeries.sol/CompanySeries.json';
  const j = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex };
  return j;
}

const chain = { id: 31337, name: 'Hardhat (local)', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;

async function main() {
  const pub = createPublicClient({ chain, transport: http(RPC) });
  if (await pub.getChainId() !== 31337) throw new Error('rehearsal refused: the node must answer chain id 31337');
  const accounts = await createWalletClient({ chain, transport: http(RPC) }).getAddresses();
  const [operator, alice, others, bob] = accounts;
  if (!operator || !alice || !others || !bob) throw new Error('the node exposes fewer than four unlocked accounts');
  const wallet = (account: Address) => createWalletClient({ chain, transport: http(RPC), account });

  const mock = artifact('MockToken');
  const series = artifact('CompanySeries');
  const erc20 = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function setHalted(bool)', 'function balanceOf(address) view returns (uint256)']);
  const seriesAbi = parseAbi([
    'function setMintPermit(address,uint64)',
    'function setClaimPermit(address,bool)',
    'function mint(uint256,uint256)',
    'function allocateExit(uint256)',
    'function claimComponent(uint8)',
    'function totalSupply() view returns (uint256)',
    'function reservedA() view returns (uint256)',
    'function reservedB() view returns (uint256)',
    'function claimA(address) view returns (uint256)',
    'function liabilityA() view returns (uint256)',
  ]);

  const deploy = async (from: Address, abi: unknown[], bytecode: Hex, args: unknown[]) => {
    const hash = await wallet(from).deployContract({ abi: abi as never, bytecode, args: args as never });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('no contract address in the receipt');
    return { address: receipt.contractAddress, block: Number(receipt.blockNumber) };
  };

  const a = await deploy(operator, mock.abi, mock.bytecode, ['Component A (mock)', 'A', 18]);
  const b = await deploy(operator, mock.abi, mock.bytecode, ['Component B (mock)', 'B', 18]);
  const s = await deploy(operator, series.abi, series.bytecode, [a.address, b.address, QA, QB, CAP, operator, 'Apple Position - Series 1 (rehearsal)', 'cAAPL-S1']);
  console.error(`deployed A ${a.address} B ${b.address} series ${s.address} at block ${s.block}`);

  const tx = async (from: Address, to: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const hash = await wallet(from).writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never });
    return pub.waitForTransactionReceipt({ hash });
  };
  const tryTx = async (from: Address, to: Address, abi: unknown, functionName: string, args: unknown[]) => {
    try {
      await tx(from, to, abi, functionName, args);
      return true;
    } catch {
      return false;
    }
  };

  for (const who of [alice, others, bob]) {
    await tx(operator, s.address, seriesAbi, 'setMintPermit', [who, 2n ** 64n - 1n]);
    await tx(operator, s.address, seriesAbi, 'setClaimPermit', [who, true]);
    await tx(operator, a.address, erc20, 'mint', [who, 100n * QA]);
    await tx(operator, b.address, erc20, 'mint', [who, 100n * QB]);
    await tx(who, a.address, erc20, 'approve', [s.address, 2n ** 256n - 1n]);
    await tx(who, b.address, erc20, 'approve', [s.address, 2n ** 256n - 1n]);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await tx(alice, s.address, seriesAbi, 'mint', [25n, deadline]);
  await tx(others, s.address, seriesAbi, 'mint', [75n, deadline]);
  await tx(alice, s.address, seriesAbi, 'allocateExit', [25n]);
  await tx(operator, a.address, erc20, 'setHalted', [true]);
  const aClaimWhileHalted = await tryTx(alice, s.address, seriesAbi, 'claimComponent', [0]);
  await tx(alice, s.address, seriesAbi, 'claimComponent', [1]);
  const bobWhileHalted = await tryTx(bob, s.address, seriesAbi, 'mint', [10n, deadline]);
  await tx(operator, a.address, erc20, 'setHalted', [false]);
  await tx(bob, s.address, seriesAbi, 'mint', [10n, deadline]);

  const read = (fn: string, args: unknown[] = []) => pub.readContract({ address: s.address, abi: seriesAbi, functionName: fn as never, args: args as never }) as Promise<bigint>;
  const row = { n: await read('totalSupply'), reservedA: await read('reservedA'), reservedB: await read('reservedB'), aliceClaimA: await read('claimA', [alice]) };
  console.error(`worked example on chain: n=${row.n} reservedA=${row.reservedA} reservedB=${row.reservedB} alice.claimA=${row.aliceClaimA}; A claim while halted ok=${aClaimWhileHalted}; bob mint while halted ok=${bobWhileHalted}`);
  if (row.n !== 85n || row.reservedA !== 250n * 10n ** 18n || row.reservedB !== 0n || aClaimWhileHalted || bobWhileHalted) throw new Error('the worked example did not land as the blueprint says');

  const deployments = {
    'apple-s1': {
      chainId: 31337,
      address: s.address,
      components: { A: a.address, B: b.address },
      fromBlock: a.block,
      q: { A: QA.toString(), B: QB.toString() },
      capLots: CAP.toString(),
    },
  };
  // The only line on stdout: the env the site needs.
  console.log(JSON.stringify(deployments));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
