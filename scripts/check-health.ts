import { probeHealth } from '../lib/ops/health-probe.ts';

// No dotenv, secret loading, notification or scheduler installation. External
// monitors can run the same read-only command with their own schedule/routing.
const args = process.argv.slice(2);
const target = args[0] ?? process.env.CURB_HEALTH_URL;
if (args.length > 1 || !target || args[0]?.startsWith('--')) {
  console.error('Usage: node scripts/check-health.ts <https://host/api/state> (or set CURB_HEALTH_URL)');
  process.exitCode = 2;
} else {
  const report = await probeHealth(target);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === 'HEALTHY' ? 0 : 1;
}
