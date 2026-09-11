import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { keccak256Hex, selector } from '../lib/chain/keccak.ts';
import { SELECTORS, SIGNATURES } from '../lib/chain/abi.ts';

/**
 * Keccak-256 is load-bearing: every function selector in this codebase is
 * derived from it. An error here would not throw — it would call the wrong
 * function on a real contract and return something plausible.
 */
describe('keccak256 against published vectors', () => {
  it('hashes the empty string', () => {
    assert.equal(
      keccak256Hex(''),
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it('hashes "abc"', () => {
    assert.equal(
      keccak256Hex('abc'),
      '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });

});

/**
 * DECLARED LIMITATION — read this before trusting the block below.
 *
 * The two vectors above are published and independent, but both fit in a single
 * 136-byte rate block. Multi-block absorption and the padding boundary are
 * therefore NOT covered by an independent source here.
 *
 * The values below were computed by this implementation after it reproduced the
 * published vectors and all nine well-known selectors. They are **regression
 * pins**: they lock current behaviour so a later refactor cannot change it
 * silently. They are not evidence that the behaviour is correct. Replacing them
 * with vectors from an independent implementation is a real improvement and is
 * still outstanding.
 */
describe('multi-block absorption (regression pins, not independent vectors)', () => {
  const pins: readonly [number, string][] = [
    [135, '0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446'],
    [136, '0xa6c4d403279fe3e0af03729caada8374b5ca54d8065329a3ebcaeb4b60aa386e'],
    [137, '0xd869f639c7046b4929fc92a4d988a8b22c55fbadb802c0c66ebcd484f1915f39'],
    [200, '0x96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d'],
  ];

  for (const [length, expected] of pins) {
    it(`is stable for ${length} bytes`, () => {
      assert.equal(keccak256Hex('a'.repeat(length)), expected);
    });
  }
});

/**
 * These eight are widely published. Reproducing them from the implementation is
 * what licenses trusting it for the ones that are not — `uiMultiplier()` and
 * `oraclePaused()` have no folklore to check against.
 */
describe('well-known selectors reproduce', () => {
  const known: readonly [string, string][] = [
    ['name()', '0x06fdde03'],
    ['symbol()', '0x95d89b41'],
    ['decimals()', '0x313ce567'],
    ['totalSupply()', '0x18160ddd'],
    ['balanceOf(address)', '0x70a08231'],
    ['transfer(address,uint256)', '0xa9059cbb'],
    ['paused()', '0x5c975abb'],
    ['owner()', '0x8da5cb5b'],
    ['latestRoundData()', '0xfeaf968c'],
  ];

  for (const [signature, expected] of known) {
    it(`derives ${signature}`, () => {
      assert.equal(selector(signature), expected);
    });
  }
});

describe('the selector table', () => {
  it('derives every entry from its signature', () => {
    for (const [key, signature] of Object.entries(SIGNATURES)) {
      assert.equal(
        SELECTORS[key as keyof typeof SIGNATURES],
        selector(signature),
        `${key} does not match its signature`,
      );
    }
  });

  it('produces four-byte selectors throughout', () => {
    for (const [key, value] of Object.entries(SELECTORS)) {
      assert.match(value, /^0x[0-9a-f]{8}$/, `${key} is not a four-byte selector`);
    }
  });
});
