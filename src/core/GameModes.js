export const DEATHMATCH_TIME_LIMIT_SECONDS = 3 * 60;

export const GAME_MODES = [
  {
    id:        'deathmatch',
    name:      'DEATHMATCH',
    icon:      '⚔',
    tag:       'FFA',
    desc:      'Every Spartan for themselves. 8 players, 3 minutes. Eligible score earns K for registered accounts.',
    color:     '#ff5c5c',
    botCount:  4,
    noRespawn: false,
    timeLimit: DEATHMATCH_TIME_LIMIT_SECONDS,
    lives:     Infinity,
    waves:     false,
    isZombie:  false,
  },
  {
    id:        'survival',
    name:      'SURVIVAL',
    icon:      '🧟',
    tag:       'CO-OP',
    desc:      'PvE co-op defense. Fight escalating waves with real players and allied bots filling open seats. Stay alive to keep the squad in the fight.',
    color:     '#44cc22',
    botCount:  0,
    noRespawn: true,
    timeLimit: 0,
    lives:     Infinity,
    waves:     false,
    isZombie:  true,
  },
];

export function getMode(id) {
  return GAME_MODES.find(m => m.id === id) || GAME_MODES[0];
}
