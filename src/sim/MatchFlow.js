// Shared server hold: standings before map rotation. No between-match ad break.
export const SCOREBOARD_SECONDS = 10;
export const AD_SECONDS = 0;
export const RESULTS_SECONDS = SCOREBOARD_SECONDS + AD_SECONDS;
export const RESULTS_MS = RESULTS_SECONDS * 1000;
export function postMatchPhase(remaining) {
  return { ads: false, seconds: Math.max(0, Math.ceil(remaining)) };
}
