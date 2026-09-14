import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { allocateProceeds, serviceEconomics } from '../lib/release/budget.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith('--')) throw new Error('usage: node scripts/mainnet-budget.ts [planning-input.json]');
const file = args[0] ?? fileURLToPath(new URL('../docs/mainnet/budget.example.json', import.meta.url));
const input = JSON.parse(await readFile(file, 'utf8'));
if (input.schemaVersion !== 1) throw new Error('budget schemaVersion must be 1');
console.log(JSON.stringify({ schemaVersion: 1, status: 'PLANNING_ONLY', proceeds: allocateProceeds(input.netAvailableCents), economics: serviceEconomics(input.economics), limitation: 'No bank, chain, invoice, user demand or funding commitment was verified; no approval or transaction is generated.' }, null, 2));
