/**
 * Safe 1.4.1, as the operator's tools use it: the canonical addresses, the
 * creation through the proxy factory, the transaction hash a Safe signs
 * (EIP-712), and the two calls that let a quorum act without any hosted
 * interface — each owner sends `approveHash` from their own wallet, then
 * anyone sends `execTransaction` with pre-validated signatures (v = 1, r =
 * the owner, s = 0) for the owners that approved, sorted by address.
 *
 * Nothing here signs or sends. The hash is checked against the Safe's own
 * `getTransactionHash` before it is shown, so an encoding mistake is a
 * refusal, not a wrong hash handed to a signer.
 */

import { concatHex, encodeAbiParameters, encodeFunctionData, getContractAddress, hashTypedData, keccak256, parseAbi, type Address, type Hex } from 'viem';

/** Canonical 1.4.1 deployments (deterministic addresses). Checked for code before use, never assumed. */
export const SAFE_1_4_1 = {
  proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  singletonL2: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
} as const;

export const ZERO = '0x0000000000000000000000000000000000000000' as const;

export const safeAbi = parseAbi([
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function masterCopy() view returns (address)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function approveHash(bytes32 hashToApprove)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
]);

export const factoryAbi = parseAbi(['function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)', 'function proxyCreationCode() pure returns (bytes)']);

export interface CreationPlan {
  readonly initializer: Hex;
  readonly data: Hex;
  readonly salt: Hex;
  readonly predicted: Address;
}

/** The creation of a Safe with these owners and threshold: the factory call, and the address CREATE2 gives it. */
export function planCreation(owners: readonly Address[], threshold: bigint, saltNonce: bigint, proxyCreationCode: Hex, singleton: Address = SAFE_1_4_1.singletonL2, factory: Address = SAFE_1_4_1.proxyFactory): CreationPlan {
  const initializer = encodeFunctionData({ abi: safeAbi, functionName: 'setup', args: [[...owners], threshold, ZERO, '0x', SAFE_1_4_1.fallbackHandler, ZERO, 0n, ZERO] });
  const data = encodeFunctionData({ abi: factoryAbi, functionName: 'createProxyWithNonce', args: [singleton, initializer, saltNonce] });
  // SafeProxyFactory: salt = keccak256(keccak256(initializer) ++ saltNonce); deployment code = proxyCreationCode ++ abi.encode(singleton).
  const salt = keccak256(concatHex([keccak256(initializer), encodeAbiParameters([{ type: 'uint256' }], [saltNonce])]));
  const deploymentCode = concatHex([proxyCreationCode, encodeAbiParameters([{ type: 'address' }], [singleton])]);
  const predicted = getContractAddress({ opcode: 'CREATE2', from: factory, salt, bytecodeHash: keccak256(deploymentCode) });
  return { initializer, data, salt, predicted };
}

export interface SafeTx {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly operation: 0 | 1;
  readonly safeTxGas: bigint;
  readonly baseGas: bigint;
  readonly gasPrice: bigint;
  readonly gasToken: Address;
  readonly refundReceiver: Address;
  readonly nonce: bigint;
}

/** A plain call from the Safe, no gas refund, at the given nonce. */
export function plainSafeTx(to: Address, data: Hex, nonce: bigint, value = 0n): SafeTx {
  return { to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce };
}

/** The hash the Safe's owners approve: EIP-712 over the SafeTx, in the Safe's domain (chain id, the Safe). */
export function safeTxHash(chainId: number, safe: Address, tx: SafeTx): Hex {
  return hashTypedData({
    domain: { chainId: BigInt(chainId), verifyingContract: safe },
    types: {
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    message: { ...tx },
  });
}

export function approveHashData(hash: Hex): Hex {
  return encodeFunctionData({ abi: safeAbi, functionName: 'approveHash', args: [hash] });
}

/** Pre-validated signatures for owners that approved the hash on chain: {r = owner, s = 0, v = 1}, sorted by owner address ascending, as the Safe requires. */
export function preValidatedSignatures(approvers: readonly Address[]): Hex {
  const sorted = [...approvers].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  return concatHex(sorted.map((owner) => concatHex([encodeAbiParameters([{ type: 'address' }], [owner]), `0x${'0'.repeat(64)}`, '0x01'])));
}

export function execTransactionData(tx: SafeTx, approvers: readonly Address[]): Hex {
  return encodeFunctionData({
    abi: safeAbi,
    functionName: 'execTransaction',
    args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, preValidatedSignatures(approvers)],
  });
}
