import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { selector } from '../lib/chain/keccak.ts';
import { allocateExitCall, approveCall, claimCall, mintCall, SIGNATURES } from '../lib/positions/calldata.ts';
import { previewExit, previewMint } from '../lib/positions/api.ts';
import { APPLE_S1 } from '../lib/positions/series.ts';

/**
 * The bytes a wallet would sign. The contract's ABI is the authority for the
 * series calls; ERC-20 approve is the standard's. Nothing here is sent.
 */
interface AbiFunction {
  readonly name: string;
  readonly inputs: readonly { readonly type: string }[];
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/CompanySeries.events.json', import.meta.url), 'utf8')) as { functions: AbiFunction[] };
const signatureOf = (f: AbiFunction) => `${f.name}(${f.inputs.map((i) => i.type).join(',')})`;

const SERIES = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0';
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

describe('calldata for a deployed series', () => {
  it('uses signatures the contract actually has', () => {
    const abi = new Set(fixture.functions.map(signatureOf));
    for (const [name, signature] of Object.entries(SIGNATURES)) {
      if (name === 'approve') continue; // ERC-20, on the component, not the series
      assert.ok(abi.has(signature), `${name}: ${signature} is not in the contract ABI`);
    }
    assert.equal(selector(SIGNATURES.approve), '0x095ea7b3', 'the ERC-20 approve selector every wallet recognises');
  });

  it('encodes each call as selector plus 32-byte words, lower-cased', () => {
    const approve = approveCall(TOKEN, SERIES, 250n * 10n ** 18n, 'AAPLx');
    assert.equal(approve.to, TOKEN.toLowerCase());
    assert.equal(approve.data.length, 2 + 8 + 64 * 2);
    assert.ok(approve.data.startsWith('0x095ea7b3'));
    assert.ok(approve.data.includes(SERIES.slice(2)), 'the spender is the series');
    assert.ok(approve.data.endsWith((250n * 10n ** 18n).toString(16).padStart(64, '0')));

    const mint = mintCall(SERIES, 25n, 1_800_000_000n);
    assert.equal(mint.data, `${selector('mint(uint256,uint256)')}${'19'.padStart(64, '0')}${(1_800_000_000n).toString(16).padStart(64, '0')}`);
    assert.equal(allocateExitCall(SERIES, 25n).data, `${selector('allocateExit(uint256)')}${'19'.padStart(64, '0')}`);
    assert.equal(claimCall(SERIES, 'A').data, `${selector('claimComponent(uint8)')}${'0'.padStart(64, '0')}`);
    assert.equal(claimCall(SERIES, 'B').data, `${selector('claimComponent(uint8)')}${'1'.padStart(64, '0')}`);
  });

  it('refuses what a word cannot hold', () => {
    assert.throws(() => mintCall(SERIES, -1n, 0n));
    assert.throws(() => mintCall(SERIES, 1n << 256n, 0n));
    assert.throws(() => approveCall('0x1234', SERIES, 1n, 'x'));
  });

  it('prepares nothing while there is no deployment, and says so', () => {
    const mint = previewMint(APPLE_S1, '25');
    assert.ok(!('error' in mint));
    if ('error' in mint) return;
    assert.equal(mint.signItYourself.state, 'NOT_DEPLOYED');
    assert.deepEqual(mint.signItYourself.calls, []);
    assert.equal(mint.sendsTransaction, false);
    const exit = previewExit(APPLE_S1, '25');
    assert.ok(!('error' in exit));
    if ('error' in exit) return;
    assert.equal(exit.signItYourself.state, 'NOT_DEPLOYED');
    assert.deepEqual(exit.signItYourself.calls, []);
  });

  it('matches the built artifact when one exists', (t) => {
    const artifact = new URL('../contracts/artifacts/src/CompanySeries.sol/CompanySeries.json', import.meta.url);
    if (!existsSync(artifact)) {
      t.skip('contracts/ has not been built here; run `npm run build` in contracts/ to check the fixture against the artifact');
      return;
    }
    const built = JSON.parse(readFileSync(artifact, 'utf8')) as { abi: (AbiFunction & { type: string; stateMutability: string })[] };
    const builtSignatures = built.abi
      .filter((x) => x.type === 'function' && x.stateMutability !== 'view' && x.stateMutability !== 'pure')
      .map(signatureOf)
      .sort();
    assert.deepEqual(fixture.functions.map(signatureOf).sort(), builtSignatures, 'the committed fixture has drifted from the contract; regenerate it');
  });
});
