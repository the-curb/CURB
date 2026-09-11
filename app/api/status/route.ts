import { positionsStatus } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The position product's status: network, each series' deployment, the
 * freshness of its evidence, its verification, index and reconciliation.
 * The desk's own status is /api/state.
 */
export async function GET(): Promise<Response> {
  const store = await getStoreAsync();
  return Response.json(await positionsStatus(store), { headers: { 'cache-control': 'no-store' } });
}
