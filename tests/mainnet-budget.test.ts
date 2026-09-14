import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { allocateProceeds, serviceEconomics } from '../lib/release/budget.ts';

describe('mainnet budget conserves cents without treating unavailable funding as cash', () => {
  it('respects priority boundaries and balances every cent including rounding', () => {
    for (const n of [0n, 1n, 3_999_999n, 4_000_000n, 4_000_001n, 5_499_999n, 5_500_000n, 5_500_001n, 5_500_003n, 10_000_000n, 10n ** 30n]) {
      const result = allocateProceeds(n.toString());
      assert.equal(Object.values(result.bucketsCents).reduce((s, v) => s + BigInt(v), 0n), n);
      assert.ok(Object.values(result.bucketsCents).every(v => BigInt(v) >= 0n));
    }
    assert.deepEqual(allocateProceeds('10000000').bucketsCents, { review: '5800000', legal: '2400000', infrastructure: '900000', reserve: '900000' });
    assert.deepEqual(allocateProceeds('5500003').bucketsCents, { review: '4000001', legal: '1500000', infrastructure: '0', reserve: '2' });
  });
  it('refuses negatives, fractional, coerced or oversized inputs', () => {
    for (const invalid of [-1, 1, '-1', '1.1', '1e6', '', null, '01', '9'.repeat(41)]) assert.throws(() => allocateProceeds(invalid));
  });
});

describe('service economics', () => {
  const base = { fixedCostUsdMicros: '1000000', costPerCallUsdMicros: '10000', costPerDeliveryAttemptUsdMicros: '20000', callAttempts: '10', chargedCalls: '10', deliveryAttempts: '4', successfulDeliveries: '2', chargedDeliveries: '2' };
  it('charges successful deliveries only, costs every attempt and keeps losses visible', () => {
    const value = serviceEconomics(base);
    assert.equal(value.serviceUsageRevenueUsdMicros, '700000');
    assert.equal(value.costUsdMicros, '1180000');
    assert.equal(value.surplusUsdMicros, '-480000');
    assert.equal(value.breakEvenCallsOnly, '25');
  });
  it('does not silently zero unmeasured costs', () => {
    const value = serviceEconomics({ ...base, fixedCostUsdMicros: null });
    assert.equal(value.state, 'UNMEASURED');
    assert.equal(value.surplusUsdMicros, null);
    assert.deepEqual(value.missing, ['fixedCostUsdMicros']);
  });
  it('costs unbilled attempts and does not recognize successful but uncharged delivery as revenue', () => {
    const value = serviceEconomics({ ...base, chargedCalls: '8', chargedDeliveries: '0' });
    assert.equal(value.serviceUsageRevenueUsdMicros, '400000');
    assert.equal(value.costUsdMicros, '1180000');
    assert.equal(value.surplusUsdMicros, '-780000');
  });
  it('reports no calls-only break-even with non-positive marginal revenue', () => {
    assert.equal(serviceEconomics({ ...base, costPerCallUsdMicros: '50000' }).breakEvenCallsOnly, null);
    assert.equal(serviceEconomics({ ...base, costPerCallUsdMicros: '60000' }).breakEvenCallsOnly, null);
  });
  it('rounds required calls up and refuses inconsistent attempts or omitted costs', () => {
    assert.equal(serviceEconomics({ ...base, fixedCostUsdMicros: '1000001' }).breakEvenCallsOnly, '26');
    assert.throws(() => serviceEconomics({ ...base, successfulDeliveries: '5' }));
    assert.throws(() => serviceEconomics({ ...base, chargedDeliveries: '3' }));
    assert.throws(() => serviceEconomics({ ...base, chargedCalls: '11' }));
    assert.throws(() => serviceEconomics({ ...base, fixedCostUsdMicros: undefined } as never));
  });
});
