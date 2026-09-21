import { NextResponse, type NextRequest } from 'next/server';
import { CLOSED_API_BODY, CLOSED_HEADERS, CLOSED_PAGE_HTML, closedDecision, siteClosed } from './lib/ops/closed.ts';

/**
 * Closes the site to visitors while `CURB_SITE_CLOSED=1`, and only then; the
 * routes the operation needs stay open (lib/ops/closed.ts says which and why).
 */
export function proxy(request: NextRequest) {
  const decision = closedDecision(request.nextUrl.pathname, siteClosed());
  if (decision === 'PASS') return NextResponse.next();
  if (decision === 'CLOSED_API') return NextResponse.json(CLOSED_API_BODY, { status: 503, headers: CLOSED_HEADERS });
  return new NextResponse(CLOSED_PAGE_HTML, {
    status: 503,
    headers: { ...CLOSED_HEADERS, 'content-type': 'text/html; charset=utf-8' },
  });
}
