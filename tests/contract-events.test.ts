import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { keccak256Hex } from '../lib/chain/keccak.ts';
import { EVENT_SIGNATURES, EVENT_TOPICS } from '../lib/positions/events.ts';

/**
 * The indexer decodes the events the series contract emits. The contract's
 * ABI is the authority: every signature the indexer knows must be in it,
 * with the same topic. The committed fixture is checked against the built
 * artifact whenever one exists, so the fixture cannot drift from the code.
 */
interface AbiEvent {
  readonly name: string;
  readonly inputs: readonly { readonly type: string }[];
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/CompanySeries.events.json', import.meta.url), 'utf8')) as { events: AbiEvent[] };
const signatureOf = (e: AbiEvent) => `${e.name}(${e.inputs.map((i) => i.type).join(',')})`;

describe('the series contract’s events', () => {
  it('carry exactly the signatures the indexer decodes, with the same topics', () => {
    const abiSignatures = new Set(fixture.events.map(signatureOf));
    for (const [name, signature] of Object.entries(EVENT_SIGNATURES)) {
      assert.ok(abiSignatures.has(signature), `${name}: ${signature} is not in the contract ABI`);
      assert.equal(EVENT_TOPICS[name as keyof typeof EVENT_TOPICS], keccak256Hex(signature));
    }
  });

  it('match the built artifact when one exists', (t) => {
    const artifact = new URL('../contracts/artifacts/src/CompanySeries.sol/CompanySeries.json', import.meta.url);
    if (!existsSync(artifact)) {
      t.skip('contracts/ has not been built here; run `npm run build` in contracts/ to check the fixture against the artifact');
      return;
    }
    const built = JSON.parse(readFileSync(artifact, 'utf8')) as { abi: (AbiEvent & { type: string })[] };
    const builtSignatures = built.abi.filter((x) => x.type === 'event').map(signatureOf).sort();
    assert.deepEqual(fixture.events.map(signatureOf).sort(), builtSignatures, 'the committed fixture has drifted from the contract; regenerate it');
  });
});
