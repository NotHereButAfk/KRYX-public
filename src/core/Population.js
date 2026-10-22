// One population contract for every match path. A bot occupies the same match
// slot as a human; the distinction is presentation/authority metadata, not
// whether that combatant counts as a player.
export function countLocalMatchPlayers(bots, localPlayers = 1) {
  return localPlayers + (Array.isArray(bots) ? bots.length : 0);
}

// Authoritative rosters already include the local player. Keep the local
// fallback while the first snapshot is in flight so the HUD never reads 0.
export function countAuthoritativePlayers(roster, localFallback = 1) {
  return Math.max(localFallback, Array.isArray(roster) ? roster.length : 0);
}
