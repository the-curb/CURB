/**
 * A minimal JSON-RPC client for Robinhood Chain.
 *
 * It is deliberately small and dependency-free: every call this system makes is a
 * read, and a read that fails must produce an UNREAD reading rather than an
 * exception that some caller quietly turns into a zero.
 */

import https from 'node:https';
import { activeNetwork, rpcUrl, type NetworkProfile } from './networks.ts';
import { dohEnabled, dohLookup } from './doh.ts';
import { read, unread, type Reading } from '../doctrine/reading.ts';

interface RpcSuccess {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

interface RpcFailure {
  jsonrpc: '2.0';
  id: number;
  error: { code: number; message: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;

let requestId = 0;

export interface RpcOptions {
  readonly profile?: NetworkProfile;
  readonly timeoutMs?: number;
  /** The producing agent's declared interval, used to age the reading. */
  readonly intervalSeconds: number;
}

interface TransportResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
}

/**
 * The transport, in two shapes that behave the same from the caller's side.
 *
 * By default this is `fetch`, which resolves through the system resolver. When
 * DNS over HTTPS is enabled it becomes `node:https` with a custom lookup, so the
 * address comes from an encrypted query instead of the network's resolver —
 * while TLS still validates against the real hostname. Nothing about the
 * request, the timeout, or the error handling differs between the two.
 */
async function post(url: string, body: string, signal: AbortSignal): Promise<TransportResponse> {
  if (!dohEnabled()) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal,
      cache: 'no-store',
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
  }

  const target = new URL(url);
  return new Promise<TransportResponse>((resolve, reject) => {
    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port === '' ? 443 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
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
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

/**
 * One RPC call, returned as a reading. `source` names the endpoint host so the
 * provenance line points at something a reader could check themselves.
 */
export async function rpcCall<T>(
  method: string,
  params: readonly unknown[],
  opts: RpcOptions,
): Promise<Reading<T>> {
  const profile = opts.profile ?? activeNetwork();
  const url = rpcUrl(profile);
  const source = `${new URL(url).host} · ${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = new Date();

  try {
    const response = await post(
      url,
      JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      controller.signal,
    );

    if (!response.ok) {
      return unread('SOURCE_UNREACHABLE', {
        source,
        detail: `HTTP ${response.status}`,
      });
    }

    const body = JSON.parse(response.text) as RpcSuccess | RpcFailure;
    if ('error' in body) {
      // A revert is not malformed data. The node answered correctly; the
      // contract declined to. Calling a function a contract does not implement
      // reverts, and reporting that as corruption would send a reader looking
      // for a fault in the transport that is not there.
      const reverted = /execution reverted|revert/i.test(body.error.message);
      return unread(reverted ? 'FIELD_ABSENT' : 'SOURCE_MALFORMED', {
        source,
        detail: reverted
          ? `the call reverted (${body.error.message}) — the contract does not answer this. Not a "no".`
          : `rpc error ${body.error.code}: ${body.error.message}`,
      });
    }

    return read<T>({
      value: body.result as T,
      source,
      retrievedAt: startedAt,
      intervalSeconds: opts.intervalSeconds,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return unread(aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNREACHABLE', {
      source,
      detail: cause instanceof Error ? cause.message : 'unknown transport failure',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Confirms the endpoint is the chain we think it is, before anything trusts it. */
export async function readChainId(opts: RpcOptions): Promise<Reading<number>> {
  const hex = await rpcCall<string>('eth_chainId', [], opts);
  if (hex.state === 'UNREAD') return hex;
  const parsed = Number.parseInt(hex.value, 16);
  if (!Number.isInteger(parsed)) {
    return unread('SOURCE_MALFORMED', { source: hex.source, detail: `chainId ${hex.value}` });
  }
  return { ...hex, value: parsed };
}

export async function readBlockNumber(opts: RpcOptions): Promise<Reading<number>> {
  const hex = await rpcCall<string>('eth_blockNumber', [], opts);
  if (hex.state === 'UNREAD') return hex;
  const parsed = Number.parseInt(hex.value, 16);
  if (!Number.isInteger(parsed)) {
    return unread('SOURCE_MALFORMED', { source: hex.source, detail: `block ${hex.value}` });
  }
  return { ...hex, value: parsed };
}

export interface LogEntry {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
}

/**
 * Logs over a block range.
 *
 * Public endpoints cap how wide a range they will scan and reject anything
 * larger. That rejection comes back as an UNREAD reading with the node's own
 * message attached, rather than as an empty array — "no transfers happened" and
 * "we were not allowed to look" must never arrive looking the same.
 */
export async function readLogs(
  address: string,
  topics: readonly (string | null)[],
  fromBlock: number,
  toBlock: number,
  opts: RpcOptions,
): Promise<Reading<LogEntry[]>> {
  return rpcCall<LogEntry[]>(
    'eth_getLogs',
    [
      {
        address,
        topics,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ],
    opts,
  );
}

/** Non-empty code is the difference between "a contract" and "an address someone typed". */
export async function readCode(
  address: string,
  opts: RpcOptions,
): Promise<Reading<{ address: string; hasCode: boolean; sizeBytes: number }>> {
  const code = await rpcCall<string>('eth_getCode', [address, 'latest'], opts);
  if (code.state === 'UNREAD') return code;
  const body = code.value.startsWith('0x') ? code.value.slice(2) : code.value;
  return {
    ...code,
    value: { address, hasCode: body.length > 0, sizeBytes: Math.floor(body.length / 2) },
  };
}
