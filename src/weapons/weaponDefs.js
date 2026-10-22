// Weapon stats for the arsenal. Times are in seconds.
// `key` is the keyboard binding shown in the HUD (digits for the first ten guns,
// letters for the rest, "V" for the blade). `sound` maps to a profile in
// AudioManager.playShot(). The scroll wheel cycles through everything.
const WEAPON_CATALOG = [
  {
    id: 'sidearm',
    name: 'Pulse Pistol',
    key: '1',
    kind: 'hitscan',
    sound: 'sidearm',
    damage: 51,             // 2-shot body kill (100 HP / 51 ≈ 2 shots)
    headshotMultiplier: 2.0, // 1-shot headshot kill
    pellets: 1,
    spread: 0.004,
    fireRate: 0.55,
    automatic: false,
    magSize: 6,
    reserveMax: 36,
    reloadTime: 1.4,
    range: 140,
    recoil: 0.035,
    color: 0xd9782e,        // orange grip/guard (reference-chart Glock)
    energyColor: 0x86ff2e   // neon-green slide windows + sight dots
  },
  {
    id: 'uzi',
    name: 'Mini SMG',
    key: '2',
    kind: 'hitscan',
    sound: 'uzi',
    damage: 12,
    pellets: 1,
    spread: 0.02,
    fireRate: 0.07,
    automatic: true,
    magSize: 32,
    reserveMax: 160,
    reloadTime: 1.5,
    range: 80,
    recoil: 0.013,
    color: 0xd9782e,
    energyColor: 0x86ff2e   // neon-green accents (reference chart)
  },
  {
    id: 'levershotgun',
    canAim: false,
    name: 'Shotgun',
    key: '3',
    kind: 'hitscan',
    sound: 'levershotgun',
    damage: 10,
    pellets: 8,
    spread: 0.085,
    fireRate: 0.7,
    automatic: false,
    magSize: 6,
    reserveMax: 30,
    reloadTime: 2.0,
    range: 30,
    recoil: 0.05,
    color: 0xd9782e,
    energyColor: 0x86ff2e   // neon-green accents (reference chart)
  },
  {
    id: 'm4',
    name: 'Auto Rifle',
    key: '4',
    kind: 'hitscan',
    sound: 'm4',
    damage: 10,
    pellets: 1,
    // EV.IO's rifle opens pin-accurate and grows to a 0.02 cone while held.
    // Zoom removes the cone again, so tap fire and ADS both feel deliberate.
    spread: 0,
    spreadMin: 0,
    spreadMax: 0.02,
    spreadBloomPerShot: 0.0025,
    spreadRecovery: 0.008,
    zoomSpreadMod: 0,
    fireRate: 0.12,
    automatic: true,
    magSize: 50,
    reserveMax: 200,
    reloadTime: 1.8,
    range: 150,
    recoil: 0.014,
    cameraRecoil: 0.007,
    adsFov: 52,
    adsSpeed: 13,
    muzzleFlashScale: 0.68,
    muzzleSmoke: true,
    spawnShells: true,
    tracerSpeed: 240,
    color: 0xd9782e,
    energyColor: 0x2ee6ff,
    sciFi: true,
    authoredModel: true   // Blender model in weapons_authored.glb
  },
  {
    id: 'm16',
    name: 'Ion Repeater',
    key: '5',
    kind: 'hitscan',
    sound: 'm16',
    damage: 24,
    pellets: 1,
    spread: 0.009,
    fireRate: 0.1,
    automatic: true,
    magSize: 20,
    reserveMax: 120,
    reloadTime: 2.0,
    range: 160,
    recoil: 0.02,
    color: 0xd9782e
  },
  {
    id: 'rifle',
    name: 'Comet Rifle',
    key: '6',
    kind: 'hitscan',
    sound: 'rifle',
    damage: 24,
    pellets: 1,
    spread: 0.01,
    fireRate: 0.13,
    automatic: true,
    magSize: 28,
    reserveMax: 112,
    reloadTime: 1.9,
    range: 140,
    recoil: 0.022,
    color: 0xd9782e,
    energyColor: 0x86ff2e   // neon-green accents (reference chart)
  },
  {
    id: 'lmg',
    name: 'Plasma Suppressor',
    key: 'H',
    kind: 'hitscan',
    sound: 'lmg',
    damage: 20,
    pellets: 1,
    spread: 0.022,
    fireRate: 0.09,
    automatic: true,
    magSize: 100,
    reserveMax: 200,
    reloadTime: 4.5,
    range: 160,
    recoil: 0.03,
    color: 0xd9782e,
    energyColor: 0x86ff2e   // neon-green accents (reference chart)
  },
  {
    id: 'rpg',
    canAim: false,
    name: 'Rocket Launcher',
    key: 'G',
    kind: 'rocket',
    sound: 'rpg',
    damage: 150,
    splashRadius: 9.0,
    splashMin: 0.1,
    rocketSpeed: 40,
    pellets: 1,
    spread: 0,
    fireRate: 1.2,
    automatic: false,
    magSize: 1,
    reserveMax: 4,
    reloadTime: 3.2,
    range: 220,
    recoil: 0.09,
    color: 0xd9782e
  },
  {
    id: 'boltsniper',
    name: 'Rail Driver',
    key: 'B',
    kind: 'hitscan',
    sound: 'boltsniper',
    damage: 110,
    pellets: 1,
    spread: 0.0008,
    fireRate: 1.4,
    automatic: false,
    magSize: 5,
    reserveMax: 25,
    reloadTime: 2.8,
    range: 320,
    recoil: 0.06,
    scoped: true,
    color: 0xd9782e
  },
  {
    id: 'knife',
    name: 'Plasma Blade',
    key: 'C',
    kind: 'melee',
    damage: 55,            // melee stab damage
    fireRate: 0.32,
    range: 2.2,
    arc: 0.9,
    throwable: true,
    throwSpeed: 42,
    throwDamage: 9999,     // one-hit kill on throw
    throwCooldown: 0.85,   // seconds before you pull a fresh knife
    throwRewardMult: 3,    // 3x coins/score/xp — only on a thrown kill
    color: 0xd9782e,       // orange wrapped handle (reference chart)
    energyColor: 0x35e0ff  // cyan crystal blade
  },
  {
    id: 'sword',
    name: 'Arc Blade',
    key: 'V',
    kind: 'melee',
    damage: 75,             // 75% of a standard 100-health target
    headshotMultiplier: 4 / 3, // exact 100-damage critical when aimed at the head
    fireRate: 0.45,
    range: 2.6,
    arc: 1.0,
    color: 0xd9782e,        // orange guard/grip (chart knife language)
    energyColor: 0x00e5ff   // signature cyan arc blade
  },
  // ── Halo/Destiny-style expanded arsenal ──────────────────────────────────
  {
    id: 'magnum',
    name: 'Hand Cannon',
    key: '7',
    kind: 'hitscan',
    sound: 'magnum',
    damage: 45,
    headshotMultiplier: 2.2,
    pellets: 1,
    spread: 0.003,
    fireRate: 0.38,
    automatic: false,
    magSize: 6,
    reserveMax: 36,
    reloadTime: 1.65,
    range: 120,
    recoil: 0.028,
    color: 0xd9782e,
    energyColor: 0xffb03a,
    sciFi: true,
    authoredModel: true   // Blender model in weapons_authored.glb
  },
  {
    id: 'battlerifle',
    name: 'Burst Rifle',
    key: '8',
    kind: 'hitscan',
    sound: 'battlerifle',
    damage: 22,
    headshotMultiplier: 1.8,
    pellets: 3,
    // Three bullets released together, each consuming one round.
    ammoPerShot: 3,
    spread: 0.008,
    fireRate: 0.45,
    automatic: false,
    magSize: 36,
    reserveMax: 108,
    reloadTime: 2.0,
    range: 170,
    recoil: 0.022,
    color: 0xd9782e,
    energyColor: 0x39ff9d,
    sciFi: true,
    authoredModel: true   // Blender model in weapons_authored.glb
  },
  {
    id: 'needler',
    name: 'Needler',
    key: '9',
    kind: 'hitscan',
    sound: 'needler',
    damage: 7,
    pellets: 1,
    spread: 0.04,
    fireRate: 0.06,
    automatic: true,
    magSize: 22,
    reserveMax: 110,
    reloadTime: 1.8,
    range: 55,
    recoil: 0.01,
    color: 0xd9782e,        // orange furniture (reference-chart P90; shells are grey)
    energyColor: 0xff4dd2   // signature pink needle glow
  },
  {
    id: 'plasmarifle',
    name: 'Laser Rifle',
    key: '0',
    kind: 'hitscan',
    laserBeam: true,
    energyBlast: true,
    sound: 'plasmarifle',
    damage: 65,
    splashRadius: 3.2,
    splashMin: 0.2,
    rocketSpeed: 65,
    pellets: 1,
    spread: 0,
    fireRate: 0.8,
    automatic: false,
    magSize: 6,
    reserveMax: 30,
    reloadTime: 2.2,
    range: 150,
    recoil: 0.045,
    spawnShells: false,
    muzzleFlashScale: 1.6,
    color: 0x556274,
    energyColor: 0xb6ff32,
    sciFi: true,
    proceduralModel: true   // detailed procedural model beats the low-poly GLB placeholder
  },
  {
    id: 'dmr',
    name: 'DMR',
    key: 'R',
    kind: 'hitscan',
    sound: 'dmr',
    damage: 30,
    headshotMultiplier: 2.0,
    pellets: 1,
    spread: 0.004,
    fireRate: 0.32,
    automatic: false,
    magSize: 15,
    reserveMax: 75,
    reloadTime: 2.2,
    range: 200,
    recoil: 0.028,
    color: 0xd9782e
  },
  {
    id: 'fuelrod',
    name: 'Fuel Rod',
    key: 'T',
    kind: 'rocket',
    sound: 'fuelrod',
    damage: 100,
    splashRadius: 8.0,
    splashMin: 0.2,
    rocketSpeed: 28,
    pellets: 1,
    spread: 0,
    fireRate: 1.6,
    automatic: false,
    magSize: 1,
    reserveMax: 5,
    reloadTime: 3.5,
    range: 180,
    recoil: 0.12,
    color: 0xd9782e
  },
  {
    id: 'concussion',
    canAim: false,
    name: 'Grenade Launcher',
    key: 'Y',
    kind: 'rocket',
    sound: 'concussion',
    damage: 150,
    splashRadius: 6.5,
    splashMin: 0.1,
    rocketSpeed: 35,
    pellets: 1,
    spread: 0,
    fireRate: 0.9,
    automatic: false,
    magSize: 6,
    reserveMax: 0,
    reloadTime: 2.5,
    range: 150,
    recoil: 0.06,
    color: 0xd9782e,        // orange canopy/grip (chart furniture)
    energyColor: 0xb44bff   // plasma-violet vents + bore core
  },
  {
    id: 'energyshotgun',
    canAim: false,
    name: 'Sweeper',
    key: 'U',
    kind: 'hitscan',
    sound: 'energyshotgun',
    damage: 11,
    pellets: 1,
    spread: 0.014,
    spreadMin: 0.014,
    spreadMax: 0.045,
    spreadBloomPerShot: 0.002,
    spreadRecovery: 0.055,
    fireRate: 0.09,
    automatic: true,
    magSize: 80,
    reserveMax: 240,
    reloadTime: 3.2,
    range: 130,
    recoil: 0.021,
    spawnShells: true,
    muzzleSmoke: true,
    color: 0xd9782e,
    energyColor: 0xffd38a,
    sciFi: true,
    authoredModel: true   // Blender model in weapons_authored.glb
  },
  {
    id: 'ghammer',
    name: 'Gravity Hammer',
    key: 'X',
    kind: 'melee',
    damage: 120,
    fireRate: 0.85,
    range: 3.2,
    arc: 1.4,
    color: 0xd9782e,        // orange grip + head plates (chart furniture)
    energyColor: 0xff5a2e   // molten power band
  },
];

// Retain historical definitions for data migration, but expose only the current arsenal.
const ACTIVE_IDS = new Set(['m4', 'magnum', 'battlerifle', 'energyshotgun', 'plasmarifle', 'sword', 'levershotgun', 'concussion', 'rpg', 'uzi']);
export const WEAPONS = WEAPON_CATALOG.filter((weapon) => ACTIVE_IDS.has(weapon.id));

// Organise the arsenal into categories:
//   'main'  — the balanced core guns featured in the loadout,
//   'extra' — the specials / heavies (snipers, launchers, exotics),
//   'melee' — the blades / hammer.
// Tagged here (rather than on each def) so it stays in one place. Consumed by
// the inventory to split the arsenal into Main / Extra / Melee groups.
export const MAIN_WEAPON_IDS = ['m4', 'magnum', 'battlerifle', 'energyshotgun', 'plasmarifle'];
const _MAIN = new Set(MAIN_WEAPON_IDS);
for (const w of WEAPONS) {
  w.infiniteReserve = _MAIN.has(w.id);
  w.category = w.kind === 'melee' ? 'melee' : (_MAIN.has(w.id) ? 'main' : 'extra');
}

// Permanent loadout guns versus weapons earned inside a live match. Keep this
// contract beside the catalog so menus, viewmodels, pickups, and the authority
// server cannot quietly drift into different arsenals.
export const MATCH_PICKUP_WEAPON_IDS = WEAPONS
  .filter((w) => w.kind !== 'melee' && !_MAIN.has(w.id))
  .map((w) => w.id);
const _MATCH_PICKUPS = new Set(MATCH_PICKUP_WEAPON_IDS);

export function isMainWeaponId(id) {
  return _MAIN.has(id);
}

export function isMatchPickupWeaponId(id) {
  return _MATCH_PICKUPS.has(id);
}

export function getWeapon(id) {
  return WEAPONS.find((w) => w.id === id);
}

// Guns/blades in a given category, in arsenal order.
export function weaponsByCategory(category) {
  return WEAPONS.filter((w) => w.category === category);
}

export function canAimWeapon(def) {
  return !!def && def.kind !== 'melee' && def.canAim !== false;
}

