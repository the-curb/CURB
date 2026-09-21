import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { newBrowserKey } from '../lib/credits/browser-key.ts';
import { isKey, isKeyHash, keyHashOf } from '../lib/credits/keys.ts';

/**
 * A key made in the browser has to be one the server accepts: same shape as
 * keys.ts makes, and a hash the server would compute from it.
 */
describe('a key made in the browser', () => {
  it('has the shape the server accepts, and the hash the server computes', async () => {
    for (let i = 0; i < 20; i++) {
      const { key, hash } = await newBrowserKey();
      assert.ok(isKey(key), key);
      assert.ok(isKeyHash(hash), hash);
      assert.equal(hash, keyHashOf(key));
    }
  });

  it('is new every time', async () => {
    const a = await newBrowserKey();
    const b = await newBrowserKey();
    assert.notEqual(a.key, b.key);
  });
});
