import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CLOSED_ENV, CLOSED_PAGE_HTML, OPEN_WHILE_CLOSED, closedDecision, siteClosed } from '../lib/ops/closed.ts';

describe('the site, closed to visitors while the machine runs', () => {
  it('is open unless the variable says exactly 1', () => {
    assert.equal(siteClosed({}), false);
    assert.equal(siteClosed({ [CLOSED_ENV]: '0' }), false);
    assert.equal(siteClosed({ [CLOSED_ENV]: 'true' }), false);
    assert.equal(siteClosed({ [CLOSED_ENV]: '1' }), true);
  });

  it('passes everything while open', () => {
    for (const p of ['/', '/services', '/api/credits', '/api/tick']) assert.equal(closedDecision(p, false), 'PASS');
  });

  it('keeps the tick, the desk, the healthcheck and the watched state open while closed', () => {
    for (const p of OPEN_WHILE_CLOSED) {
      assert.equal(closedDecision(p, true), 'PASS', p);
      assert.equal(closedDecision(`${p}/x`, true), 'PASS', `${p}/x`);
    }
  });

  it('does not open a route that only shares a prefix with an open one', () => {
    assert.equal(closedDecision('/api/states', true), 'CLOSED_API');
    assert.equal(closedDecision('/api/ticker', true), 'CLOSED_API');
  });

  it('closes every page and every other API route', () => {
    for (const p of ['/', '/services', '/positions/apple-s1', '/gazette/2026-09-21', '/mechanism']) {
      assert.equal(closedDecision(p, true), 'CLOSED_PAGE', p);
    }
    for (const p of ['/api', '/api/credits', '/api/positions', '/api/status', '/api/keys']) {
      assert.equal(closedDecision(p, true), 'CLOSED_API', p);
    }
  });

  it('tells search engines not to index the notice', () => {
    assert.match(CLOSED_PAGE_HTML, /noindex/);
  });
});
