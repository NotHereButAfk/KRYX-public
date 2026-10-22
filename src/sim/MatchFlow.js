// Shared server hold: standings before map rotation. Advertising is paused.
export const SCOREBOARD_SECONDS = 10;
export const AD_SECONDS = 0;
export const RESULTS_SECONDS = SCOREBOARD_SECONDS + AD_SECONDS;
export const RESULTS_MS = RESULTS_SECONDS * 1000;
export function postMatchPhase(remaining) {
  return AD_SECONDS === 0 || remaining > AD_SECONDS
    ? { ads: false, seconds: Math.ceil(remaining - AD_SECONDS) }
    : { ads: true, seconds: Math.max(0, Math.ceil(remaining)) };
}
