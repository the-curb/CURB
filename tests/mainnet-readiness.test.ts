import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assessReadiness, RELEASE_REQUIREMENTS, type ReleaseRecord } from '../lib/release/readiness.ts';
const source = 'a'.repeat(64), evidence = 'b'.repeat(64);
const now = new Date('2026-09-13T12:00:00Z');
const complete = (): ReleaseRecord => ({ schemaVersion: 1, approvals: RELEASE_REQUIREMENTS.map(r => ({ id: r.id, status: 'APPROVED', sourceDigest: source, reviewedBy: 'Synthetic fixture reviewer', reviewedAt: '2026-09-13T11:00:00Z', evidence: { path: 'docs/mainnet/evidence/fixture.md', sha256: evidence } })) });
it('holds missing and pending records instead of inventing readiness', async () => {
  for (const raw of [null, {}, { schemaVersion: 1, approvals: [] }]) {
    const result = await assessReadiness(raw, source, async () => null, now);
    assert.ok(result.phases.every(p => p.state === 'HELD'));
  }
});
it('binds approval to source and exact evidence; rejects duplicates and future dates', async () => {
  const record = complete();
  record.approvals[0]!.sourceDigest = 'c'.repeat(64);
  record.approvals[1]!.reviewedAt = '2027-01-01';
  record.approvals.push({ ...record.approvals[2]! });
  const result = await assessReadiness(record, source, async () => 'd'.repeat(64), now);
  assert.ok(result.phases.every(p => p.state === 'HELD'));
  assert.ok(result.checks[0]!.reasons.includes('not tied to the current source digest'));
  assert.ok(result.checks[1]!.reasons.includes('review date absent, invalid or in the future'));
  assert.ok(result.checks[2]!.reasons.includes('duplicate record'));
});
it('separates token launch, paid beta and position evidence and never calls completeness authorization', async () => {
  const record = complete();
  record.approvals.find(a => a.id === 'issuer-eligibility')!.status = 'PENDING';
  const result = await assessReadiness(record, source, async () => evidence, now);
  assert.equal(result.phases[0]!.state, 'RECORDS_COMPLETE_REQUIRES_VERIFICATION');
  assert.equal(result.phases[1]!.state, 'RECORDS_COMPLETE_REQUIRES_VERIFICATION');
  assert.equal(result.phases[2]!.state, 'HELD');
  assert.match(result.limitation, /cannot authenticate/);
});
it('rejects unknown requirement IDs and placeholder reviewer names', async () => {
  const record = complete();
  record.approvals[0]!.reviewedBy = 'TBD';
  record.approvals.push({ ...record.approvals[0]!, id: 'made-up' });
  const result = await assessReadiness(record, source, async () => evidence, now);
  assert.ok(result.errors.length);
  assert.ok(result.phases.every(p => p.state === 'HELD'));
});
