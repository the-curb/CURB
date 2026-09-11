/**
 * How long the record is kept, declared in one place.
 *
 * Retention is not housekeeping here. Pruning observations changes what the
 * Surveyor is able to compute: a series cannot be longer than the window that
 * holds it, however long the system has been running. So the horizon is a
 * published fact rather than an operational detail, and the Surveyor states it
 * in every report — "120 observations" and "120 observations because the rest
 * were deleted" are different claims, and only one of them is honest on its own.
 *
 * What is NOT pruned, and why:
 *
 *   Publications — they are the product. A record that deletes what it said is
 *   not a record.
 *   Blocked outputs — they are the evidence that policy did its job. Deleting
 *   them would leave only the outputs that passed, which is the flattering half.
 *   Heartbeats — cheap and small, and the history of when an agent ran is the
 *   only way to notice that it stopped. If they ever need a horizon it gets one
 *   here, declared the same way.
 */

/**
 * Ninety days.
 *
 * Chosen to be longer than the longest window the Surveyor measures over, with
 * room to spare, so retention never becomes the thing that decides whether a
 * figure can be computed. If a longer window is ever added, this has to move
 * first — and the Surveyor's own minimums are the check on that.
 */
export const OBSERVATION_RETENTION_DAYS = 90;

export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - OBSERVATION_RETENTION_DAYS * 24 * 3600 * 1000);
}

/** The sentence the Surveyor publishes, so the bound is never implied. */
export function describeRetention(): string {
  return `Observations older than ${OBSERVATION_RETENTION_DAYS} days are removed, so a series here cannot be longer than that window no matter how long this system has run. A short series may mean a young record or a pruned one, and this line is how those stay distinguishable.`;
}
