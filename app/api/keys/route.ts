import { creditsStatus } from '@/lib/credits/config';
import { newKeyResponse } from '@/lib/credits/key-api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * A new key and its hash, made here for callers without a browser. Nothing
 * is recorded: the desk learns of a key only when the chain credits its
 * hash, and it sees the key only when a call presents it. The same can be
 * done offline — thirty-two random bytes, base64url, SHA-256 — and the
 * services page does it in the browser.
 */
export async function POST(): Promise<Response> {
  return newKeyResponse(creditsStatus(), await getStoreAsync());
}
