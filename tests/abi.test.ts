import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  decodeAddressWord,
  decodeInt,
  decodeString,
  decodeUint,
  formatUnits,
  SELECTORS,
  words,
} from '../lib/chain/abi.ts';
import { formatAnswer } from '../lib/chain/oracle.ts';
import { readTokenString, readTokenUint } from '../lib/chain/token-read.ts';
import { isRead } from '../lib/doctrine/reading.ts';
import { tokenByKey } from '../lib/chain/tokens.ts';

const word = (hex: string) => `0x${hex.padStart(64, '0')}`;

describe('decoders', () => {
  it('decodes a dynamic string', () => {
    // offset 0x20, length 4, then "USDG" padded right.
    const encoded =
      '0x' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000004' +
      '5553444700000000000000000000000000000000000000000000000000000000';
    assert.equal(decodeString(encoded), 'USDG');
  });

  it('decodes the older bytes32 string form', () => {
    assert.equal(
      decodeString('0x5553444700000000000000000000000000000000000000000000000000000000'),
      'USDG',
    );
  });

  it('returns null rather than a guess for undecodable data', () => {
    assert.equal(decodeString('0x'), null);
    assert.equal(decodeUint('0x'), null);
  });

  it('reads an address out of a right-aligned word', () => {
    assert.equal(
      decodeAddressWord(word('68184c449e1a8f34fa18d289737129fd27b66f8f')),
      '0x68184c449e1a8f34fa18d289737129fd27b66f8f',
    );
  });

  it('treats an empty slot as absent, not as the zero address', () => {
    assert.equal(decodeAddressWord(word('0')), null);
  });

  it('formats units without floating point', () => {
    // The USDG supply recorded by hand on 8 September 2026, at 6 decimals.
    assert.equal(formatUnits(675577905273973n, 6), '675,577,905.273973');
    assert.equal(formatUnits(0n, 18), '0');
    assert.equal(formatUnits(1n, 18), '0.000000000000000001');
    assert.equal(formatUnits(44502302840140188262049n, 18), '44,502.302840140188262049');
  });
});

describe('signed answers', () => {
  it('decodes a negative int256 as negative, not as an enormous positive', () => {
    // -1 in two's complement is all-ones.
    assert.equal(decodeInt(`0x${'f'.repeat(64)}`), -1n);
    assert.equal(decodeInt(word('64')), 100n);
  });

  it('rejects a non-positive feed answer rather than displaying it', () => {
    // Vendor guidance: reject zero or negative answers.
    assert.equal(formatAnswer(-1n, 8), null);
    assert.equal(formatAnswer(0n, 8), null);
  });

  it('scales a positive answer by its decimals', () => {
    // The documented example: 30000000000 at 8 decimals is $300.00.
    assert.equal(formatAnswer(30000000000n, 8), '300.00');
  });

  it('splits a static return into 32-byte words', () => {
    const encoded = `0x${'11'.repeat(32)}${'22'.repeat(32)}`;
    const parts = words(encoded);
    assert.equal(parts.length, 2);
    assert.equal(parts[0], `0x${'11'.repeat(32)}`);
  });
});

/**
 * Selectors are computed from signatures, and `tests/keccak.test.ts` pins the
 * hash function itself. This closes the loop at the other end: it calls two of
 * them against a token whose values were recorded independently, so a break
 * anywhere in that chain fails here instead of returning nonsense in production.
 *
 * It needs the network. When the chain does not answer it says so and stops,
 * rather than passing on an absence.
 */
describe('selectors, checked against the chain', { concurrency: false }, () => {
  it('has four-byte selectors', () => {
    for (const [name, selector] of Object.entries(SELECTORS)) {
      assert.match(selector, /^0x[0-9a-f]{8}$/, `${name} is not a four-byte selector`);
    }
  });

  it('reads the recorded decimals and symbol back from USDG', async (t) => {
    const usdg = tokenByKey('usdg');
    assert.ok(usdg, 'usdg must be in the token registry');

    const opts = { intervalSeconds: 86400, timeoutMs: 10_000 };
    const [decimals, symbol] = await Promise.all([
      readTokenUint(usdg.address, 'decimals', opts),
      readTokenString(usdg.address, 'symbol', opts),
    ]);

    if (!isRead(decimals) || !isRead(symbol)) {
      t.skip('chain did not answer — selector check not performed, and not assumed to pass');
      return;
    }
    assert.equal(Number(decimals.value), usdg.observedDecimals);
    assert.equal(symbol.value, usdg.observedSymbol);
  });
});
