import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ACCESS, ACCESS_ENV, ACCESS_NOTICE, ACCESS_TITLE, accessMode, isFree } from '../lib/credits/access.ts';
import { admit, paidHeaders, settle } from '../lib/credits/guard.ts';
import { newKeyResponse } from '../lib/credits/key-api.ts';
import { newKey } from '../lib/credits/keys.ts';
import { SERVICES } from '../lib/credits/prices.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * "Free" is a claim on every page of this site, so it is a claim that has to be
 * enforced somewhere or deleted. It is enforced in `lib/credits/access.ts` and
 * read from there by the guard, the routes and the pages; these tests are what
 * stop the word and the behaviour from drifting apart.
 *
 * The paid machinery is not deleted and is not untested: every test here that
 * needs the other mode passes it explicitly, which is the same thing the rest
 * of the credit suite now does.
 */

const store = () => new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-access-')));
const NOW = new Date('2026-09-20T15:00:00.000Z');
const req = (headers: Record<string, string> = {}) => new Request('https://the-curb.test/api/x', { headers });

describe('the decision', () => {
  it('is FREE, and says who decided it and when', () => {
    assert.equal(ACCESS.declared, 'FREE');
    assert.equal(accessMode(), 'FREE');
    assert.equal(isFree(), true);
    assert.match(ACCESS.decidedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(ACCESS.decidedBy.length > 0);
    assert.ok(ACCESS.why.length > 0);
  });

  it('lets a deployment run the other mode, and then says so everywhere at once', () => {
    const before = process.env[ACCESS_ENV];
    try {
      process.env[ACCESS_ENV] = 'PAID';
      assert.equal(accessMode(), 'PAID', 'the guard would still be free');
      assert.equal(isFree(), false);
      // The declaration does not move: what changed is what this deployment runs.
      assert.equal(ACCESS.declared, 'FREE');
      process.env[ACCESS_ENV] = 'nonsense';
      assert.equal(accessMode(), 'FREE', 'an unreadable setting falls back to the decision, never to charging');
    } finally {
      if (before === undefined) delete process.env[ACCESS_ENV];
      else process.env[ACCESS_ENV] = before;
    }
  });

  it('carries a sentence and a heading for both modes, so no page invents its own', () => {
    for (const mode of ['FREE', 'PAID'] as const) {
      assert.ok(ACCESS_NOTICE[mode].length > 0);
      assert.ok(ACCESS_TITLE[mode].length > 0);
    }
    assert.match(ACCESS_NOTICE.FREE, /free to use/i);
    assert.match(ACCESS_TITLE.FREE, /would cost/i);
  });
});

describe('the guard, while the desk is free', () => {
  it('admits a call that presents no key at all', async () => {
    for (const service of SERVICES) {
      const admitted = await admit(req(), store(), service.id, NOW);
      assert.equal(admitted.ok, true, `${service.id} was refused`);
      if (admitted.ok) {
        assert.equal(admitted.cents, 0);
        assert.equal(admitted.account, null);
        assert.equal(admitted.hash, null);
      }
    }
  });

  it('admits without consulting the desk configuration', async () => {
    // Under PAID this same call is 503 CREDITS_NOT_CONFIGURED, because nothing
    // can be bought where nothing is sold. Free has nothing to configure.
    const free = await admit(req(), store(), 'journal-day', NOW);
    const paid = await admit(req(), store(), 'journal-day', NOW, 'PAID');
    assert.equal(free.ok, true);
    assert.equal(paid.ok, false);
    if (!paid.ok) assert.equal(paid.response.status, 503);
  });

  it('settles by writing nothing at all', async () => {
    const s = store();
    const settled = await settle(s, null, 'journal-day', 'apple-s1 · 2026-09-20', NOW);
    assert.equal(settled.ok, true);
    if (settled.ok) assert.equal(settled.account, null);
    // No charge row, and no spend row: the record must not show a call that
    // was billed at nothing, because that is not what happened.
    const rows = await s.snapshots('credits:');
    assert.equal(rows.state === 'UNREAD' ? 0 : rows.value.length, 0);
  });

  it('says so in the header a charged answer would have used', () => {
    assert.deepEqual(paidHeaders(null, 0), {
      'cache-control': 'no-store',
      'x-curb-charged-cents': '0',
      'x-curb-access': 'FREE',
    });
  });

  it('still refuses a service nobody listed', async () => {
    const unknown = await admit(req(), store(), 'not-a-service' as never, NOW);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.response.status, 500);
  });
});

describe('a key, while the desk is free', () => {
  it('is issued with no invitation to pay for anything', async () => {
    const body = await (await newKeyResponse({ state: 'NOT_CONFIGURED', detail: 'nothing configured' }, store(), NOW)).json();
    assert.equal(body.access, 'FREE');
    assert.match(body.key, /^curb_/);
    assert.match(body.whatItIsFor, /not a payment/i);
    // The fields that would ask for money are absent, not present and zero.
    for (const field of ['minimumOpenCents', 'topUp', 'topUpHeld', 'quoteReadiness', 'priceList']) {
      assert.equal(field in body, false, `${field} is still offered on a free desk`);
    }
  });

  it('is still a real key: the paid issuer is unchanged when asked for', async () => {
    const body = await (await newKeyResponse({ state: 'NOT_CONFIGURED', detail: 'nothing configured' }, store(), NOW, 'PAID')).json();
    assert.equal(body.access, 'PAID');
    assert.equal(body.minimumOpenCents, 2_000);
    assert.ok('topUp' in body);
  });

  it('is well formed either way', async () => {
    assert.match(newKey(), /^curb_[A-Za-z0-9_-]{43}$/);
  });
});

describe('the price list survives the decision', () => {
  it('still publishes what a call would cost, so the figure can be read', () => {
    assert.equal(SERVICES.length, 3);
    for (const s of SERVICES) {
      assert.ok(s.cents > 0, `${s.id} lost its price`);
      assert.ok(s.what.length > 0);
      assert.ok(s.path.startsWith('/api/'));
    }
  });
});
