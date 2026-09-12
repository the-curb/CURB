/**
 * Strict arguments for the operator's tools: every `--flag` must be one the
 * tool knows and must be followed by its value; `--flag=value`, a typo, or a
 * flag with no value is a refusal, never a silently swallowed positional or a
 * silently defaulted setting. Addresses are checked as viem checks them —
 * with the EIP-55 checksum when the letters are mixed — so a mangled
 * address is refused with its value, not thrown from an encoder.
 */

import { getAddress, isAddress as viemIsAddress, type Address } from 'viem';

export interface Parsed {
  readonly positionals: string[];
  readonly flags: Record<string, string>;
}

export function parseArgs(argv: readonly string[], known: readonly string[], fail: (why: string) => never): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (name.includes('=')) fail(`write --${name.split('=')[0]} <value>, not ${a}`);
      if (!known.includes(name)) fail(`unknown flag ${a}; the flags are ${known.map((k) => `--${k}`).join(', ')}`);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${a} needs a value`);
      if (name in flags) fail(`${a} is given twice`);
      flags[name] = value;
      i += 1;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** A 20-byte hex address, checksum-checked when mixed case; returned checksummed. */
export function address(v: string, what: string, fail: (why: string) => never): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) fail(`${what} is not a 20-byte hex address: ${v}`);
  if (!viemIsAddress(v)) fail(`${what} has a wrong EIP-55 checksum: ${v} (write it all in lower case if it was copied without one)`);
  return getAddress(v);
}

export function unsigned(v: string, what: string, fail: (why: string) => never): bigint {
  if (!/^\d+$/.test(v)) fail(`${what} must be an unsigned integer: ${v}`);
  return BigInt(v);
}
