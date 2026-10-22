export const MIN_LOADING_MS = 0;
export function remainingLoadingMs(startedAt, now = performance.now()) {
  return Math.max(0, MIN_LOADING_MS - Math.max(0, now - startedAt));
}
