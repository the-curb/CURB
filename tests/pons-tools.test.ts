import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { describeError, endpointHost, isUnknownBlock, withOneRetry } from '../contracts/scripts/lib/node.ts';
import { NATIVE, PONS_V2, graduatedPoolKey } from '../contracts/scripts/lib/pons-v2-facts.ts';

// The ABI module needs viem, which the site does not carry; it is held to its verified text here and typechecked where the tools live (the contracts job).
const abiSource = readFileSync(new URL('../contracts/scripts/lib/pons-v2.ts', import.meta.url), 'utf8');

const KEYED = 'https://lb.drpc.live/example-key-0123456789abcdef';
const fail = (why: string): never => {
  throw new Error(`refused: ${why}`);
};

/** An error shaped as viem shapes them (name, shortMessage, details, walk), with an optional revert underneath. */
function viemLike(shortMessage: string, details: string, revert: { errorName?: string; args?: unknown[]; signature?: string } | null): Error {
  const inner = revert ? Object.assign(new Error(shortMessage), { name: 'ContractFunctionRevertedError', data: revert.errorName ? { errorName: revert.errorName, args: revert.args ?? [] } : undefined, signature: revert.signature }) : null;
  const outer = Object.assign(new Error(`${shortMessage}\n\nDetails: ${details}`), { name: 'ContractFunctionExecutionError', shortMessage, details, cause: inner });
  return Object.assign(outer, { walk: (fn: (e: unknown) => boolean) => (fn(outer) ? outer : inner && fn(inner) ? inner : null) });
}

describe('what a PONS tool may say about its node', () => {
  it('names the host, never the URL', () => {
    assert.equal(endpointHost(KEYED, fail), 'lb.drpc.live');
  });
  it('refuses a URL that does not parse by its length only', () => {
    const schemeless = 'lb.drpc.live/example-key-0123456789abcdef';
    assert.throws(() => endpointHost(schemeless, fail), (e: Error) => {
      assert.ok(!e.message.includes('example-key'), e.message);
      assert.ok(e.message.includes(`${schemeless.length} characters`), e.message);
      return true;
    });
  });
  it('scrubs the endpoint out of a transport error, plain or shaped', () => {
    const plain = describeError(new Error(`fetch failed for ${KEYED}`), KEYED);
    assert.ok(!plain.includes('example-key'), plain);
    assert.ok(plain.includes('lb.drpc.live'), plain);
    const shaped = describeError(viemLike('HTTP request failed.', `Failed to parse URL from ${KEYED}`, null), KEYED);
    assert.ok(!shaped.includes('example-key'), shaped);
    assert.equal(shaped, 'HTTP request failed. — Failed to parse URL from lb.drpc.live');
  });
  it("names the venue's error when the ABI knows it, with its arguments", () => {
    const text = describeError(viemLike('The contract function "launchToken" reverted.', 'execution reverted', { errorName: 'LaunchEconomicsMismatch', args: [`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`] }), KEYED);
    assert.ok(text.startsWith(`LaunchEconomicsMismatch(0x${'11'.repeat(32)}, 0x${'22'.repeat(32)}) — The contract function`), text);
  });
  it('gives the selector when the ABI does not know the error', () => {
    const text = describeError(viemLike('The contract function "launchToken" reverted.', 'execution reverted', { signature: '0xdeadbeef' }), KEYED);
    assert.ok(text.startsWith('an error the ABI does not name, selector 0xdeadbeef — '), text);
  });
  it('retries once at the same block for a backend that has not seen it, and not otherwise', async () => {
    let calls = 0;
    const lagging = async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('RPC Request failed.'), { details: 'Unknown block' });
      return 'answered';
    };
    assert.equal(await withOneRetry(lagging, isUnknownBlock, 1), 'answered');
    assert.equal(calls, 2);
    let other = 0;
    await assert.rejects(withOneRetry(async () => {
      other += 1;
      throw new Error('execution reverted');
    }, isUnknownBlock, 1));
    assert.equal(other, 1);
    let twice = 0;
    await assert.rejects(withOneRetry(async () => {
      twice += 1;
      throw new Error('header not found');
    }, isUnknownBlock, 1));
    assert.equal(twice, 2);
  });
});

describe("the venue's interface, as verified", () => {
  it("carries every one of the factory's errors, so a refusal is named", () => {
    const errors = [...abiSource.matchAll(/^  'error (\w+)\(/gm)].map((m) => m[1]!);
    assert.equal(errors.length, 52);
    for (const name of ['LaunchFeeNotPaid', 'LaunchEconomicsMismatch', 'NotWhitelisted', 'CreatorTaxTooHigh', 'PairTokenNotApproved', 'InvalidTokenParams', 'InvalidLaunchConfigId']) assert.ok(errors.includes(name), name);
  });
  it('declares maxCreatorTaxBps as the uint256 it is', () => {
    assert.ok(abiSource.includes("'function maxCreatorTaxBps() view returns (uint256)'"));
    assert.ok(!abiSource.includes('maxCreatorTaxBps() view returns (uint16)'));
  });
  it('sorts the pool key numerically, native ETH first', () => {
    const token = '0xd1a4e3a035852a3be3f24c2de889a9f17c265f19';
    const key = graduatedPoolKey(token, NATIVE, 0, 200, PONS_V2.hook);
    assert.equal(key.currency0, NATIVE);
    assert.equal(key.currency1, token);
    assert.equal(key.hooks, PONS_V2.hook.toLowerCase());
    const above = graduatedPoolKey('0xffffffffffffffffffffffffffffffffffffffff', PONS_V2.usdg, 0, 200, PONS_V2.hook);
    assert.equal(above.currency0, PONS_V2.usdg.toLowerCase());
  });
});
