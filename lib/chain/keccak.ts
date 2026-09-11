/**
 * Keccak-256, implemented here because Node ships SHA3-256 and Ethereum does not
 * use it. The two differ only in the padding byte, which is exactly the kind of
 * difference that produces confident, wrong answers.
 *
 * This exists so that function selectors are **computed from their signatures**
 * rather than pinned from memory. Pinning works for `decimals()`, which everyone
 * knows; it fails silently for `uiMultiplier()`, which nobody has memorised. A
 * guessed selector does not throw — it calls a different function or reverts,
 * and a reader cannot tell the difference from a token that lacks the feature.
 *
 * `tests/keccak.test.ts` checks it against published vectors and against the
 * well-known selectors, so a mistake here fails the suite rather than the chain.
 */

const ROUNDS = 24;

const ROUND_CONSTANTS: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rotation offsets, indexed by lane = x + 5y. */
const RHO: readonly number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const MASK64 = (1n << 64n) - 1n;

function rotl(value: bigint, shift: number): bigint {
  if (shift === 0) return value;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

/** Keccak-f[1600] permutation, in place. */
function permute(state: bigint[]): void {
  const c = new Array<bigint>(5);
  const d = new Array<bigint>(5);
  const b = new Array<bigint>(25);

  for (let round = 0; round < ROUNDS; round += 1) {
    // theta
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] = state[x + 5 * y]! ^ d[x]!;
      }
    }

    // rho and pi
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y]!, RHO[x + 5 * y]!);
      }
    }

    // chi
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] =
          b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & b[((x + 2) % 5) + 5 * y]!) & MASK64;
      }
    }

    // iota
    state[0] = state[0]! ^ ROUND_CONSTANTS[round]!;
  }
}

/** Rate for Keccak-256: 1088 bits. */
const RATE_BYTES = 136;

export function keccak256(input: Uint8Array): Uint8Array {
  // Keccak padding is 0x01 … 0x80. SHA-3 uses 0x06; that one byte is the whole
  // difference between this function and the one Node already provides.
  const padLength = RATE_BYTES - (input.length % RATE_BYTES);
  const padded = new Uint8Array(input.length + padLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80;

  const state = new Array<bigint>(25).fill(0n);

  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      let word = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) {
        word = (word << 8n) | BigInt(padded[offset + lane * 8 + byte] ?? 0);
      }
      state[lane] = state[lane]! ^ word;
    }
    permute(state);
  }

  // Squeeze 32 bytes; the rate is larger than the output, so one pass is enough.
  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    let word = state[lane]!;
    for (let byte = 0; byte < 8; byte += 1) {
      out[lane * 8 + byte] = Number(word & 0xffn);
      word >>= 8n;
    }
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

export function keccak256Hex(text: string): string {
  return toHex(keccak256(new TextEncoder().encode(text)));
}

/**
 * The first four bytes of keccak256 of the canonical signature.
 * `selector('uiMultiplier()')` → '0x...' — derived, not remembered.
 */
export function selector(signature: string): string {
  return keccak256Hex(signature).slice(0, 10);
}
