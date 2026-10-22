export const ARMOR_TYPES = [
  {
    id: 'vanguard',
    name: 'DEFAULT OPERATIVE',
    desc: 'EV default operative — orange armor, pale shells, lime optics',
    icon: 'M16 3 L9 8 L9 23 L23 23 L23 8 Z',
  },
  {
    id: 'striker',
    name: 'FROST RONIN',
    desc: 'Steel-blue infiltration shinobi — cyan optics',
    icon: 'M16 5 L11 8 L12 21 L20 21 L21 8 Z',
  },
  {
    id: 'phantom',
    name: 'NIGHTSTALKER',
    desc: 'Blacked-out shadow shinobi — red optics',
    icon: 'M16 5 L12 9 L13 21 L19 21 L20 9 Z',
  },
];

export const PLAYABLE_ARMOR_IDS = Object.freeze(ARMOR_TYPES.map((armor) => armor.id));

const LEGACY_ARMOR_MAP = Object.freeze({
  assault: 'vanguard',
  recon: 'striker',
  heavy: 'vanguard',
  stealth: 'phantom',
});

export function normalizeArmorType(id) {
  const mapped = LEGACY_ARMOR_MAP[id] || id;
  return PLAYABLE_ARMOR_IDS.includes(mapped) ? mapped : PLAYABLE_ARMOR_IDS[0];
}

export function getArmorType(id) {
  const normalized = normalizeArmorType(id);
  return ARMOR_TYPES.find((armor) => armor.id === normalized) || ARMOR_TYPES[0];
}

const LS_KEY = 'sio_armor_type';
const MODEL_MIGRATION_KEY = 'sio_armor_arena_model_v3';

// Retire the old Soldier kits from the live roster. Their layered tactical
// plates and oversized gloves made the firearm look embedded even when the
// mathematical grip points were clear. Preserve the closest visual identity
// while moving every saved profile onto a connected exosuit chassis.
export function loadArmorType() {
  const saved = localStorage.getItem(LS_KEY);
  const normalized = normalizeArmorType(saved);
  if (!localStorage.getItem(MODEL_MIGRATION_KEY) || saved !== normalized) {
    localStorage.setItem(MODEL_MIGRATION_KEY, '1');
    localStorage.setItem(LS_KEY, normalized);
  }
  return normalized;
}

export function saveArmorType(id) {
  localStorage.setItem(LS_KEY, normalizeArmorType(id));
}
