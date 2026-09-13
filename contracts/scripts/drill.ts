/**
 * The operational drill, on a Hardhat node on this machine (blueprint O02).
 *
 * Deploys a fresh series with two mock components, forms positions, and
 * then runs the incidents the blueprint names, on chain:
 *
 *   1. the issuer freezes A          — claims of A revert, claims of B pay,
 *                                       minting is refused while A is frozen
 *   2. the series is short of A       — the issuer seizes part of what the
 *                                       series holds; A's whole-liability
 *                                       check halts A payments, B still pays
 *   3. the backend is down            — a holder claims with no site involved:
 *                                       the permit is on chain
 *   6. the operator is a quorum       — the series' operator becomes a 2-of-3
 *                                       multisig (a mock, for the rehearsal);
 *                                       one signer proposes a stop, it waits;
 *                                       a second confirms, minting stops; the
 *                                       resume needs two again
 *
 * "The source is lost" and "the RPC fails" are the site's incidents, not the
 * chain's; tests/positions-drill.test.ts runs them against this deployment.
 * Every transaction hash is printed so a person can check who did what. The
 * only line on stdout is the JSON the test needs.
 *
 *   npx hardhat node          # one terminal
 *   node scripts/drill.ts     # another
 */

import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, toFunctionSelector, type Abi, type Address, type Hex } from 'viem';
import { assertLoopbackRpc } from './lib/local-chain.ts';

const RPC = process.env.REHEARSAL_RPC_URL ?? 'http://127.0.0.1:8545';
assertLoopbackRpc(RPC);
const QA = 10n * 10n ** 18n;
const QB = 20n * 10n ** 18n;
const CAP = 1_000n;

function artifact(name: string): { abi: unknown[]; bytecode: Hex } {
  const path = name === 'MockToken' ? 'artifacts/src/mocks/MockToken.sol/MockToken.json' : name === 'MockMultisig' ? 'artifacts/src/mocks/MockMultisig.sol/MockMultisig.json' : 'artifacts/src/CompanySeries.sol/CompanySeries.json';
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as { abi: unknown[]; bytecode: Hex };
}

const chain = { id: 31337, name: 'Hardhat (local)', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;

interface Step {
  readonly scenario: string;
  readonly who: string;
  readonly did: string;
  readonly expected: string;
  readonly outcome: 'AS_EXPECTED' | 'NOT_AS_EXPECTED';
  readonly tx: string | null;
  readonly revert: string | null;
}

async function main() {
  const pub = createPublicClient({ chain, transport: http(RPC) });
  if (await pub.getChainId() !== 31337) throw new Error('rehearsal refused: the node must answer chain id 31337');
  const accounts = await createWalletClient({ chain, transport: http(RPC) }).getAddresses();
  const [operator, alice, bob, carol] = accounts;
  if (!operator || !alice || !bob || !carol) throw new Error('the node exposes fewer than four unlocked accounts');
  const wallet = (account: Address) => createWalletClient({ chain, transport: http(RPC), account });

  const mock = artifact('MockToken');
  const series = artifact('CompanySeries');
  const erc20 = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function setHalted(bool)', 'function seize(address,uint256)', 'function balanceOf(address) view returns (uint256)']);
  // The artifact's ABI, so a revert decodes to its name rather than a selector — and the selectors of its
  // custom errors, for the node answers viem does not decode ("unrecognized custom error (return data: 0x…)").
  const seriesAbi = series.abi;
  const errorNames = new Map<string, string>();
  for (const item of series.abi as { type: string; name?: string; inputs?: { type: string }[] }[]) {
    if (item.type === 'error' && item.name) errorNames.set(toFunctionSelector(`${item.name}(${(item.inputs ?? []).map((i) => i.type).join(',')})`), item.name);
  }

  const deploy = async (abi: unknown[], bytecode: Hex, args: unknown[]) => {
    const hash = await wallet(operator).deployContract({ abi: abi as never, bytecode, args: args as never });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('no contract address in the receipt');
    return { address: receipt.contractAddress, block: Number(receipt.blockNumber) };
  };
  const a = await deploy(mock.abi, mock.bytecode, ['Component A (mock, drill)', 'A', 18]);
  const b = await deploy(mock.abi, mock.bytecode, ['Component B (mock, drill)', 'B', 18]);
  const s = await deploy(series.abi, series.bytecode, [a.address, b.address, QA, QB, CAP, operator, 'Apple Position - Series 1 (drill)', 'cAAPL-S1']);
  console.error(`drill: deployed A ${a.address} B ${b.address} series ${s.address} at block ${s.block}`);

  const steps: Step[] = [];
  const tx = async (from: Address, to: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const hash = await wallet(from).writeContract({ address: to, abi: abi as never, functionName: functionName as never, args: args as never });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return { hash, gasUsed: receipt.gasUsed };
  };
  const attempt = async (scenario: string, who: string, from: Address, did: string, expected: 'SUCCEEDS' | 'REVERTS', to: Address, abi: unknown, functionName: string, args: unknown[]) => {
    try {
      const r = await tx(from, to, abi, functionName, args);
      steps.push({ scenario, who, did, expected: expected === 'SUCCEEDS' ? 'the transaction succeeds' : 'the transaction reverts', outcome: expected === 'SUCCEEDS' ? 'AS_EXPECTED' : 'NOT_AS_EXPECTED', tx: r.hash, revert: null });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // viem prints a decoded custom error as "Error: Name(uint8 component)" followed by its arguments "(0)".
      const line = message.split('\n').find((l) => /^Error: [A-Z][A-Za-z]+\(/.test(l.trim()));
      const name = line ? /([A-Z][A-Za-z]+)\(/.exec(line.trim())?.[1] : null;
      const args = line ? /^\s*\(([^)]*)\)\s*$/m.exec(message.slice(message.indexOf(line) + line.length))?.[1] : null;
      const selector = /return data: (0x[0-9a-fA-F]{8})/.exec(message)?.[1]?.toLowerCase() ?? null;
      const reason = name ? `${name}(${args ?? ''})` : selector && errorNames.has(selector) ? `${errorNames.get(selector)}()` : message.split(String.fromCharCode(10))[0]!.slice(0, 160);
      steps.push({ scenario, who, did, expected: expected === 'SUCCEEDS' ? 'the transaction succeeds' : 'the transaction reverts', outcome: expected === 'REVERTS' ? 'AS_EXPECTED' : 'NOT_AS_EXPECTED', tx: null, revert: reason });
    }
  };
  const read = (fn: string, args: unknown[] = []) => pub.readContract({ address: s.address, abi: seriesAbi, functionName: fn as never, args: args as never }) as Promise<bigint>;

  // ── positions formed ──────────────────────────────────────────────────
  for (const who of [alice, bob, carol]) {
    await tx(operator, s.address, seriesAbi, 'setMintPermit', [who, 2n ** 64n - 1n]);
    await tx(operator, s.address, seriesAbi, 'setClaimPermit', [who, true]);
    await tx(operator, a.address, erc20, 'mint', [who, 100n * QA]);
    await tx(operator, b.address, erc20, 'mint', [who, 100n * QB]);
    await tx(who, a.address, erc20, 'approve', [s.address, 2n ** 256n - 1n]);
    await tx(who, b.address, erc20, 'approve', [s.address, 2n ** 256n - 1n]);
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await attempt('setup', 'alice', alice, 'mints 40 lots', 'SUCCEEDS', s.address, seriesAbi, 'mint', [40n, deadline]);
  await attempt('setup', 'bob', bob, 'mints 30 lots', 'SUCCEEDS', s.address, seriesAbi, 'mint', [30n, deadline]);
  await attempt('setup', 'alice', alice, 'allocates 10 lots for exit', 'SUCCEEDS', s.address, seriesAbi, 'allocateExit', [10n]);
  await attempt('setup', 'bob', bob, 'allocates 10 lots for exit', 'SUCCEEDS', s.address, seriesAbi, 'allocateExit', [10n]);

  // ── 1. the issuer freezes A ───────────────────────────────────────────
  await attempt('1 issuer freezes A', 'the issuer of A (mock)', operator, 'halts every transfer of A', 'SUCCEEDS', a.address, erc20, 'setHalted', [true]);
  await attempt('1 issuer freezes A', 'alice', alice, 'claims her A (100 units reserved)', 'REVERTS', s.address, seriesAbi, 'claimComponent', [0]);
  await attempt('1 issuer freezes A', 'alice', alice, 'claims her B (200 units reserved)', 'SUCCEEDS', s.address, seriesAbi, 'claimComponent', [1]);
  await attempt('1 issuer freezes A', 'carol', carol, 'tries to mint 5 lots while A is frozen', 'REVERTS', s.address, seriesAbi, 'mint', [5n, deadline]);
  await attempt('1 issuer freezes A', 'the issuer of A (mock)', operator, 'resumes transfers of A', 'SUCCEEDS', a.address, erc20, 'setHalted', [false]);
  await attempt('1 issuer freezes A', 'alice', alice, 'claims her A after the resume', 'SUCCEEDS', s.address, seriesAbi, 'claimComponent', [0]);

  // ── 3. the backend is down ────────────────────────────────────────────
  // No site is involved in any of these transactions; the permit is on chain.
  await attempt('3 backend down', 'bob', bob, 'claims his B with no backend involved', 'SUCCEEDS', s.address, seriesAbi, 'claimComponent', [1]);

  // ── 6. the operator is a quorum ───────────────────────────────────────
  // The series' operator becomes a 2-of-3 multisig of the node's next three
  // accounts; the operator's bytes are the ones scripts/operator-calldata.mjs
  // prints (encoded here the same way, from the artifact's ABI).
  const [s1, s2, s3] = [accounts[4], accounts[5], accounts[6]];
  if (!s1 || !s2 || !s3) throw new Error('the node exposes fewer than seven unlocked accounts');
  const multisigArtifact = artifact('MockMultisig');
  const msig = await deploy(multisigArtifact.abi, multisigArtifact.bytecode, [[s1, s2, s3], 2n]);
  const msigAbi = parseAbi(['function propose(address,bytes) returns (uint256)', 'function confirm(uint256)', 'function proposalCount() view returns (uint256)']);
  await attempt('6 operator quorum', 'the operator (single key)', operator, 'nominates a 2-of-3 multisig without transferring authority', 'SUCCEEDS', s.address, seriesAbi, 'transferOperator', [msig.address]);
  const acceptData = encodeFunctionData({ abi: seriesAbi as Abi, functionName: 'acceptOperator', args: [] });
  await attempt('6 operator quorum', 'signer 1', s1, 'proposes acceptance from the nominated multisig (1 of 2)', 'SUCCEEDS', msig.address, msigAbi, 'propose', [s.address, acceptData]);
  if ((await read('operator')).toString().toLowerCase() !== operator.toLowerCase()) throw new Error('one signer unexpectedly transferred authority');
  const acceptId = (await pub.readContract({ address: msig.address, abi: msigAbi, functionName: 'proposalCount' })) - 1n;
  await attempt('6 operator quorum', 'signer 2', s2, 'confirms acceptance (2 of 2): the nominated multisig becomes operator', 'SUCCEEDS', msig.address, msigAbi, 'confirm', [acceptId]);
  await attempt('6 operator quorum', 'the former operator', operator, 'tries to stop minting alone after the handover', 'REVERTS', s.address, seriesAbi, 'setMintPaused', [true, 'no longer the operator']);
  const stopData = encodeFunctionData({ abi: seriesAbi as Abi, functionName: 'setMintPaused', args: [true, 'drill: quorum stop'] });
  await attempt('6 operator quorum', 'signer 1', s1, 'proposes a stop of minting (1 of 2 confirmations)', 'SUCCEEDS', msig.address, msigAbi, 'propose', [s.address, stopData]);
  await attempt('6 operator quorum', 'carol', carol, 'mints 1 lot while the stop is still one signature short', 'SUCCEEDS', s.address, seriesAbi, 'mint', [1n, deadline]);
  const stopId = (await pub.readContract({ address: msig.address, abi: msigAbi, functionName: 'proposalCount' })) - 1n;
  await attempt('6 operator quorum', 'signer 2', s2, 'confirms the stop (2 of 2): the multisig executes it', 'SUCCEEDS', msig.address, msigAbi, 'confirm', [stopId]);
  await attempt('6 operator quorum', 'carol', carol, 'tries to mint 1 lot while minting is stopped', 'REVERTS', s.address, seriesAbi, 'mint', [1n, deadline]);
  const resumeData = encodeFunctionData({ abi: seriesAbi as Abi, functionName: 'setMintPaused', args: [false, 'drill: quorum resume after review'] });
  await attempt('6 operator quorum', 'signer 3', s3, 'proposes the resume (1 of 2)', 'SUCCEEDS', msig.address, msigAbi, 'propose', [s.address, resumeData]);
  await attempt('6 operator quorum', 'carol', carol, 'tries to mint 1 lot while the resume is one signature short', 'REVERTS', s.address, seriesAbi, 'mint', [1n, deadline]);
  const resumeId = (await pub.readContract({ address: msig.address, abi: msigAbi, functionName: 'proposalCount' })) - 1n;
  await attempt('6 operator quorum', 'signer 1', s1, 'confirms the resume (2 of 2)', 'SUCCEEDS', msig.address, msigAbi, 'confirm', [resumeId]);
  await attempt('6 operator quorum', 'carol', carol, 'mints 1 lot after the resume', 'SUCCEEDS', s.address, seriesAbi, 'mint', [1n, deadline]);

  // ── 2. the series is short of A ───────────────────────────────────────
  const liabilityBefore = await read('liabilityA');
  const seized = 5n * QA;
  await attempt('2 series short of A', 'the issuer of A (mock)', operator, `seizes ${seized.toString()} base units of A from the series`, 'SUCCEEDS', a.address, erc20, 'seize', [s.address, seized]);
  await attempt('2 series short of A', 'bob', bob, 'claims his A while the series is short of A', 'REVERTS', s.address, seriesAbi, 'claimComponent', [0]);
  await attempt('2 series short of A', 'carol', carol, 'mints 5 lots while the series is short of A', 'REVERTS', s.address, seriesAbi, 'mint', [5n, deadline]);
  const heldA = (await pub.readContract({ address: a.address, abi: erc20, functionName: 'balanceOf', args: [s.address] })) as bigint;
  const liabilityAfter = await read('liabilityA');

  const n = await read('totalSupply');
  const bobClaimA = await read('claimA', [bob]);
  const bobClaimB = await read('claimB', [bob]);
  const notAsExpected = steps.filter((x) => x.outcome !== 'AS_EXPECTED');
  console.error(`drill: ${steps.length} steps, ${notAsExpected.length} not as expected; n=${n} heldA=${heldA} liabilityA=${liabilityAfter} (before seizure ${liabilityBefore}); bob claims A=${bobClaimA} B=${bobClaimB}`);
  if (notAsExpected.length > 0) throw new Error(`the drill did not go as the blueprint says: ${JSON.stringify(notAsExpected)}`);

  const out = {
    ranAt: new Date().toISOString(),
    chainId: 31337,
    deployments: {
      'apple-s1': { chainId: 31337, address: s.address, components: { A: a.address, B: b.address }, fromBlock: a.block, q: { A: QA.toString(), B: QB.toString() }, capLots: CAP.toString() },
    },
    holders: { alice, bob, carol },
    operatorMultisig: { address: msig.address, signers: [s1, s2, s3], threshold: 2 },
    state: { lotsOutstanding: n.toString(), heldA: heldA.toString(), liabilityA: liabilityAfter.toString(), shortfallA: (liabilityAfter - heldA).toString(), bobClaimA: bobClaimA.toString(), bobClaimB: bobClaimB.toString() },
    steps,
  };
  console.log(JSON.stringify(out));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
