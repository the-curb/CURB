/**
 * The exact bytes a wallet would sign, for a series that is deployed.
 *
 * The site holds no key and signs nothing; it can still show, for a preview
 * a holder has reviewed, what the transaction would be — the approvals on
 * each component and the call on the series — so any wallet, or a script,
 * can send it. Selectors are computed from signatures, never pinned, and
 * the signatures are checked against the contract's ABI in the tests.
 */

import { selector } from '../chain/keccak.ts';

export const SIGNATURES = {
  approve: 'approve(address,uint256)',
  mint: 'mint(uint256,uint256)',
  allocateExit: 'allocateExit(uint256)',
  claimComponent: 'claimComponent(uint8)',
} as const;

const word = (n: bigint): string => {
  if (n < 0n || n >= 1n << 256n) throw new Error('a word holds 256 bits');
  return n.toString(16).padStart(64, '0');
};
const address = (raw: string): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error('an address is 20 bytes of hex');
  return raw.toLowerCase();
};
const addressWord = (raw: string): string => address(raw).slice(2).padStart(64, '0');

export interface PreparedCall {
  readonly to: string;
  readonly data: string;
  readonly signature: string;
  readonly says: string;
}

export function approveCall(token: string, spender: string, amount: bigint, label: string): PreparedCall {
  return { to: address(token), data: `${selector(SIGNATURES.approve)}${addressWord(spender)}${word(amount)}`, signature: SIGNATURES.approve, says: `allow the series to take ${amount.toString()} units of ${label}` };
}

export function mintCall(series: string, lots: bigint, deadline: bigint): PreparedCall {
  return { to: address(series), data: `${selector(SIGNATURES.mint)}${word(lots)}${word(deadline)}`, signature: SIGNATURES.mint, says: `mint ${lots.toString()} lots, valid until unix time ${deadline.toString()}` };
}

export function allocateExitCall(series: string, lots: bigint): PreparedCall {
  return { to: address(series), data: `${selector(SIGNATURES.allocateExit)}${word(lots)}`, signature: SIGNATURES.allocateExit, says: `burn ${lots.toString()} lots and record the claims` };
}

export function claimCall(series: string, component: 'A' | 'B'): PreparedCall {
  return { to: address(series), data: `${selector(SIGNATURES.claimComponent)}${word(component === 'A' ? 0n : 1n)}`, signature: SIGNATURES.claimComponent, says: `pay the caller's whole claim of ${component} to the caller` };
}
