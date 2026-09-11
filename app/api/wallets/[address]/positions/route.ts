import { walletPositions } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** A wallet's receipts per series, as the chain index has them. Public chain data; nothing personal. */
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }): Promise<Response> {
  const { address } = await params;
  const store = await getStoreAsync();
  const result = await walletPositions(store, address);
  return Response.json(result, { status: 'error' in result ? 400 : 200, headers: { 'cache-control': 'no-store' } });
}
