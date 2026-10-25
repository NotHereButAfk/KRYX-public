export const ARMOR_TYPES = [
  {
    id: 'vanguard',
    name: 'Default Reforged',
    desc: 'The current Reforged character rig, shared by every equipped skin',
    icon: 'M16 3 L9 8 L9 23 L23 23 L23 8 Z',
  },
];

export const PLAYABLE_ARMOR_IDS = Object.freeze(ARMOR_TYPES.map((armor) => armor.id));

export function normalizeArmorType(id) {
  // Keep the stable protocol/save identifier while retiring every old chassis.
  return PLAYABLE_ARMOR_IDS.includes(id) ? id : PLAYABLE_ARMOR_IDS[0];
}

export function getArmorType(id) {
  const normalized = normalizeArmorType(id);
  return ARMOR_TYPES.find((armor) => armor.id === normalized) || ARMOR_TYPES[0];
}

const LS_KEY = 'sio_armor_type';
const MODEL_MIGRATION_KEY = 'sio_armor_reforged_model_v4';

// Old Soldier/exosuit selections migrate to the current rig. The separately
// equipped Reforged cosmetic is preserved by Shop and is not changed here.
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
