import { walletClaims } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** A wallet's unpaid claims per component, as the chain index has them. */
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }): Promise<Response> {
  const { address } = await params;
  const store = await getStoreAsync();
  const result = await walletClaims(store, address);
  return Response.json(result, { status: 'error' in result ? 400 : 200, headers: { 'cache-control': 'no-store' } });
}
