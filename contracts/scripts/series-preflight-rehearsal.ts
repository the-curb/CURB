/** Local-only integration: real cached Safe code, deployment dry-run refusals, two-step quorum acceptance. */
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { assertLoopbackRpc } from './lib/local-chain.ts';
import { SAFE_1_4_1, approveHashData, execTransactionData, factoryAbi, planCreation, plainSafeTx, safeAbi, safeTxHash } from './lib/safe.ts';
import { GUARD_STORAGE_SLOT, FALLBACK_STORAGE_SLOT, verifyOperatorSafe, type OperatorSafeExpectation } from './lib/operator-safe.ts';

const RPC = process.env.REHEARSAL_RPC_URL ?? 'http://127.0.0.1:9546';
assertLoopbackRpc(RPC);
const chain = { id: 31337, name: 'Local rehearsal', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
assert.equal(await pub.getChainId(), 31337, 'rehearsal may only send to chain31337');
const [sender, owner1, owner2, owner3] = await createWalletClient({ chain, transport: http(RPC) }).getAddresses();
assert.ok(sender && owner1 && owner2 && owner3, 'four unlocked local accounts required');
const wallet = (account: Address) => createWalletClient({ chain, account, transport: http(RPC) });
const tx = async (from: Address, to: Address, data: Hex) => {
  const hash = await wallet(from).sendTransaction({ to, data });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return hash;
};

const cached = JSON.parse(readFileSync(new URL('../evidence/safe-1.4.1.robinhood.json', import.meta.url), 'utf8')) as { readAt: { block: number }; contracts: Record<string, { address: Address; code: Hex; codeHash: Hex }> };
for (const entry of Object.values(cached.contracts)) {
  assert.equal(keccak256(entry.code).toLowerCase(), entry.codeHash.toLowerCase());
  await pub.request({ method: 'hardhat_setCode' as never, params: [entry.address, entry.code] as never });
}
const creationCode = await pub.readContract({ address: SAFE_1_4_1.proxyFactory, abi: factoryAbi, functionName: 'proxyCreationCode' }) as Hex;
const owners = [owner1, owner2, owner3];
const plan = planCreation(owners, 2n, BigInt(Date.now()), creationCode);
await tx(sender, SAFE_1_4_1.proxyFactory, plan.data);
const code = await pub.getCode({ address: plan.predicted });
const singletonCode = await pub.getCode({ address: SAFE_1_4_1.singletonL2 });
const fallbackCode = await pub.getCode({ address: SAFE_1_4_1.fallbackHandler });
assert.ok(code && singletonCode && fallbackCode);
const expected: OperatorSafeExpectation = { chainId: 31337, version: '1.4.1', owners, threshold: 2, runtimeCodeHash: keccak256(code), singleton: { address: SAFE_1_4_1.singletonL2, runtimeCodeHash: keccak256(singletonCode) }, modules: [], guard: null, fallbackHandler: { address: SAFE_1_4_1.fallbackHandler, runtimeCodeHash: keccak256(fallbackCode) }, reviewedBy: 'local rehearsal fixture only', reviewedAt: new Date().toISOString() };
const asRead = await verifyOperatorSafe(plan.predicted, expected, 31337, {
  chainId: () => pub.getChainId(), blockNumber: () => pub.getBlockNumber(), code: (address, blockNumber) => pub.getCode({ address, blockNumber }),
  owners: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getOwners', blockNumber }),
  threshold: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getThreshold', blockNumber }),
  singleton: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'masterCopy', blockNumber }),
  version: (address, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'VERSION', blockNumber }),
  modules: (address, start, pageSize, blockNumber) => pub.readContract({ address, abi: safeAbi, functionName: 'getModulesPaginated', args: [start, pageSize], blockNumber }),
  storage: (address, slot, blockNumber) => pub.getStorageAt({ address, slot, blockNumber }),
});
const token = JSON.parse(readFileSync(new URL('../artifacts/src/mocks/MockToken.sol/MockToken.json', import.meta.url), 'utf8'));
const deploy = async (artifact: typeof token, args: unknown[]) => {
  const hash = await wallet(sender).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  assert.ok(receipt.contractAddress);
  return receipt.contractAddress;
};
const a = await deploy(token, ['A mock', 'A', 18]);
const b = await deploy(token, ['B mock', 'B', 18]);
const record = { seriesId: 'operator-rehearsal', chainId: 31337, rpcUrl: RPC, components: { A: a, B: b }, decimals: { A: 18, B: 18 }, q: { A: '10', B: '20' }, capLots: '100', operator: plan.predicted, operatorSafe: expected, name: 'Local rehearsal', symbol: 'LOCAL', reviewedBy: 'local fixture only', reviewedAt: new Date().toISOString() };
const file = join(mkdtempSync(join(tmpdir(), 'curb-series-preflight-')), 'record.json');
const checks: { name: string; passed: boolean }[] = [];
const checkDryRun = (name: string, input: unknown, succeeds: boolean, reason?: RegExp) => {
  writeFileSync(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./deploy-series.ts', import.meta.url)), file, '--dry-run'], { encoding: 'utf8', env: { ...process.env, CURB_RPC_URL_LOCAL: RPC, DEPLOYER_PRIVATE_KEY: '' } });
  assert.equal(result.status === 0, succeeds, `${name}: ${result.stderr}`);
  if (reason) assert.match(result.stderr, reason);
  checks.push({ name, passed: true });
};
checkDryRun('reviewed local Safe and build accepted by deployment dry-run', record, true);
checkDryRun('EOA operator refused', { ...record, operator: sender }, false, /no code/);
checkDryRun('different owners refused', { ...record, operatorSafe: { ...expected, owners: [sender, owner2, owner3] } }, false, /owners differ/);
checkDryRun('wrong quorum refused', { ...record, operatorSafe: { ...expected, threshold: 3 } }, false, /threshold differs/);
checkDryRun('wrong singleton refused', { ...record, operatorSafe: { ...expected, singleton: { ...expected.singleton, address: a } } }, false, /singleton differs/);
checkDryRun('missing module review refused', { ...record, operatorSafe: { ...expected, modules: undefined } }, false, /explicit complete modules array/);
checkDryRun('unexpected fallback handler refused', { ...record, operatorSafe: { ...expected, fallbackHandler: null } }, false, /fallback handler differs/);
checkDryRun('wrong fallback runtime refused', { ...record, operatorSafe: { ...expected, fallbackHandler: { ...expected.fallbackHandler, runtimeCodeHash: keccak256(code) } } }, false, /fallback handler runtime/);

// Exercise the actual Safe storage layout on this disposable node. Restore each exact slot afterwards.
const zeroWord = `0x${'0'.repeat(64)}`;
await pub.request({ method: 'hardhat_setStorageAt' as never, params: [plan.predicted, GUARD_STORAGE_SLOT, `0x${a.slice(2).padStart(64, '0')}`] as never });
await pub.request({ method: 'evm_mine' as never, params: [] as never });
checkDryRun('unreviewed configured guard refused at actual Safe slot', record, false, /guard differs/);
await pub.request({ method: 'hardhat_setStorageAt' as never, params: [plan.predicted, GUARD_STORAGE_SLOT, zeroWord] as never });
await pub.request({ method: 'hardhat_setStorageAt' as never, params: [plan.predicted, FALLBACK_STORAGE_SLOT, `0x${a.slice(2).padStart(64, '0')}`] as never });
await pub.request({ method: 'evm_mine' as never, params: [] as never });
checkDryRun('changed fallback address refused at actual Safe slot', record, false, /fallback handler differs/);
await pub.request({ method: 'hardhat_setStorageAt' as never, params: [plan.predicted, FALLBACK_STORAGE_SLOT, `0x${SAFE_1_4_1.fallbackHandler.slice(2).padStart(64, '0')}`] as never });
await pub.request({ method: 'evm_mine' as never, params: [] as never });

// Exercise the actual deployment tool with a fresh test key, funded only on this guarded local node.
const localKey = generatePrivateKey();
const localDeployer = privateKeyToAccount(localKey);
await pub.request({ method: 'hardhat_setBalance' as never, params: [localDeployer.address, `0x${(100n * 10n ** 18n).toString(16)}`] as never });
const sendRecord = { ...record, seriesId: `operator-rehearsal-${Date.now()}` };
writeFileSync(file, JSON.stringify(sendRecord));
const sent = spawnSync(process.execPath, [fileURLToPath(new URL('./deploy-series.ts', import.meta.url)), file], { encoding: 'utf8', env: { ...process.env, CURB_RPC_URL_LOCAL: RPC, DEPLOYER_PRIVATE_KEY: localKey } });
assert.equal(sent.status, 0, sent.stderr);
const deploymentFile = new URL(`../evidence/deployments/${sendRecord.seriesId}.31337.json`, import.meta.url);
const completed = JSON.parse(readFileSync(deploymentFile, 'utf8'));
assert.ok(completed.deployment.address && completed.deployment.transactionHash);
assert.equal(completed.pending, undefined, 'successful receipt finalized the journal');
assert.equal(completed.deployment.deployer.toLowerCase(), localDeployer.address.toLowerCase());
const again = spawnSync(process.execPath, [fileURLToPath(new URL('./deploy-series.ts', import.meta.url)), file], { encoding: 'utf8', env: { ...process.env, CURB_RPC_URL_LOCAL: RPC, DEPLOYER_PRIVATE_KEY: localKey } });
assert.notEqual(again.status, 0);
assert.match(again.stderr, /deployment record.*already exists/);
const toolDeployment = completed.deployment;
unlinkSync(deploymentFile); // Exact rehearsal-owned file; its result is retained in the final evidence below.
checks.push({ name: 'deployment CLI sends locally, finalizes the journal and refuses a duplicate run', passed: true });

// Actual cached Safe bytecode executes acceptance; no mock quorum can satisfy this check.
const seriesArtifact = JSON.parse(readFileSync(new URL('../artifacts/src/CompanySeries.sol/CompanySeries.json', import.meta.url), 'utf8'));
const series = await deploy(seriesArtifact, [a, b, 10n, 20n, 100n, sender, 'Local handover', 'LOCAL']);
const call = (name: string, args: unknown[]) => encodeFunctionData({ abi: seriesArtifact.abi, functionName: name, args });
await tx(sender, series, call('transferOperator', [plan.predicted]));
assert.equal((await pub.readContract({ address: series, abi: seriesArtifact.abi, functionName: 'operator' }) as string).toLowerCase(), sender.toLowerCase());
const nonce = await pub.readContract({ address: plan.predicted, abi: safeAbi, functionName: 'nonce' });
const accept = plainSafeTx(series, call('acceptOperator', []), nonce);
const acceptHash = safeTxHash(31337, plan.predicted, accept);
const safeHash = await pub.readContract({ address: plan.predicted, abi: safeAbi, functionName: 'getTransactionHash', args: [accept.to, accept.value, accept.data, accept.operation, accept.safeTxGas, accept.baseGas, accept.gasPrice, accept.gasToken, accept.refundReceiver, accept.nonce] });
assert.equal(acceptHash, safeHash);
await tx(owner1, plan.predicted, approveHashData(acceptHash));
await assert.rejects(pub.call({ account: sender, to: plan.predicted, data: execTransactionData(accept, [owner1]) }));
checks.push({ name: 'one real Safe owner cannot accept authority', passed: true });
await tx(owner2, plan.predicted, approveHashData(acceptHash));
const accepted = await tx(sender, plan.predicted, execTransactionData(accept, [owner1, owner2]));
assert.equal((await pub.readContract({ address: series, abi: seriesArtifact.abi, functionName: 'operator' }) as string).toLowerCase(), plan.predicted.toLowerCase());
await assert.rejects(pub.call({ account: sender, to: series, data: call('setMintPaused', [true, 'former operator refused']) }));
checks.push({ name: 'two real Safe owners accept; former operator loses authority', passed: true });

const moduleNonce = await pub.readContract({ address: plan.predicted, abi: safeAbi, functionName: 'nonce' });
const enable = plainSafeTx(plan.predicted, encodeFunctionData({ abi: safeAbi, functionName: 'enableModule', args: [a] }), moduleNonce);
const enableHash = safeTxHash(31337, plan.predicted, enable);
await tx(owner1, plan.predicted, approveHashData(enableHash));
await tx(owner2, plan.predicted, approveHashData(enableHash));
await tx(sender, plan.predicted, execTransactionData(enable, [owner1, owner2]));
checkDryRun('real quorum-enabled unreviewed module refused', record, false, /modules differ/);
const moduleCode = await pub.getCode({ address: a });
assert.ok(moduleCode);
checkDryRun('exact reviewed module address and runtime accepted', { ...record, operatorSafe: { ...expected, modules: [{ address: a, runtimeCodeHash: keccak256(moduleCode) }] } }, true);
checkDryRun('changed module runtime hash refused', { ...record, operatorSafe: { ...expected, modules: [{ address: a, runtimeCodeHash: keccak256(code) }] } }, false, /module runtime/);
console.log(JSON.stringify({ ranAt: new Date().toISOString(), chainId: 31337, checks, operatorAsRead: asRead, toolDeployment, series, accepted, limits: [`Safe code cached from Robinhood block ${cached.readAt.block}, installed only on this local node`, 'mock components; no public deployment, issuer eligibility or independent approval'] }));
