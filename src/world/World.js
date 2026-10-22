import * as THREE from 'three';
import { playableKillY, constrainPlayablePosition } from './PlayableBounds.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';
import { boundedOctreeRayIntersect } from './BoundedOctreeRay.js';
import { loadEvMap } from './EvMapLoader.js';
import { DEFAULT_MAP_ID, getImportedMap, nextImportedMapId } from './MapRegistry.js';

const _boxHit = new THREE.Vector3();

function disposeRoot(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value?.isTexture) value.dispose?.();
    }
    material.dispose?.();
  }
}

export class World {
  constructor(initialMapId = DEFAULT_MAP_ID, { autoLoad = true } = {}) {
    this.scene = new THREE.Scene();
    this.colliders = [];
    this.platforms = [];
    this.gravLifts = [];
    this.teleporters = [];
    this.spawnPoints = [new THREE.Vector3(0, 3, 0)];
    this.weaponSpawnPoints = [];
    this.previewPedestalPos = new THREE.Vector3(0, 3, 0);
    this.arenaHalf = 128;
    this.killY = -25;
    this.usesMeshCollision = true;
    this.currentMapId = null;
    this.currentMap = null;
    this._mapRoot = null;
    this._mapColliderRoot = null;
    this._mapOctree = null;
    this._mapBounds = null;
    this._raycastMeshes = [];
    this._raycastBoxes = [];
    this._loadToken = 0;
    this._groundRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    this._playerCapsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.45);
    this._collisionPush = new THREE.Vector3();

    this._buildLighting();
    // Game startup can explicitly begin the CPU-heavy .evmap decode after its
    // connection handoff has painted. Direct World users keep immediate load.
    this._initialMapId = initialMapId;
    this.ready = autoLoad ? this.loadMap(initialMapId) : null;
  }

  startInitialLoad() {
    if (!this.ready) this.ready = this.loadMap(this._initialMapId);
    return this.ready;
  }

  _buildLighting() {
    this._hemisphere = new THREE.HemisphereLight();
    this._sun = new THREE.DirectionalLight();
    this._sun.position.set(-82, 118, 66);
    this._rim = new THREE.DirectionalLight();
    this._rim.position.set(72, 42, -64);
    this.scene.add(this._hemisphere, this._sun, this._rim);
  }

  _applyLighting(definition) {
    const profile = definition.lighting;
    if (!profile) return;
    this._hemisphere.color.setHex(profile.sky);
    this._hemisphere.groundColor.setHex(profile.ground);
    this._hemisphere.intensity = profile.hemisphereIntensity;
    this._sun.color.setHex(profile.sun);
    this._sun.intensity = profile.sunIntensity;
    this._rim.color.setHex(profile.rim);
    this._rim.intensity = profile.rimIntensity;
  }

  async loadMap(mapId) {
    const definition = getImportedMap(mapId);
    if (this.currentMapId === definition.id && this.currentMap) return this.currentMap;

    const token = ++this._loadToken;
    const map = await loadEvMap(definition.url, definition);
    if (token !== this._loadToken) {
      disposeRoot(map.root);
      disposeRoot(map.colliderRoot);
      return this.currentMap;
    }

    if (this._mapRoot) this.scene.remove(this._mapRoot);
    disposeRoot(this._mapRoot);
    disposeRoot(this._mapColliderRoot);

    this.currentMapId = definition.id;
    this.playableBounds = definition.playableBounds || null;
    this.currentMap = { ...map, definition };
    this._mapRoot = map.root;
    this._mapColliderRoot = map.colliderRoot;
    this._mapOctree = new Octree().fromGraphNode(map.colliderRoot);
    this._mapBounds = map.bounds;
    this._raycastMeshes = map.raycastMeshes;
    this._raycastBoxes = [];
    this.colliders = [];
    this.platforms = [];
    this.gravLifts = [];
    this.teleporters = [];
    this.spawnPoints = map.spawnPoints.length
      ? map.spawnPoints
      : [new THREE.Vector3(0, 3, 0)];
    this.weaponSpawnPoints = map.weaponSpawnPoints;

    const maxXZ = Math.max(
      Math.abs(map.bounds.min.x), Math.abs(map.bounds.max.x),
      Math.abs(map.bounds.min.z), Math.abs(map.bounds.max.z),
    );
    this.arenaHalf = Math.ceil(maxXZ + 4);
    this.killY = playableKillY(this.spawnPoints);
    const previewSpawn = this.spawnPoints.find((point) => point.y <= 3.1) || this.spawnPoints[0];
    this.previewPedestalPos.copy(previewSpawn);

    this.scene.background = new THREE.Color(definition.background);
    this.scene.fog = new THREE.Fog(
      definition.fog,
      definition.fogNear,
      definition.fogFar,
    );
    this._applyLighting(definition);
    this.scene.add(map.root);
    map.root.traverse((object) => {
      if (object.isMesh && object.matrixAutoUpdate) {
        object.matrixAutoUpdate = false;
        object.updateMatrix();
      }
    });
    return this.currentMap;
  }

  loadNextMap() {
    return this.loadMap(nextImportedMapId(this.currentMapId));
  }

  // Imported map animation is authored into the map assets. This hook stays in
  // place because Game drives World on both menu and gameplay frames.
  update(_dt) {}

  groundHeightAt(x, z, prevY, newY) {
    if (!this._mapOctree) return -Infinity;
    const stepUp = 0.55;
    const grace = 0.06;
    this._groundRay.origin.set(x, Math.max(prevY, newY) + stepUp + grace, z);
    const hit = this._mapOctree.rayIntersect(this._groundRay);
    if (!hit) return -Infinity;
    const normal = hit.triangle.getNormal(_boxHit);
    const top = hit.position.y;
    const crossed = prevY >= top - grace && newY <= top + grace;
    const stepping = newY <= top + stepUp && newY >= top - 0.8;
    return normal.y > 0.35 && (crossed || stepping) ? top : -Infinity;
  }

  queryGravLift(x, z, y) {
    for (const lift of this.gravLifts) {
      const dx = x - lift.x;
      const dz = z - lift.z;
      if (dx * dx + dz * dz < lift.r * lift.r && y < lift.topY) return lift.power;
    }
    return 0;
  }

  queryTeleport(x, z) {
    for (const teleporter of this.teleporters) {
      const dx = x - teleporter.x;
      const dz = z - teleporter.z;
      if (dx * dx + dz * dz < teleporter.r * teleporter.r) return teleporter.dest;
    }
    return null;
  }

  randomSpawnPoint() {
    return this._cloneSpawn(this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]);
  }

  _cloneSpawn(point) {
    const clone = point.clone();
    if (Number.isFinite(point.spawnYaw)) clone.spawnYaw = point.spawnYaw;
    return clone;
  }

  safeSpawnPoint(occupants = []) {
    const live = occupants.filter((occupant) => occupant && occupant.alive !== false && occupant.position);
    if (!live.length) return this.randomSpawnPoint();
    const scored = this.spawnPoints.map((point) => {
      let nearest = Infinity;
      for (const occupant of live) {
        const dx = point.x - occupant.position.x;
        const dy = point.y - occupant.position.y;
        const dz = point.z - occupant.position.z;
        nearest = Math.min(nearest, dx * dx + dz * dz + dy * dy * 0.2);
      }
      return { point, nearest };
    }).sort((a, b) => b.nearest - a.nearest);
    const best = scored[0]?.nearest ?? 0;
    const threshold = Math.max(12 * 12, best * 0.72);
    let top = scored.filter((entry) => entry.nearest >= threshold);
    if (!top.length) top = scored.slice(0, 1);
    top = top.slice(0, Math.max(1, Math.ceil(scored.length / 3)));
    return this._cloneSpawn(top[Math.floor(Math.random() * top.length)].point);
  }

  get raycastMeshes() {
    return this._raycastMeshes;
  }

  get raycastBoxes() {
    return this._raycastBoxes;
  }

  raycastBoxHit(ray, far = Infinity) {
    let best = null;
    for (const box of this.raycastBoxes) {
      if (box.containsPoint(ray.origin)) continue;
      const point = ray.intersectBox(box, _boxHit);
      if (!point) continue;
      const distance = ray.origin.distanceTo(point);
      if (distance <= far && (!best || distance < best.distance)) {
        best = { point: point.clone(), distance, box };
      }
    }
    return best;
  }

  /**
   * Cheap nearest-obstruction query for bot navigation and gunfire. Imported
   * arenas already build an octree for collision, so re-use that acceleration
   * structure instead of asking Three.js to traverse every map mesh and every
   * triangle for each bot probe.
   */
  raycastCollisionDistance(ray, far = Infinity) {
    let distance = far;
    if (this._mapOctree) {
      const hit = boundedOctreeRayIntersect(this._mapOctree, ray, far);
      if (hit && hit.distance > 0.015 && hit.distance < distance) distance = hit.distance;
    }
    const boxHit = this.raycastBoxHit(ray, distance);
    if (boxHit && boxHit.distance < distance) distance = boxHit.distance;
    return distance;
  }

  /**
   * Raycast against the collision scene rather than the decorative render
   * meshes. Fast rockets and tiny grenades cannot tunnel through a thin floor
   * merely because its visible mesh was simplified or tagged noHit.
   */
  raycastCollisionHit(ray, far = Infinity) {
    let best = null;
    if (this._mapOctree) {
      const hit = boundedOctreeRayIntersect(this._mapOctree, ray, far, 0);
      if (hit && hit.distance >= 0 && hit.distance <= far) {
        best = {
          point: hit.position.clone(),
          distance: hit.distance,
          normal: hit.triangle.getNormal(new THREE.Vector3()),
        };
      }
    }

    const boxHit = this.raycastBoxHit(ray, far);
    if (boxHit && (!best || boxHit.distance < best.distance)) {
      const p = boxHit.point;
      const b = boxHit.box;
      const distances = [
        [Math.abs(p.x - b.min.x), -1, 0, 0], [Math.abs(p.x - b.max.x), 1, 0, 0],
        [Math.abs(p.y - b.min.y), 0, -1, 0], [Math.abs(p.y - b.max.y), 0, 1, 0],
        [Math.abs(p.z - b.min.z), 0, 0, -1], [Math.abs(p.z - b.max.z), 0, 0, 1],
      ].sort((a, b2) => a[0] - b2[0]);
      best = {
        point: p.clone(), distance: boxHit.distance,
        normal: new THREE.Vector3(distances[0][1], distances[0][2], distances[0][3]),
      };
    }
    return best;
  }

  /**
   * Resolve a character capsule and optionally report walkable contact.
   * Position-only pushout used to leave bots permanently marked airborne: the
   * floor held their mesh up while gravity and the falling animation continued.
   */
  resolveCollisions(position, radius, contact = null, height = 1.7) {
    const inputY = position.y;
    if (contact) {
      contact.boundaryMask = 0;
      contact.grounded = false;
      contact.normalY = -1;
      contact.depth = 0;
      contact.verticalCorrection = 0;
    }
    if (!this._mapOctree) return position;
    const capsule = this._playerCapsule;
    capsule.radius = radius;
    capsule.start.set(position.x, position.y + radius, position.z);
    capsule.end.set(position.x, position.y + Math.max(radius, height - radius), position.z);
    for (let iteration = 0; iteration < 3; iteration++) {
      const hit = this._mapOctree.capsuleIntersect(capsule);
      if (!hit) break;
      capsule.translate(this._collisionPush.copy(hit.normal).multiplyScalar(hit.depth));
      if (contact && hit.normal.y > contact.normalY) {
        contact.normalY = hit.normal.y;
        contact.depth = Math.max(contact.depth, hit.depth);
        if (hit.normal.y > 0.35) contact.grounded = true;
      }
    }
    position.set(capsule.start.x, capsule.start.y - radius, capsule.start.z);
    const boundaryMask = constrainPlayablePosition(position, this.playableBounds, radius, height);
    if (contact) {
      contact.boundaryMask = boundaryMask;
      contact.verticalCorrection = position.y - inputY;
      // Bevelled/imported floors can report a shallow triangle normal even
      // though their capsule correction is holding the character up. An
      // actual upward correction is support; a wall-only push has zero Y.
      if (contact.verticalCorrection > 0.002) contact.grounded = true;
    }
    return position;
  }
}
