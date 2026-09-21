/**
 * The site can be closed to visitors while the machine keeps running.
 *
 * With `CURB_SITE_CLOSED=1` every page answers one plain notice and every API
 * route answers 503 — except the four the operation itself depends on:
 *
 *   /api/tick    the scheduler's tick (bearer-authenticated); stopping it
 *                would leave permanent gaps in the desk's record
 *   /api/desk    the operator's desk calls (bearer-authenticated)
 *   /api/health  Railway's healthcheck; without it a deploy fails
 *   /api/state   the outside watch (watch.yml) probes it every half hour
 *
 * `/api/state` therefore stays readable by anyone who knows the path; it is
 * the desk's machine state, not a page. Everything else is closed.
 *
 * The variable is read on every request, so opening the site again is a
 * change of the variable and nothing else.
 */

export const CLOSED_ENV = 'CURB_SITE_CLOSED';

export const OPEN_WHILE_CLOSED = ['/api/tick', '/api/desk', '/api/health', '/api/state'] as const;

export type ClosedDecision = 'PASS' | 'CLOSED_PAGE' | 'CLOSED_API';

export function siteClosed(env: Record<string, string | undefined> = process.env): boolean {
  return env[CLOSED_ENV] === '1';
}

export function closedDecision(pathname: string, closed: boolean): ClosedDecision {
  if (!closed) return 'PASS';
  if (OPEN_WHILE_CLOSED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'PASS';
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'CLOSED_API';
  return 'CLOSED_PAGE';
}

export const CLOSED_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'retry-after': '86400',
  'x-robots-tag': 'noindex, nofollow',
};

export const CLOSED_API_BODY = { state: 'CLOSED', detail: 'The site is closed for now.' } as const;

export const CLOSED_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>THE CURB</title>
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #e6e0d4; color: #121110;
    font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 0 24px;
  }
  main { width: 100%; max-width: 560px; }
  .kicker { font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #7c766d; }
  .rule { height: 3px; background: #121110; margin: 14px 0 28px; }
  h1 { font-size: clamp(48px, 13vw, 88px); line-height: .9; letter-spacing: -.035em; margin: 0; font-weight: 700; }
  p { font-size: 18px; line-height: 1.45; margin: 26px 0 0; color: #1b1917; }
  .mark { display: block; width: 72px; height: 6px; background: #d8452a; margin-top: 30px; }
</style>
</head>
<body>
<main>
  <div class="kicker">Robinhood Chain</div>
  <div class="rule"></div>
  <h1>THE CURB</h1>
  <p>The site is closed for now.</p>
  <span class="mark"></span>
</main>
</body>
</html>
`;
