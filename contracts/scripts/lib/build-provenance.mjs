import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
/** Hardhat resolves the current source and compiler settings before any artifact is trusted. */
export function buildCurrentContracts() {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node_modules/hardhat/dist/src/cli.js', import.meta.url)), 'build'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
}

export function currentSourceCommit(source = '../src/CompanySeries.sol') {
  return execFileSync('git', ['log', '-1', '--format=%H', '--', source, '../hardhat.config.ts'], { cwd: here, encoding: 'utf8' }).trim();
}

export function assertRecordedSourceCommit(record, current) {
  if (record.workingTreeClean !== true || typeof record.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(record.sourceCommit) || record.sourceCommit !== current) {
    throw new Error('the build sourceCommit does not match the current committed contract source and compiler settings; build and record the pinned source before public deployment');
  }
}
