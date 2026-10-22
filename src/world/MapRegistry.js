// Every playable map ships as a baked asset shared by client and server.
// Original authored arenas and imported arenas use the same collision format.
export const MAP_CATALOG = Object.freeze([
  Object.freeze({
    id: 'daytime-rook',
    name: 'Daytime Rook',
    loadingImage: '/images/maps/daytime-rook.jpg',
    region: 'Rook Sector',
    fileName: 'RookLit_0.evmap',
    url: '/maps/RookLit_0.evmap',
    environment: 'dust',
    background: 0xcfe9ef,
    fog: 0xc8d7dc,
    fogNear: 145,
    fogFar: 360,
    lighting: Object.freeze({
      sky: 0xf4fbff,
      ground: 0x41464d,
      hemisphereIntensity: 1.45,
      sun: 0xfff0cf,
      sunIntensity: 1.68,
      rim: 0x77cfff,
      rimIntensity: 0.34,
    }),
  }),
  Object.freeze({
    id: 'winter-graveyard',
    name: 'Winter-Graveyard',
    loadingImage: '/images/maps/winter-graveyard.jpg',
    region: 'Winter Graveyard',
    fileName: 'XmasGraveyard_1.evmap',
    url: '/maps/XmasGraveyard_1.evmap',
    environment: 'snow',
    background: 0xc8d4df,
    fog: 0xd7e0e8,
    fogNear: 105,
    fogFar: 300,
    lighting: Object.freeze({
      sky: 0xddeeff,
      ground: 0x263246,
      hemisphereIntensity: 1.18,
      sun: 0xdcecff,
      sunIntensity: 1.38,
      rim: 0x8bbcff,
      rimIntensity: 0.48,
    }),
  }),
  Object.freeze({
    id: 'evasion',
    botMaxDrop: 4,
    name: 'Evasion',
    loadingImage: '/images/maps/evasion.jpg',
    region: 'Evasion',
    fileName: 'HUT8Evasion_0.evmap',
    url: '/maps/HUT8Evasion_0.evmap',
    environment: 'dust',
    background: 0xb6d4ea,
    fog: 0xc4d7e7,
    fogNear: 145,
    fogFar: 360,
    lighting: Object.freeze({
      sky: 0xeaf5ff,
      ground: 0x354352,
      hemisphereIntensity: 1.35,
      sun: 0xfff0da,
      sunIntensity: 1.5,
      rim: 0x77cfff,
      rimIntensity: 0.35,
    }),
  }),
  Object.freeze({
    id: 'depot',
    name: 'Depot',
    loadingImage: '/images/maps/depot.jpg',
    region: 'Depot',
    fileName: 'Depot_2.evmap',
    url: '/maps/Depot_2.evmap',
    environment: 'dust',
    background: 0xc7d5df,
    fog: 0xc7d5df,
    fogNear: 145,
    fogFar: 360,
    lighting: Object.freeze({
      sky: 0xf2f6ff,
      ground: 0x41464d,
      hemisphereIntensity: 1.4,
      sun: 0xffefd0,
      sunIntensity: 1.5,
      rim: 0x8cbad7,
      rimIntensity: 0.3,
    }),
  }),
  Object.freeze({
    id: 'gypsum', name: 'Gypsum', region: 'Gypsum', botMaxDrop: 4,
    // Main structures, spawn pads and lower tunnel; outer dunes are scenery.
    playableBounds: Object.freeze({ minX: -66, maxX: 88, minZ: -22, maxZ: 112, maxY: 32 }),
    fileName: 'HUT8Gypsum_2.evmap', url: '/maps/HUT8Gypsum_2.evmap',
    loadingImage: '/images/maps/gypsum.jpg', environment: 'dust',
    background: 0xe5bc9d, fog: 0xe0bba3, fogNear: 145, fogFar: 360,
    lighting: Object.freeze({sky:0xffefdb,ground:0x504034,hemisphereIntensity:1.35,
      sun:0xffe5c4,sunIntensity:1.5,rim:0x99c9e5,rimIntensity:.3}),
  }),
  Object.freeze({
    id: 'checkpoint', name: 'Checkpoint', region: 'Checkpoint', botMaxDrop: 4,
    fileName: 'HUT8Checkpoint_0.evmap', url: '/maps/HUT8Checkpoint_0.evmap',
    loadingImage: '/images/maps/checkpoint.jpg', environment: 'dust',
    background: 0xc9e2f1, fog: 0xc4d7e7, fogNear: 145, fogFar: 360,
    lighting: Object.freeze({sky:0xf0f8ff,ground:0x39424c,hemisphereIntensity:1.4,
      sun:0xfff1dd,sunIntensity:1.5,rim:0x80c9ff,rimIntensity:.35}),
  }),
  Object.freeze({
    id: 'fractal', name: 'Fractal', region: 'Fractal', botMaxDrop: 4,
    // This pad sits on an isolated ledge with only two reachable patrol goals.
    excludedSpawnIndices: Object.freeze([25]),
    fileName: 'FractalPawnv3_1.evmap', url: '/maps/FractalPawnv3_1.evmap',
    loadingImage: '/images/maps/fractal.jpg', environment: 'dust',
    background: 0x293244, fog: 0x45536b, fogNear: 145, fogFar: 360,
    lighting: Object.freeze({sky:0xdcecff,ground:0x303045,hemisphereIntensity:1.4,
      sun:0xe7eeff,sunIntensity:1.35,rim:0x87c4ff,rimIntensity:.45}),
  }),
  Object.freeze({
    id: 'ancient', name: 'Ancient', region: 'Ancient', botMaxDrop: 4,
    fileName: 'Ancient23.evmap', url: '/maps/Ancient23.evmap',
    loadingImage: '/images/maps/ancient.jpg', environment: 'dust',
    background: 0xd4ccba, fog: 0xcbbfae, fogNear: 145, fogFar: 360,
    lighting: Object.freeze({sky:0xfff3df,ground:0x454036,hemisphereIntensity:1.4,
      sun:0xffe7c5,sunIntensity:1.5,rim:0x98c5df,rimIntensity:.3}),
  }),
  Object.freeze({
    id: 'little-town-2065', name: 'Little Town 2065', region: 'Little Town 2065', botMaxDrop: 4,
    fileName: '_map_little_town_4.evmap', url: '/maps/_map_little_town_4.evmap',
    loadingImage: '/images/maps/little-town-2065.jpg', environment: 'dust',
    background: 0x82cfff, fog: 0xb2daf0, fogNear: 145, fogFar: 360,
    lighting: Object.freeze({sky:0xeaf7ff,ground:0x384b40,hemisphereIntensity:1.4,
      sun:0xfff3da,sunIntensity:1.6,rim:0x7bcaff,rimIntensity:.35}),
  }),
]);

// Retain authored assets for regression fixtures; exclude retired arenas from matchmaking.
export const IMPORTED_MAPS = Object.freeze(MAP_CATALOG.filter(
  (map) => !['daytime-rook', 'winter-graveyard', 'depot'].includes(map.id),
));

export const DEFAULT_MAP_ID = IMPORTED_MAPS[0].id;

export function getImportedMap(id) {
  return IMPORTED_MAPS.find((map) => map.id === id) || IMPORTED_MAPS[0];
}

export function nextImportedMapId(currentId) {
  const index = IMPORTED_MAPS.findIndex((map) => map.id === currentId);
  return IMPORTED_MAPS[(index + 1 + IMPORTED_MAPS.length) % IMPORTED_MAPS.length].id;
}

export function importedMapIds() {
  return IMPORTED_MAPS.map((map) => map.id);
}
