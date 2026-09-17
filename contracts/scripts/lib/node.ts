/**
 * What an operator's tool may say about the node it talks to: the host of
 * the endpoint, never the URL. A keyed endpoint (the operator's dRPC URL
 * carries its key in the path) must not reach a terminal or a log through
 * a message — not through Node's own URL error when the URL is malformed,
 * and not through a transport error that quotes the URL it failed on.
 *
 * viem's errors are read by shape (name, shortMessage, details, walk), not
 * by class, so this file needs no dependency and the tests can shape one.
 */

/** The host of the endpoint. A URL that does not parse is refused by its length only. */
export function endpointHost(url: string, fail: (why: string) => never): string {
  try {
    return new URL(url).host;
  } catch {
    return fail(`the RPC URL from the environment does not parse as a URL (${url.length} characters; it needs a scheme such as https://)`);
  }
}

interface ViemLike {
  readonly name?: unknown;
  readonly shortMessage?: unknown;
  readonly details?: unknown;
  readonly walk?: (fn: (e: unknown) => boolean) => unknown;
}
interface RevertLike {
  readonly data?: { readonly errorName?: unknown; readonly args?: readonly unknown[] } | undefined;
  readonly signature?: unknown;
}

/**
 * One line about why a call failed: the venue's named error when the ABI
 * knows it (or its selector when it does not), viem's short message, and the
 * transport's detail — with every occurrence of the endpoint's URL replaced
 * by its host.
 */
export function describeError(cause: unknown, url: string): string {
  if (!(cause instanceof Error)) return 'unknown';
  const parts: string[] = [];
  const v = cause as Error & ViemLike;
  if (typeof v.walk === 'function' && typeof v.shortMessage === 'string') {
    const revert = v.walk((e) => (e as ViemLike | null)?.name === 'ContractFunctionRevertedError') as RevertLike | null;
    if (revert) {
      parts.push(revert.data && typeof revert.data.errorName === 'string' ? `${revert.data.errorName}(${(revert.data.args ?? []).map(String).join(', ')})` : `an error the ABI does not name${typeof revert.signature === 'string' ? `, selector ${revert.signature}` : ''}`);
    }
    parts.push(v.shortMessage);
    if (typeof v.details === 'string' && v.details !== '' && v.details !== v.shortMessage) parts.push(v.details);
  } else {
    parts.push(cause.message.split('\n')[0] ?? 'unknown');
  }
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'the node';
    }
  })();
  return parts.join(' — ').split(url).join(host);
}

/**
 * A load-balanced endpoint can answer eth_blockNumber from one backend and
 * refuse a read pinned at that block from another that has not seen it yet.
 * The read is retried once, at the same block, after a moment; the block
 * every fact is read at does not move.
 */
export function isUnknownBlock(cause: unknown): boolean {
  const text = cause instanceof Error ? `${cause.message} ${String((cause as { details?: unknown }).details ?? '')}` : '';
  return /unknown block|block not found|header not found|cannot query unfinalized data/i.test(text);
}

export async function withOneRetry<T>(call: () => Promise<T>, retryWhen: (cause: unknown) => boolean, waitMs = 750): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    if (!retryWhen(cause)) throw cause;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return call();
  }
}
