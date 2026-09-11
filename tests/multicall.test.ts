import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  AGGREGATE3_SELECTOR,
  BATCH_SIZE,
  decodeAggregate3,
  encodeAggregate3,
  readMany,
  type aggregate3,
} from '../lib/chain/multicall.ts';
import { unread } from '../lib/doctrine/reading.ts';

/**
 * The vectors below are built by hand from the ABI specification, word by word,
 * so a mistake in the encoder cannot be hidden by a mistake in the test that
 * happens to match it. The live-chain check — that a batch answer equals the
 * direct answer — is a rehearsal script, not a unit test.
 */

const w = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');
const ONE = '0x0000000000000000000000000000000000000001';
const TWO = '0x0000000000000000000000000000000000000002';

describe('aggregate3 selector', () => {
  it('is derived from the signature and equals the well-known value', () => {
    assert.equal(AGGREGATE3_SELECTOR, '0x82ad56cb');
  });
});

describe('encodeAggregate3', () => {
  it('lays out two calls exactly as the ABI says', () => {
    const hex = encodeAggregate3([
      { target: ONE, data: '0xfeaf968c' },
      { target: TWO, data: '0x' },
    ]);
    const expected =
      '0x82ad56cb' +
      w(0x20) + // head: the array starts after one word
      w(2) + // two elements
      w(0x40) + // element 0 begins after the two offset words
      w(0xe0) + // element 1 begins after element 0 (5 words = 160 bytes)
      // element 0: target, allowFailure = true, bytes offset, bytes length, bytes
      w(1) +
      w(1) +
      w(0x60) +
      w(4) +
      'feaf968c' + '0'.repeat(56) +
      // element 1: empty calldata has a length word and no data words
      w(2) +
      w(1) +
      w(0x60) +
      w(0);
    assert.equal(hex, expected);
  });

  it('pads calldata that is not a multiple of 32 bytes and lowercases it', () => {
    const hex = encodeAggregate3([{ target: ONE, data: '0xAABBCC' }]);
    assert.ok(hex.endsWith(w(3) + 'aabbcc' + '0'.repeat(58)));
  });

  it('refuses calldata that is not hex', () => {
    assert.throws(() => encodeAggregate3([{ target: ONE, data: '0xzz' }]), /not even-length hex/);
    assert.throws(() => encodeAggregate3([{ target: ONE, data: '0xabc' }]), /not even-length hex/);
  });
});

describe('decodeAggregate3', () => {
  // Result[] of two: (true, uint 8) and (false, a four-byte custom error).
  const returned =
    '0x' +
    w(0x20) +
    w(2) +
    w(0x40) + // result 0 after the two offset words
    w(0xc0) + // result 1 after result 0 (4 words = 128 bytes)
    w(1) + w(0x40) + w(32) + w(8) +
    w(0) + w(0x40) + w(4) + '800ab12c' + '0'.repeat(56);

  it('returns each result with its own success flag and untouched bytes', () => {
    const results = decodeAggregate3(returned, 2);
    assert.deepEqual(results, [
      { success: true, data: `0x${w(8)}` },
      { success: false, data: '0x800ab12c' },
    ]);
  });

  it('returns null when the count disagrees with what was asked', () => {
    assert.equal(decodeAggregate3(returned, 3), null);
  });

  it('returns null on truncated data rather than a partial answer', () => {
    assert.equal(decodeAggregate3(returned.slice(0, -64), 2), null);
    assert.equal(decodeAggregate3('0x1234', 1), null);
  });

  it('decodes an empty return payload as success with no bytes', () => {
    const empty = '0x' + w(0x20) + w(1) + w(0x20) + w(1) + w(0x40) + w(0);
    assert.deepEqual(decodeAggregate3(empty, 1), [{ success: true, data: '0x' }]);
  });
});

describe('readMany', () => {
  const opts = { intervalSeconds: 60 };
  const calls = Array.from({ length: 7 }, (_, i) => ({ target: ONE, data: `0x0000000${i}` }));

  /** A runner that answers every subcall with its index, and records chunks. */
  function scripted(fail: (chunkIndex: number) => boolean) {
    const chunks: number[] = [];
    const run: typeof aggregate3 = async (chunk) => {
      const index = chunks.length;
      chunks.push(chunk.length);
      if (fail(index)) return unread('SOURCE_TIMEOUT', { source: 'fake', detail: 'chunk timed out' });
      return {
        state: 'VERIFIED',
        value: chunk.map((c, i) => ({ success: i % 3 !== 2, data: i % 3 === 2 ? '0xdead' : `0x${w(Number(c.data.slice(-1)))}` })),
        source: 'fake',
        retrievedAt: '2026-09-11T00:00:00.000Z',
        ageSeconds: 0,
        intervalSeconds: 60,
      };
    };
    return { run, chunks };
  }

  it('splits into chunks of the given size and keeps call order', async () => {
    const { run, chunks } = scripted(() => false);
    const out = await readMany(calls, opts, 3, run);
    assert.deepEqual(chunks, [3, 3, 1]);
    assert.equal(out.length, 7);
    assert.equal(out[0]?.state, 'VERIFIED');
    assert.equal(out[3]?.state, 'VERIFIED');
    if (out[3]?.state === 'VERIFIED') assert.equal(out[3].value, `0x${w(3)}`);
  });

  it('makes a reverted subcall FIELD_ABSENT without touching its neighbours', async () => {
    const { run } = scripted(() => false);
    const out = await readMany(calls, opts, 3, run);
    // Every third call in a chunk is scripted to revert: indexes 2 and 5.
    assert.equal(out[2]?.state, 'UNREAD');
    if (out[2]?.state === 'UNREAD') assert.equal(out[2].reason, 'FIELD_ABSENT');
    assert.equal(out[5]?.state, 'UNREAD');
    assert.equal(out[1]?.state, 'VERIFIED');
    assert.equal(out[4]?.state, 'VERIFIED');
  });

  it('marks a failed chunk unread with the transport reason and lets other chunks stand', async () => {
    const { run } = scripted((i) => i === 1);
    const out = await readMany(calls, opts, 3, run);
    assert.equal(out[0]?.state, 'VERIFIED');
    for (const i of [3, 4, 5]) {
      const r = out[i];
      assert.equal(r?.state, 'UNREAD');
      if (r?.state === 'UNREAD') assert.equal(r.reason, 'SOURCE_TIMEOUT');
    }
    assert.equal(out[6]?.state, 'VERIFIED');
  });

  it('defaults to a batch size that is a positive integer', () => {
    assert.ok(Number.isInteger(BATCH_SIZE) && BATCH_SIZE > 0);
  });
});
