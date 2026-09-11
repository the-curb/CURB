/**
 * DNS over HTTPS, for networks whose resolver cannot be trusted.
 *
 * This exists because of something observed, not imagined. On the network this
 * was built on, the ISP answers DNS queries for the chain's RPC hostname with
 * its own addresses — even queries sent to 8.8.8.8 — and the certificate those
 * addresses serve is for the ISP's own domain. TLS refused it, correctly, and
 * every chain-reading agent went UNREACHABLE.
 *
 * Plain DNS is UDP on port 53 and can be intercepted in transit. A query over
 * HTTPS to a resolver cannot be, without breaking the TLS session, which the
 * interceptor cannot do without a certificate the client would reject.
 *
 * This only changes how a hostname becomes an address. The TLS session is still
 * negotiated for the real hostname, so a resolver that lied here would produce
 * a certificate mismatch, not a silent redirect.
 *
 * Opt-in via CURB_DNS_OVER_HTTPS=1. It is a workaround for a hostile local
 * network, and a deployment on a platform with an honest resolver should not
 * carry it.
 */

import type { LookupFunction } from 'node:net';

const RESOLVER = 'https://cloudflare-dns.com/dns-query';

interface DnsJsonAnswer {
  readonly name: string;
  readonly type: number;
  readonly TTL: number;
  readonly data: string;
}

interface DnsJsonResponse {
  readonly Status: number;
  readonly Answer?: readonly DnsJsonAnswer[];
}

interface CacheEntry {
  readonly addresses: readonly string[];
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Type 1 is an A record. CNAMEs (5) ride along in the same answer set. */
const A_RECORD = 1;

export function dohEnabled(): boolean {
  return process.env.CURB_DNS_OVER_HTTPS === '1';
}

/**
 * Resolve a hostname to IPv4 addresses over HTTPS, honouring the answer's TTL.
 * Throws on any failure: a resolver that could not answer must not be papered
 * over with the system resolver, because the system resolver is the thing
 * this exists to avoid.
 */
export async function resolveOverHttps(hostname: string): Promise<readonly string[]> {
  const held = cache.get(hostname);
  if (held && held.expiresAt > Date.now()) return held.addresses;

  const url = `${RESOLVER}?name=${encodeURIComponent(hostname)}&type=A`;
  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`DoH resolver answered HTTP ${response.status} for ${hostname}`);
  }

  const body = (await response.json()) as DnsJsonResponse;
  if (body.Status !== 0) {
    throw new Error(`DoH resolver returned DNS status ${body.Status} for ${hostname}`);
  }

  const records = (body.Answer ?? []).filter((a) => a.type === A_RECORD);
  if (records.length === 0) {
    throw new Error(`DoH resolver returned no A records for ${hostname}`);
  }

  const addresses = records.map((a) => a.data);
  const ttl = Math.max(30, Math.min(...records.map((a) => a.TTL)));
  cache.set(hostname, { addresses, expiresAt: Date.now() + ttl * 1000 });
  return addresses;
}

/**
 * A `lookup` for node:net / node:https, so the transport resolves through DoH
 * while TLS keeps validating against the hostname it was given.
 */
export const dohLookup: LookupFunction = (hostname, options, callback) => {
  resolveOverHttps(hostname).then(
    (addresses) => {
      const first = addresses[0]!;
      if (options.all) {
        callback(null, addresses.map((address) => ({ address, family: 4 })));
      } else {
        callback(null, first, 4);
      }
    },
    (cause: unknown) => {
      callback(cause instanceof Error ? cause : new Error(String(cause)), '', 4);
    },
  );
};
