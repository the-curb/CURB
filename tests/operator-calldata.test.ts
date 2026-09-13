import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selector } from '../lib/chain/keccak.ts';

const script = fileURLToPath(new URL('../contracts/scripts/operator-calldata.mjs', import.meta.url));
const series = '0x1000000000000000000000000000000000000000';
const next = '0x2000000000000000000000000000000000000000';
const run = (...args: string[]) => spawnSync(process.execPath, [script, series, ...args], { encoding: 'utf8' });

describe('two-step operator calldata', () => {
  it('distinguishes nomination from acceptance and cancellation with the correct sender', () => {
    for (const [action, signature, sender, rest] of [
      ['transfer-operator', 'transferOperator(address)', 'current operator', [next]],
      ['accept-operator', 'acceptOperator()', 'pending operator', []],
      ['cancel-operator-transfer', 'cancelOperatorTransfer()', 'current operator', []],
    ] as const) {
      const result = run(action, ...rest);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.requiredSender, sender);
      assert.ok(output.data.startsWith(selector(signature)));
      if (action === 'transfer-operator') assert.match(output.says, /current operator keeps authority/);
    }
  });
  it('refuses a zero nominee and trailing arguments that could mislead a signer', () => {
    for (const args of [['transfer-operator', `0x${'0'.repeat(40)}`], ['transfer-operator', next, 'ignored'], ['accept-operator', next], ['cancel-operator-transfer', next]]) assert.notEqual(run(...args).status, 0);
  });
});
