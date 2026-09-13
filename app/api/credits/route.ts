import { creditsStatus } from '@/lib/credits/config';
import { creditsResponse } from '@/lib/launch/credits-api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return creditsResponse(request, creditsStatus(), await getStoreAsync());
}
