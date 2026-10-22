export const MATCH_DURATION_MS = 3 * 60 * 1000;

// Public rounds are anchored to one wall-clock epoch rather than process
// uptime. A server restart therefore rejoins the round already in progress
// instead of presenting every first visitor with a brand-new countdown.
export const MATCH_EPOCH_MS = Date.UTC(2026, 0, 1);

export function continuousMatchState(
  now = Date.now(),
  arenaCount = 1,
  durationMs = MATCH_DURATION_MS,
  epochMs = MATCH_EPOCH_MS,
) {
  const safeDuration = Math.max(1000, Number(durationMs) || MATCH_DURATION_MS);
  const safeArenaCount = Math.max(1, Number(arenaCount) | 0);
  const elapsed = Math.max(0, (Number(now) || epochMs) - epochMs);
  const round = Math.floor(elapsed / safeDuration);
  const matchStart = epochMs + round * safeDuration;
  return {
    round,
    matchStart,
    matchDurationMs: safeDuration,
    remainingMs: Math.max(0, safeDuration - ((Number(now) || epochMs) - matchStart)),
    arenaIndex: round % safeArenaCount,
  };
}
