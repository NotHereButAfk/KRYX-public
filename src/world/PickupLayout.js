// Pure authored-marker and random-loot helpers kept separate from
// PickupSystem's browser-only weapon model imports so server authority and the
// renderer always agree about what a pad contains.
import { MATCH_PICKUP_WEAPON_IDS } from '../weapons/weaponDefs.js';

export const AUTHORED_WEAPON_BY_KIND = new Map([
  [524288,  { id: 'uzi', color: 0x33d0ec }],
  [1048576, { id: 'levershotgun',    color: 0x5cff7a }],
  [2097152, { id: 'concussion', color: 0xb27bff }],
  [8388608, { id: 'rpg',        color: 0xff7a1a }],
]);

export const LOOT_SHIELD_CHANCE = 0.28;

const LOOT_COLORS = [
  0x33d0ec, 0xff7a1a, 0x5cff7a, 0xb27bff, 0xff4dd2, 0xffcc4d,
];

function seededUnit(seed) {
  let s = seed | 0;
  s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
  s = Math.imul(s ^ (s >>> 12), 0x297a2d39);
  return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
}

export function rollLootItem(seed, padId = 0, shieldsEnabled = true) {
  const typeRoll = seededUnit((seed | 0) + padId * 0x45d9f3b);
  if (shieldsEnabled && typeRoll < LOOT_SHIELD_CHANCE) {
    return { lootType: 'shield', color: 0x39bfff };
  }
  const weaponRoll = seededUnit((seed | 0) ^ (padId + 1) * 0x27d4eb2d);
  const index = Math.min(
    MATCH_PICKUP_WEAPON_IDS.length - 1,
    Math.floor(weaponRoll * MATCH_PICKUP_WEAPON_IDS.length),
  );
  return {
    lootType: 'weapon',
    gunId: MATCH_PICKUP_WEAPON_IDS[Math.max(0, index)],
    color: LOOT_COLORS[Math.max(0, index) % LOOT_COLORS.length],
  };
}

// Roll every authored pad at once and make the first generation useful: maps
// with at least two pads always contain at least one shield and one weapon.
export function randomLootSpecs(points = [], seed = Date.now(), shieldsEnabled = true) {
  const specs = points.map((position, padId) => ({
    padId,
    position,
    ...rollLootItem(seed + padId * 101, padId, shieldsEnabled),
  }));
  if (shieldsEnabled && specs.length > 1 && !specs.some((spec) => spec.lootType === 'shield')) {
    Object.assign(specs[0], { lootType: 'shield', gunId: undefined, color: 0x39bfff });
  }
  if (specs.length > 1 && !specs.some((spec) => spec.lootType === 'weapon')) {
    Object.assign(specs[1], { lootType: 'weapon', ...rollLootItem(seed + 0x51ed270b, 99) });
    if (specs[1].lootType !== 'weapon') {
      specs[1].lootType = 'weapon';
      specs[1].gunId = MATCH_PICKUP_WEAPON_IDS[0];
      specs[1].color = LOOT_COLORS[0];
    }
  }
  return specs;
}

export function authoredWeaponSpecs(points = []) {
  return points
    .map((position) => {
      const spec = AUTHORED_WEAPON_BY_KIND.get(position.markerKind);
      return spec ? { ...spec, position } : null;
    })
    .filter(Boolean);
}
