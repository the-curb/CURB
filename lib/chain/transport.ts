/**
 * The HTTP transport, in two shapes that behave the same from the caller's side.
 *
 * By default this is `fetch`, which resolves through the system resolver. When
 * DNS over HTTPS is enabled it becomes `node:https` with a custom lookup, so the
 * address comes from an encrypted query instead of the network's resolver —
 * while TLS still validates against the real hostname. Nothing about the
 * request, the timeout, or the error handling differs between the two.
 *
 * Every outbound request this system makes goes through here: the JSON-RPC
 * calls and the two capture scripts that read vendor directories. One place to
 * reason about where an address came from is the point.
 */

import https from 'node:https';
import { dohEnabled, dohLookup } from './doh.ts';

export interface TransportRequest {
  readonly method: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface TransportResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
}

export async function request(
  url: string,
  init: TransportRequest,
  signal: AbortSignal,
): Promise<TransportResponse> {
  if (!dohEnabled()) {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal,
      cache: 'no-store',
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { ok: response.ok, status: response.status, text: await response.text(), headers };
  }

  const target = new URL(url);
  const body = init.body ?? '';
  return new Promise<TransportResponse>((resolve, reject) => {
    const outbound = https.request(
      {
        hostname: target.hostname,
        port: target.port === '' ? 443 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers: {
          ...(init.headers ?? {}),
          ...(init.body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
        },
        // The only line that differs from the default path: where the address
        // comes from. `servername` stays the hostname, so the certificate is
        // still checked against what we asked for, not what we were given.
        lookup: dohLookup,
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') headers[key.toLowerCase()] = value;
            else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ');
          }
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: Buffer.concat(chunks).toString('utf8'),
            headers,
          });
        });
      },
    );
    outbound.on('error', reject);
    if (init.body !== undefined) outbound.write(body);
    outbound.end();
  });
}

/** One GET with a deadline, for the capture scripts. Throws on transport failure. */
export async function getText(
  url: string,
  opts: { readonly timeoutMs?: number; readonly accept?: string; readonly headers?: Readonly<Record<string, string>> } = {},
): Promise<TransportResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    return await request(
      url,
      {
        method: 'GET',
        headers: {
          accept: opts.accept ?? 'application/json',
          'user-agent': 'the-curb/capture (read-only; https://github.com/the-curb/CURB)',
          ...(opts.headers ?? {}),
        },
      },
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
