import { creditsStatus } from '@/lib/credits/config';
import { latestRun } from '@/lib/credits/maintenance';
import { positionsStatus } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The position product's status: network, each series' deployment, the
 * freshness of its evidence, its verification, index and reconciliation —
 * and, beside it, the credit desk's: configured or not, and how its last
 * run ended. The desk's own status is /api/state.
 */
export async function GET(): Promise<Response> {
  const store = await getStoreAsync();
  const credits = creditsStatus();
  const lastRun = credits.state === 'CONFIGURED' ? await latestRun(store) : null;
  return Response.json(
    {
      ...(await positionsStatus(store)),
      credits: {
        state: credits.state,
        detail: credits.state === 'CONFIGURED' ? null : credits.detail,
        network: credits.state === 'CONFIGURED' ? credits.config.network.id : null,
        desk: credits.state === 'CONFIGURED' ? credits.config.desk : null,
        treasury: credits.state === 'CONFIGURED' ? credits.config.treasury : null,
        lastRun,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
