// Shared bot-name generator used by both the browser/offline manager and the
// authoritative Node room. The BOT badge is rendered separately, so names stay
// readable in the HUD, kill feed, and post-match leaderboard.
const TAGS = Object.freeze([
  'Vortex', 'NovaStrike', 'Reaper', 'Glitch', 'Zephyr', 'Onyx', 'Pulse', 'Wraith',
  'Cipher', 'Havoc', 'Specter', 'Riot', 'Surge', 'Talon', 'Echo', 'Frost',
  'Blaze', 'Venom', 'Phantom', 'Ranger', 'Drift', 'Saint', 'Karma', 'Volt',
]);

export function randomBotName(used = new Set(), random = Math.random) {
  for (let i = 0; i < 40; i++) {
    const base = TAGS[Math.floor(random() * TAGS.length)];
    const name = random() < 0.5 ? base : `${base}${Math.floor(random() * 99)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  for (let suffix = 1; suffix < 10000; suffix++) {
    const name = `Player${suffix}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return 'Player';
}

