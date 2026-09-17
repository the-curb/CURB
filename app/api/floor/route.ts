import { composeBoard } from '@/lib/floor/board';
import { FEED_COVERAGE, STOCK_TOKEN_COVERAGE } from '@/lib/chain/feeds';
import { getStoreAsync } from '@/lib/store';

/**
 * The Floor board as data: every feed the Pillar last read, with both ages.
 * Composed from snapshots, never from the chain, and it says how old the
 * sample is — a consumer that ignores `sampleState` is repeating a memory.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const store = await getStoreAsync();
  const snapshots = await store.snapshots('feed:');

  if (snapshots.state === 'UNREAD') {
    return Response.json(
      {
        observedAt: now.toISOString(),
        state: 'STORE_UNREADABLE',
        reason: snapshots.reason,
        detail: snapshots.detail ?? null,
        note: 'No board is drawn. This is not an empty floor.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const board = composeBoard(snapshots.value, now);
  return Response.json(
    {
      observedAt: now.toISOString(),
      state: 'READ',
      /** VERIFIED, STALE, ABSENT or NONE — how to read every row below. */
      sampleState: board.sampleState,
      sampledAt: board.sampledAt,
      sampleAgeSeconds: board.sampleAgeSeconds,
      counts: board.counts,
      coverage: {
        feedsListed: FEED_COVERAGE.listedByDirectory,
        feedsCaptured: FEED_COVERAGE.capturedHere,
        equityFeeds: FEED_COVERAGE.equity,
        stockTokens: STOCK_TOKEN_COVERAGE.tokensInRegistry,
        stockTokensWithoutFeed: STOCK_TOKEN_COVERAGE.withoutFeed,
        feedDirectory: FEED_COVERAGE.directory,
        feedsRetrievedAt: FEED_COVERAGE.observedAt,
        feedsVerifiedAtBlock: FEED_COVERAGE.observedAtBlock,
        registry: STOCK_TOKEN_COVERAGE.registry,
        registryRetrievedAt: STOCK_TOKEN_COVERAGE.observedAt,
      },
      equity: board.equity,
      crypto: board.crypto,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
