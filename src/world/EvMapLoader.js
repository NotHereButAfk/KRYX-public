import * as THREE from 'three';

// Decoder for ev.io's version-3 .evmap container. Field order and bit flags
// follow the public 1.7.0 game client. Keeping the binary in its native form
// means the shipped arena is the authored map, not a screenshot-led remodel.

class EvMapReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  u8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  i16() {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u16() {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  bytes(length) {
    const value = new Uint8Array(this.buffer.slice(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  u16Array(length) {
    const value = new Uint16Array(length);
    for (let i = 0; i < length; i++) value[i] = this.u16();
    return value;
  }

  f32Array(length) {
    const value = new Float32Array(length);
    for (let i = 0; i < length; i++) value[i] = this.f32();
    return value;
  }

  vec3() {
    return new THREE.Vector3(this.f32(), this.f32(), this.f32());
  }

  vec4() {
    return new THREE.Vector4(this.f32(), this.f32(), this.f32(), this.f32());
  }

  quaternion() {
    return new THREE.Quaternion(this.f32(), this.f32(), this.f32(), this.f32());
  }

  matrix4() {
    const e = Array.from(this.f32Array(16));
    return new THREE.Matrix4().set(...e);
  }

  color() {
    return new THREE.Color(this.u8() / 255, this.u8() / 255, this.u8() / 255);
  }

  colorAlpha() {
    return { color: this.color(), alpha: this.u8() / 255 };
  }

  string() {
    const length = this.u8();
    let value = '';
    for (let i = 0; i < length; i++) value += String.fromCharCode(this.u8());
    return value;
  }

  compressedVec3() {
    if (this.u8() === 0) return new Float32Array(0);
    const minX = this.f32(), minY = this.f32(), minZ = this.f32();
    const maxX = this.f32(), maxY = this.f32(), maxZ = this.f32();
    const valueCount = this.u16() * 3;
    const out = new Float32Array(valueCount);
    for (let i = 0; i < valueCount; i += 3) {
      out[i] = minX + (maxX - minX) * (this.u16() / 65535);
      out[i + 1] = minY + (maxY - minY) * (this.u16() / 65535);
      out[i + 2] = minZ + (maxZ - minZ) * (this.u16() / 65535);
    }
    return out;
  }

  compressedVec2() {
    if (this.u8() === 0) return new Float32Array(0);
    const minX = this.f32(), minY = this.f32();
    const maxX = this.f32(), maxY = this.f32();
    const valueCount = this.u16() * 2;
    const out = new Float32Array(valueCount);
    for (let i = 0; i < valueCount; i += 2) {
      out[i] = minX + (maxX - minX) * (this.u16() / 65535);
      out[i + 1] = minY + (maxY - minY) * (this.u16() / 65535);
    }
    return out;
  }

  packedTileUvs() {
    const vertexCount = this.u16();
    const out = new Float32Array(vertexCount * 2);
    for (let i = 0; i < vertexCount; i++) {
      const packed = this.view.getUint8(this.offset + (i >> 1));
      const nibble = i & 1 ? (packed & 0xf0) >> 4 : packed & 0x0f;
      out[i * 2] = 0.125 + 0.25 * (nibble & 3);
      out[i * 2 + 1] = 0.125 + 0.25 * ((nibble & 12) >> 2);
    }
    this.offset += Math.floor((vertexCount + 1) / 2);
    return out;
  }
}

function list(reader, parse) {
  const length = reader.u16();
  const value = new Array(length);
  for (let i = 0; i < length; i++) value[i] = parse(reader);
  return value;
}

function parseIndexGroup(reader) {
  const length = reader.u16();
  return { indices: reader.u16Array(length) };
}

function parseGeometry(reader) {
  const flags = reader.u8();
  const geometry = {
    flags,
    positions: reader.compressedVec3(),
    groups: list(reader, parseIndexGroup),
  };
  if (flags & 1) geometry.normals = reader.compressedVec3();
  if (flags & 2) geometry.uv = reader.compressedVec2();
  if (flags & 4) geometry.uv2 = reader.compressedVec2();
  if (flags & 8) {
    geometry.flags |= 2;
    geometry.uv = reader.packedTileUvs();
  }
  return geometry;
}

function parseTexture(reader) {
  const type = reader.u8();
  const bytes = reader.bytes(reader.u32());
  if (type !== 0 && type !== 1) throw new Error(`Unsupported .evmap texture type ${type}`);
  return { bytes, mime: type === 0 ? 'image/png' : 'image/jpeg' };
}

function parseLegacyMaterial(reader) {
  const flags = reader.u8();
  const material = { type: 0, flags, extensionFlags: 0 };
  if (flags & 128) material.extensionFlags = reader.u8();
  if (flags & 1) Object.assign(material, reader.colorAlpha());
  if (flags & 2) material.map = reader.u16();
  if (flags & 4) material.emissive = reader.color();
  if (flags & 8) material.emissiveMap = reader.u16();
  if (flags & 16) material.emissiveIntensity = reader.f32();
  if (flags & 32) material.reflectivity = reader.f32();
  if (flags & 64) material.auxTexture = reader.u16();
  if (flags & 128) {
    if (material.extensionFlags & 1) material.roughness = reader.f32();
    if (material.extensionFlags & 2) material.roughnessMap = reader.i16();
    if (material.extensionFlags & 4) material.aoMap = reader.i16();
    if (material.extensionFlags & 8) material.aoIntensity = reader.f32();
    if (material.extensionFlags & 16) material.normalMap = reader.i16();
    if (material.extensionFlags & 32) material.clipPlane = reader.vec4();
  }
  return material;
}

function parseSpecialMaterial(reader) {
  const { color } = reader.colorAlpha();
  const material = { type: 1, color };
  reader.u16();
  reader.vec4();
  reader.vec4();
  reader.f32();
  reader.vec4();
  reader.f32();
  reader.f32();
  reader.f32();
  reader.colorAlpha();
  return material;
}

function parseTypedMaterial(reader) {
  const type = reader.u8();
  if (type === 0) return parseLegacyMaterial(reader);
  if (type === 1) return parseSpecialMaterial(reader);
  if (type === 2) return { type, color: reader.color() };
  if (type === 3) return { type };
  throw new Error(`Unsupported .evmap material type ${type}`);
}

function parseTransform(reader) {
  return {
    position: reader.vec3(),
    quaternion: reader.quaternion(),
    scale: reader.vec3(),
  };
}

function parseSceneNode(reader) {
  const flags = reader.u8();
  const node = {
    flags,
    transform: parseTransform(reader),
    children: list(reader, parseSceneNode),
    name: '',
    geometry: -1,
    materialIndices: [],
    collisionKind: 1,
  };
  if (flags & 1) node.name = reader.string();
  if (flags !== 0) node.geometry = reader.u16();
  if (flags & 2) {
    const length = reader.u16();
    node.materialIndices = Array.from(reader.u16Array(length));
  }
  node.collisionKind = flags & 32 ? reader.u32() : 1;
  if (flags & 8) {
    node.lightMap = reader.u16();
    node.lightMapScaleX = reader.f32();
    node.lightMapScaleY = reader.f32();
    node.lightMapOffsetX = reader.f32();
    node.lightMapOffsetY = reader.f32();
  }
  return node;
}

function parseSpawn(reader, extended) {
  // Legacy spawns include yaw too; only the flags byte is new.
  const position = reader.vec4();
  if (!extended) return { position, enabled: true, team1: false, team2: false };
  const flags = reader.u8();
  return {
    position,
    enabled: !!(flags & 1),
    team1: !!(flags & 2),
    team2: !!(flags & 4),
  };
}

function skipMapMetadata(reader, headerFlags, extensionFlags) {
  // Directional/point light records.
  list(reader, (r) => {
    r.vec3();
    r.color();
    r.f32();
    const flags = r.u8();
    if (flags !== 255 && flags & 2) r.f32();
  });

  // Shadow-camera metadata.
  reader.vec3();
  reader.f32();
  reader.f32();
  reader.f32();

  // Skybox or sky-gradient record.
  if (headerFlags & 4) {
    reader.u8();
    reader.color();
    reader.color();
    reader.color();
  } else {
    reader.u16();
    reader.u16();
    reader.u16();
    reader.u16();
    reader.u16();
    reader.u16();
  }

  reader.color();
  reader.f32();
  if (!(headerFlags & 8)) {
    reader.color();
    reader.f32();
  }

  if (headerFlags & 1) {
    reader.color();
    reader.color();
    reader.f32();
  }

  if (headerFlags & 2) {
    list(reader, (r) => {
      r.vec3();
      list(r, (rr) => rr.vec3());
    });
  }

  if (headerFlags & 16) {
    list(reader, (r) => {
      list(r, (rr) => {
        rr.vec3();
        rr.quaternion();
        rr.f32();
      });
    });
  }

  if (extensionFlags & 1) {
    list(reader, (r) => {
      const flags = r.u8();
      r.vec3();
      const count = r.u16();
      r.u16Array(count);
      if (flags & 1) r.string();
    });
  }
  if (extensionFlags & 2) reader.vec4();
  if (extensionFlags & 32) {
    list(reader, (r) => {
      r.u8();
      r.vec3();
    });
  }
  if (extensionFlags & 4) {
    list(reader, (r) => {
      const flags = r.u8();
      r.vec3();
      r.f32();
      r.f32();
      const count = r.u16();
      r.u16Array(count);
      if (flags & 1) r.string();
    });
  }
  if (extensionFlags & 128) {
    list(reader, (r) => {
      r.vec3();
      r.f32();
    });
  }
  if (extensionFlags & 8) reader.f32();
}

export function parseEvMap(buffer) {
  const reader = new EvMapReader(buffer);
  const format = reader.u8();
  if (format !== 3) throw new Error('Not an ev.io version-3 .evmap file');

  const headerFlags = reader.u8();
  const extensionFlags = headerFlags & 128 ? reader.u8() : 0;
  const geometries = list(reader, parseGeometry);
  const textures = list(reader, parseTexture);
  const materials = headerFlags & 64
    ? list(reader, parseTypedMaterial)
    : list(reader, parseLegacyMaterial);
  const root = parseSceneNode(reader);

  const markerCount = reader.u16();
  const spawns = new Array(markerCount);
  for (let i = 0; i < markerCount; i++) {
    if (headerFlags & 32) {
      const flags = reader.u8();
      const position = reader.vec3();
      const kind = flags & 1 ? reader.u32() : reader.u8();
      spawns[i] = { position: new THREE.Vector4(position.x, position.y, position.z, 0), kind };
    } else {
      const position = reader.vec3();
      spawns[i] = { position: new THREE.Vector4(position.x, position.y, position.z, 0), kind: 0 };
    }
  }

  const spawnCount = reader.u16();
  const playerSpawns = new Array(spawnCount);
  const extendedSpawns = !!(extensionFlags & 64);
  for (let i = 0; i < spawnCount; i++) playerSpawns[i] = parseSpawn(reader, extendedSpawns);

  skipMapMetadata(reader, headerFlags, extensionFlags);

  return {
    format,
    headerFlags,
    extensionFlags,
    geometries,
    textures,
    materials,
    root,
    markers: spawns,
    playerSpawns,
    bytesRead: reader.offset,
    byteLength: buffer.byteLength,
  };
}

async function loadTexture(record) {
  const url = URL.createObjectURL(new Blob([record.bytes], { type: record.mime }));
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildMaterial(record, textures) {
  if (record.type === 3) {
    return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  }
  if (record.type === 1 || record.type === 2) {
    return new THREE.MeshBasicMaterial({
      color: record.color ?? 0xffffff,
      toneMapped: false,
      side: THREE.FrontSide,
      shadowSide: THREE.DoubleSide,
    });
  }

  const params = {
    color: record.color ?? new THREE.Color(0xffffff),
    // Preserve the authored arena palette instead of filmic desaturation.
    toneMapped: false,
    opacity: record.alpha ?? 1,
    transparent: (record.alpha ?? 1) < 0.99,
    dithering: true,
    side: THREE.FrontSide,
    shadowSide: THREE.DoubleSide,
  };
  if (record.map != null && textures[record.map]) params.map = textures[record.map];
  if (record.emissive) params.emissive = record.emissive;
  if (record.emissiveMap != null && textures[record.emissiveMap]) params.emissiveMap = textures[record.emissiveMap];
  if (record.emissiveIntensity != null) params.emissiveIntensity = record.emissiveIntensity;
  if (record.aoMap >= 0 && textures[record.aoMap]) params.aoMap = textures[record.aoMap];
  if (record.aoIntensity != null) params.aoMapIntensity = record.aoIntensity;
  if (record.normalMap >= 0 && textures[record.normalMap]) params.normalMap = textures[record.normalMap];
  return new THREE.MeshToonMaterial(params);
}

function buildGeometry(record) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(record.positions, 3));
  if (record.normals?.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(record.normals, 3));
  }
  if (record.uv?.length) {
    const uv = new THREE.Float32BufferAttribute(record.uv, 2);
    geometry.setAttribute('uv', uv);
    if (!record.uv2?.length) geometry.setAttribute('uv2', uv);
  }
  if (record.uv2?.length) {
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(record.uv2, 2));
  }

  const indices = [];
  for (const group of record.groups) indices.push(...group.indices);
  geometry.setIndex(indices);
  let offset = 0;
  for (let i = 0; i < record.groups.length; i++) {
    const count = record.groups[i].indices.length;
    geometry.addGroup(offset, count, i);
    offset += count;
  }
  if (!record.normals?.length) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildSceneNode(node, geometries, materials, fallbackMaterial) {
  let object;
  if (node.flags & 2 && geometries[node.geometry]) {
    const groupMaterials = node.materialIndices.map((index) => materials[index] ?? fallbackMaterial);
    while (groupMaterials.length < geometries[node.geometry].groups.length) {
      groupMaterials.push(fallbackMaterial);
    }
    object = new THREE.Mesh(geometries[node.geometry], groupMaterials);
    object.castShadow = false;
    object.receiveShadow = true;
    object.userData.evMapCollider = !!(node.flags & 4);
    object.userData.evMapCollisionKind = node.collisionKind;
  } else {
    object = new THREE.Group();
  }

  object.name = node.name || '';
  object.position.copy(node.transform.position);
  object.quaternion.copy(node.transform.quaternion);
  object.scale.copy(node.transform.scale);
  for (const child of node.children) {
    object.add(buildSceneNode(child, geometries, materials, fallbackMaterial));
  }
  return object;
}

function reversedGeometry(source) {
  const geometry = source.clone();
  if (!geometry.index) return geometry;
  const sourceIndex = geometry.index.array;
  const reversed = new sourceIndex.constructor(sourceIndex);
  for (let i = 0; i < reversed.length; i += 3) {
    const b = reversed[i + 1];
    reversed[i + 1] = reversed[i + 2];
    reversed[i + 2] = b;
  }
  geometry.setIndex(new THREE.BufferAttribute(reversed, 1));
  return geometry;
}

function buildColliderNode(node, geometries, material) {
  const object = node.flags & 4 && geometries[node.geometry]
    ? new THREE.Mesh(reversedGeometry(geometries[node.geometry]), material)
    : new THREE.Group();
  object.position.copy(node.transform.position);
  object.quaternion.copy(node.transform.quaternion);
  object.scale.copy(node.transform.scale);
  object.userData.evMapCollisionKind = node.collisionKind;
  for (const child of node.children) {
    object.add(buildColliderNode(child, geometries, material));
  }
  return object;
}

export function buildEvMapScene(parsed, textures = [], { excludedSpawnIndices = [] } = {}) {
  const materials = parsed.materials.map((record) => buildMaterial(record, textures));
  const geometries = parsed.geometries.map(buildGeometry);
  const fallbackMaterial = new THREE.MeshToonMaterial({ color: 0x777777 });
  const root = buildSceneNode(parsed.root, geometries, materials, fallbackMaterial);

  // ev.io mirrors the completed scene root when moving from its authored
  // coordinate system into Three.js.
  root.scale.x *= -1;
  root.updateMatrixWorld(true);

  const colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const colliderRoot = buildColliderNode(parsed.root, geometries, colliderMaterial);
  colliderRoot.scale.x *= -1;
  colliderRoot.updateMatrixWorld(true);
  const raycastMeshes = [];
  colliderRoot.traverse((object) => {
    if (object.isMesh) raycastMeshes.push(object);
  });

  // Team-only maps still need their authored spawn pads in free-for-all.
  const hasFreeForAllSpawns = parsed.playerSpawns.some(spawn => spawn.enabled);
  const spawnPoints = parsed.playerSpawns
    .filter((spawn) => spawn.enabled || (!hasFreeForAllSpawns && (spawn.team1 || spawn.team2)))
    .filter((_spawn, index) => !excludedSpawnIndices.includes(index))
    .map((spawn) => {
      const point = new THREE.Vector3(
        -spawn.position.x,
        spawn.position.y,
        spawn.position.z,
      );
      point.spawnYaw = THREE.MathUtils.degToRad(270 - spawn.position.w);
      return point;
    });
  // Authored markers describe floating display centers, not floor pads.
  // Probe both triangle sides because imported mirrored floors have mixed winding.
  const pickupRay = new THREE.Raycaster();
  const pickupSide = colliderMaterial.side;
  colliderMaterial.side = THREE.DoubleSide;
  const weaponSpawnPoints = parsed.markers.map((marker) => {
    const point = new THREE.Vector3(
      -marker.position.x,
      marker.position.y,
      marker.position.z,
    );
    pickupRay.set(point.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3(0, -1, 0));
    pickupRay.far = 12;
    const floor = pickupRay.intersectObjects(raycastMeshes, false).find(hit => {
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      return Math.abs(normal.y) > 0.65 && hit.point.y <= point.y + 0.1;
    });
    if (floor) point.y = floor.point.y + 0.04;
    point.markerKind = marker.kind;
    return point;
  });

  colliderMaterial.side = pickupSide;

  const collisionBounds = new THREE.Box3().setFromObject(colliderRoot);
  const bounds = spawnPoints.length
    ? new THREE.Box3().setFromPoints(spawnPoints)
    : collisionBounds.clone();
  if (spawnPoints.length) {
    bounds.min.x -= 45;
    bounds.min.z -= 45;
    bounds.max.x += 45;
    bounds.max.z += 45;
    bounds.min.y = 0;
    bounds.max.y = Math.max(60, bounds.max.y + 30);
  }
  const spectatorWaypoints = [];
  const spectatorRoutes = [];
  if (spawnPoints.length) {
    // Keep the menu camera in one authored-safe lane. Sweeping between distant
    // spawns would interpolate straight through Rook's walls and overhangs.
    const point = spawnPoints[0];
    const yaw = point.spawnYaw ?? Math.PI;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const eye = point.clone().add(new THREE.Vector3(0, 1.7, 0));
    const target = point.clone().addScaledVector(forward, 26).add(new THREE.Vector3(0, 3.6, 0));
    spectatorWaypoints.push(
      { p: eye.clone(), t: target.clone() },
      { p: eye.clone().addScaledVector(forward, 2), t: target.clone() },
      { p: eye.clone().addScaledVector(right, 1.7), t: target.clone() },
      { p: eye.clone().addScaledVector(right, -1.7), t: target.clone() },
    );
    // Every spawn is an authored-safe viewpoint. Short local dolly lanes let
    // the spectator tour the map without interpolating through walls between
    // distant spawns.
    for (const spawn of spawnPoints) {
      const spawnYaw = spawn.spawnYaw ?? Math.PI;
      const laneForward = new THREE.Vector3(-Math.sin(spawnYaw), 0, -Math.cos(spawnYaw));
      const laneRight = new THREE.Vector3(-laneForward.z, 0, laneForward.x);
      const laneEye = spawn.clone().add(new THREE.Vector3(0, 1.85, 0));
      const laneTarget = spawn.clone().addScaledVector(laneForward, 18).add(new THREE.Vector3(0, 2.8, 0));
      spectatorRoutes.push([
        { p: laneEye.clone().addScaledVector(laneRight, -1.1), t: laneTarget.clone() },
        { p: laneEye.clone().addScaledVector(laneForward, 1.5), t: laneTarget.clone().addScaledVector(laneRight, 0.7) },
        { p: laneEye.clone().addScaledVector(laneForward, 3.2), t: laneTarget.clone() },
        { p: laneEye.clone().addScaledVector(laneForward, 4.6).addScaledVector(laneRight, 1.1), t: laneTarget.clone().addScaledVector(laneRight, -0.7) },
      ]);
    }
  }
  return {
    root,
    colliderRoot,
    raycastMeshes,
    spawnPoints,
    weaponSpawnPoints,
    bounds,
    collisionBounds,
    spectatorWaypoints,
    spectatorRoutes,
    parsed,
  };
}

export async function loadEvMap(url, options = {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  const parsed = parseEvMap(await response.arrayBuffer());
  const textures = await Promise.all(parsed.textures.map(loadTexture));
  return buildEvMapScene(parsed, textures, options);
}
