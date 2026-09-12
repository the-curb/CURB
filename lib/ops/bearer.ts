/**
 * The bearer secret that gates the tick and the desk endpoint.
 *
 * Compared in constant time, so a wrong secret costs the same as a nearly
 * right one. Unset, it refuses in production — an endpoint that runs the
 * agents and posts to the webhook is not left open because a variable was
 * forgotten — and only in development lets the request through, saying so.
 */

import { timingSafeEqual } from 'node:crypto';

export type BearerCheck = { readonly ok: true; readonly unset: boolean } | { readonly ok: false; readonly status: 401 | 503; readonly error: string; readonly detail: string };

export function checkBearer(request: Request, secret: string | undefined = process.env.CURB_TICK_SECRET, env: string | undefined = process.env.NODE_ENV): BearerCheck {
  if (!secret) {
    if (env === 'production') return { ok: false, status: 503, error: 'NOT_CONFIGURED', detail: 'CURB_TICK_SECRET is not set on this deployment; the endpoint does not run without it' };
    return { ok: true, unset: true };
  }
  const offered = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const given = Buffer.from(offered, 'utf8');
  const same = expected.length === given.length && timingSafeEqual(expected, given);
  return same ? { ok: true, unset: false } : { ok: false, status: 401, error: 'unauthorized', detail: 'the Authorization header does not carry the tick secret' };
}
