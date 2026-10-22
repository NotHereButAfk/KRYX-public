// Copy authoritative resources into the presentation objects consumed by the
// HUD. Movement prediction owns position/velocity, but the server still owns
// stamina and throwable inventory.
export function applyAuthoritativeResources(player, client, grenades) {
  player.shield = client.self.shield ?? player.shield;
  if (client.self.maxShield != null) player.maxShield = client.self.maxShield;
  player.teleportCooldown = client.sim?.teleCD ?? player.teleportCooldown;
  player.stamina = client.sim?.stamina ?? player.stamina;
  if (grenades && client.self.abilities) {
    grenades.cooldowns = {timebomb: client.self.abilityCooldowns?.timebomb || 0, impulse: client.self.abilityCooldowns?.impulse || 0, frag: client.self.abilityCooldowns?.frag || 0, smoke: client.self.abilityCooldowns?.smoke || 0};
    grenades.frags = client.self.abilities.frag ?? grenades.frags;
    grenades.smokes = client.self.abilities.smoke ?? grenades.smokes;
  }
}
