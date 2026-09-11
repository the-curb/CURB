import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Slots } from '../lib/store/postgres.ts';

/**
 * The semaphore in front of the pool. What matters is that a statement's
 * timer never starts before it holds a slot — so the semaphore must hand out
 * exactly `size` slots, hold the rest in order, and never lose one.
 */
describe('Slots', () => {
  it('admits up to its size at once and makes the rest wait in order', async () => {
    const slots = new Slots(2);
    const order: string[] = [];
    await slots.acquire();
    await slots.acquire();
    let thirdIn = false;
    const third = slots.acquire().then(() => {
      thirdIn = true;
      order.push('third');
    });
    const fourth = slots.acquire().then(() => order.push('fourth'));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(thirdIn, false, 'the third must wait while two are held');
    slots.release();
    await third;
    assert.equal(thirdIn, true);
    slots.release();
    await fourth;
    assert.deepEqual(order, ['third', 'fourth']);
  });

  it('never has more than its size in flight under a burst', async () => {
    const slots = new Slots(1);
    let inFlight = 0;
    let peak = 0;
    const work = Array.from({ length: 6 }, async () => {
      await slots.acquire();
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      slots.release();
    });
    await Promise.all(work);
    assert.equal(peak, 1);
    assert.equal(inFlight, 0);
  });

  it('treats a size below one as one rather than as none', async () => {
    const slots = new Slots(0);
    await slots.acquire(); // would hang forever if the size were honoured as zero
    slots.release();
  });
});
