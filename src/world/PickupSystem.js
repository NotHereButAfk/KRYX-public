import * as THREE from 'three';
import { buildWeaponModel, onWeaponModelReady } from '../weapons/WeaponModels.js';
import { getWeapon, MATCH_PICKUP_WEAPON_IDS } from '../weapons/weaponDefs.js';
import { disposeModel } from '../core/ModelResources.js';
import { MAX_PICKUP_SHIELD } from '../core/ShieldConfig.js';
import {
  authoredWeaponSpecs,
  randomLootSpecs,
  rollLootItem,
} from './PickupLayout.js';

const RESPAWN_DELAY = 18;  // seconds before a pickup reappears
const COLLECT_RADIUS = 1.6;
const LOOT_RESPAWN = 35;  // loot pads come back slowly — worth fighting over
const WEAPON_COLLECT_RADIUS = 2.0;
const WEAPON_COLLECT_HEIGHT = 2.2;

// Used only by maps with no authored weapon markers.
const FALLBACK_LOOT_POINTS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(22, 0, 0),
  new THREE.Vector3(-22, 0, 0),
  new THREE.Vector3(0, 0, 22),
  new THREE.Vector3(0, 0, -22),
];

// Pickup definitions: type, color, geometry size
const PICKUP_DEFS = {
  health: { color: 0x00ff88, emissive: 0x00ff88, geo: 'sphere', size: 0.28, label: '+40 HP' },
  ammo:   { color: 0xffcc00, emissive: 0xffaa00, geo: 'box',    size: 0.30, label: 'AMMO' },
};

// Fixed world positions: along avenues (open streets) and corner plazas
// Positions are [x, z] — y is always ground level + float height
const SPAWN_LAYOUT = [
  // Centre cross-avenues (health + ammo alternating)
  ['health', [  0,  28]], ['ammo',   [  0, -28]],
  ['health', [ 28,   0]], ['ammo',   [-28,   0]],
  ['health', [  0,  44]], ['ammo',   [  0, -44]],
  ['health', [ 44,   0]], ['ammo',   [-44,   0]],
  // Mid-range scatter
  ['ammo',   [ 36,  36]], ['ammo',   [-36,  36]],
  ['ammo',   [ 36, -36]], ['ammo',   [-36, -36]],
  ['health', [ 14,  14]], ['health', [-14,  14]],
  ['health', [ 14, -14]], ['health', [-14, -14]],
];

export class PickupSystem {
  constructor(scene, authoredWeaponSpawns = [], {
    shieldsEnabled = true,
    lootPads = null,
    onPickupRequest = null,
    seed = Date.now(),
  } = {}) {
    this.shieldsEnabled = shieldsEnabled;
    this.scene    = scene;
    this._pickups = [];
    this._authoritative = typeof onPickupRequest === 'function';
    this._onPickupRequest = onPickupRequest;
    this._lootSeed = Number(seed) | 0;
    this._weaponSpawns = this._resolveLootSpawns(authoredWeaponSpawns, lootPads);
    this._buildAll();
    // Upgrade map pickups as soon as the same Blender asset used in-hand is ready.
    for (const id of MATCH_PICKUP_WEAPON_IDS) {
      onWeaponModelReady(id, () => {
        for (const pickup of this._pickups) {
          if (pickup.type === 'loot' && pickup.gunId === id) {
            this._replaceLoot(pickup, { ...pickup, position: pickup.mesh.position.clone() });
          }
        }
      });
    }
  }

  _resolveLootSpawns(points, supplied) {
    if (Array.isArray(supplied) && supplied.length) {
      return supplied.map((pad, padId) => ({
        padId: pad.padId ?? padId,
        lootType: pad.lootType,
        gunId: pad.gunId,
        color: pad.color ?? (pad.lootType === 'shield' ? 0x39bfff : 0xff7a1a),
        active: pad.active !== false,
        position: new THREE.Vector3(pad.x, pad.y, pad.z),
      }));
    }
    const authored = authoredWeaponSpecs(points);
    const positions = authored.length
      ? authored.map((spec) => spec.position)
      : FALLBACK_LOOT_POINTS;
    return randomLootSpecs(positions, this._lootSeed, this.shieldsEnabled);
  }

  _buildMesh(def) {
    const mat = new THREE.MeshStandardMaterial({
      color:             def.color,
      emissive:          new THREE.Color(def.emissive),
      emissiveIntensity: 1.2,
      roughness:         0.3,
      metalness:         0.5,
      transparent:       true,
      opacity:           0.92,
    });
    let geo;
    if (def.geo === 'sphere') {
      geo = new THREE.SphereGeometry(def.size, 12, 8);
    } else {
      geo = new THREE.BoxGeometry(def.size, def.size, def.size);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.userData.noHit = true;

    // Outer glow ring
    const ringGeo = new THREE.TorusGeometry(def.size * 1.55, def.size * 0.07, 6, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: def.emissive, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.userData.noHit = true;

    const group = new THREE.Group();
    group.add(mesh);
    group.add(ring);
    group.userData.noHit = true;
    return group;
  }

  _buildAll() {
    // The authoritative server only exposes loot pads. Legacy/local matches
    // retain their lightweight health and ammo pickups.
    for (const [type, [px, pz]] of this._authoritative ? [] : SPAWN_LAYOUT) {
      const def    = PICKUP_DEFS[type];
      const mesh   = this._buildMesh(def);
      mesh.position.set(px, 0.7, pz);
      this.scene.add(mesh);
      // Stagger _animT so every pickup floats at a different phase from the start
      this._pickups.push({ type, def, mesh, active: true, respawnTimer: 0, baseY: 0.7, _animT: this._pickups.length * 1.37 });
    }
    // Random loot pads: each generation is either a temporary weapon or a
    // shield stack. The pad itself remains in the authored weapon location.
    for (const spec of this._weaponSpawns) {
      const gun = spec.lootType === 'weapon' ? getWeapon(spec.gunId) : null;
      if (spec.lootType === 'weapon' && !gun) continue;
      const mesh = this._buildLootMesh(spec, gun);
      mesh.position.copy(spec.position);
      mesh.visible = spec.active !== false;
      this.scene.add(mesh);
      this._pickups.push({
        type: 'loot', lootType: spec.lootType, gunId: spec.gunId,
        def: gun, name: gun?.name || 'Shield Stack', padId: spec.padId,
        color: spec.color, mesh, active: spec.active !== false,
        respawnTimer: 0, baseY: 0.85, _animT: this._pickups.length * 1.37,
        _requestCooldown: 0,
        _spin: mesh.getObjectByName('wpnSpin'),
      });
    }
  }

  // A marked loot spawn: a beam of light + a glowing base ring with either the
  // floating weapon model or a proper shield crest inside.
  _buildLootMesh(spec, gun) {
    const group = new THREE.Group();
    group.userData.noHit = true;
    const col = spec.color;

    // Light beam column (translucent, visible from across the map).
    const beamMat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6, 16, 1, true), beamMat);
    beam.position.y = 3.0; beam.userData.noHit = true; group.add(beam);
    // Base ring + pad.
    const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; ring.userData.noHit = true; group.add(ring);

    // Floating model shares the held weapon asset, scaled to fit the pad.
    const spin = new THREE.Group(); spin.name = 'wpnSpin'; spin.position.y = 0.85;
    const built = gun ? buildWeaponModel(gun) : null;
    const wm = built?.group;
    if (wm && spec.lootType === 'weapon') {
      wm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.noHit = true; } });
      const box = new THREE.Box3().setFromObject(wm);
      const size = box.getSize(new THREE.Vector3());
      const maxd = Math.max(size.x, size.y, size.z) || 1;
      wm.scale.setScalar(1.4 / maxd);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(1.4 / maxd);
      wm.position.sub(c);
      spin.add(wm);
    } else if (spec.lootType === 'shield') {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.72);
      shape.lineTo(0.58, 0.43);
      shape.lineTo(0.48, -0.26);
      shape.quadraticCurveTo(0.28, -0.62, 0, -0.78);
      shape.quadraticCurveTo(-0.28, -0.62, -0.48, -0.26);
      shape.lineTo(-0.58, 0.43);
      shape.closePath();
      const shield = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2 }),
        new THREE.MeshStandardMaterial({
          color: 0x147dcc, emissive: 0x39bfff, emissiveIntensity: 1.15,
          metalness: 0.62, roughness: 0.24,
        }),
      );
      shield.position.z = -0.06;
      shield.userData.noHit = true;
      const core = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.09, 0.48, 4, 8),
        new THREE.MeshBasicMaterial({ color: 0xc8f6ff }),
      );
      core.scale.x = 0.72;
      core.position.z = 0.09;
      core.userData.noHit = true;
      spin.add(shield, core);
    }
    group.add(spin);
    return group;
  }

  _disposeMesh(obj) {
    disposeModel(obj);
  }

  _collect(pickup, player, weaponSystem, hud) {
    if (pickup.type === 'loot' && this._authoritative) {
      if (pickup._requestCooldown <= 0) {
        // A sprint crosses the whole pad in ~0.28s. Retry before leaving it
        // when prediction reaches the pad ahead of authoritative movement.
        pickup._requestCooldown = 0.10;
        this._onPickupRequest?.(pickup.padId);
      }
      return;
    }

    pickup.active      = false;
    pickup.respawnTimer = pickup.type === 'loot' ? LOOT_RESPAWN : RESPAWN_DELAY;
    pickup.mesh.visible = false;

    if (pickup.type === 'loot') {
      if (pickup.lootType === 'weapon' && weaponSystem?.addMapGun) {
        const def = weaponSystem.addMapGun(pickup.gunId);
        if (def && hud) {
          hud.addKillFeed(`PICKED UP — ${def.name}`);
          // Rebuild the right-side weapon inventory so the extra shows next to the main.
          hud.buildWeaponSlots?.(weaponSystem.getHudInfo().slots, weaponSystem.currentIndex);
        }
      } else if (pickup.lootType === 'shield') {
        const gained = player.addShieldStack?.() || 0;
        if (gained && hud) hud.addKillFeed(`SHIELD STACK +${gained}`);
      }
      return;
    }

    if (pickup.type === 'health') {
      const gained = Math.min(40, player.maxHealth - player.health);
      player.health = Math.min(player.maxHealth, player.health + 40);
      if (hud) hud.addKillFeed(`+ ${gained} HP`);
    } else if (pickup.type === 'ammo') {
      if (weaponSystem) {
        for (const w of weaponSystem.loadout) {
          if (w.kind !== 'melee') {
            const st = weaponSystem.state.get(w.id);
            if (st) {
              const add = Math.floor(w.reserveMax * 0.35);
              st.reserveAmmo = Math.min(w.reserveMax, st.reserveAmmo + add);
            }
          }
        }
        if (hud) hud.addKillFeed(`AMMO REFILL`);
      }
    }
  }

  _replaceLoot(pickup, next) {
    const position = next.position || pickup.mesh.position;
    const gun = next.lootType === 'weapon' ? getWeapon(next.gunId) : null;
    if (next.lootType === 'weapon' && !gun) return;
    const old = pickup.mesh;
    const mesh = this._buildLootMesh(next, gun);
    mesh.position.copy(position);
    mesh.visible = next.active !== false;
    this.scene.add(mesh);
    this.scene.remove(old);
    this._disposeMesh(old);
    Object.assign(pickup, {
      lootType: next.lootType,
      gunId: next.gunId,
      def: gun,
      name: gun?.name || 'Shield Stack',
      color: next.color,
      mesh,
      active: next.active !== false,
      baseY: 0.85,
      _spin: mesh.getObjectByName('wpnSpin'),
      _requestCooldown: 0,
    });
  }

  syncLootPads(states = []) {
    if (!this._authoritative || !Array.isArray(states)) return;
    // Reconcile the complete server roster, including pads introduced after
    // the initial map load. Never leave a local-only weapon on an online map.
    const ids = new Set(states.map(state => state.padId));
    this._pickups = this._pickups.filter(pickup => {
      if (pickup.type === 'loot' && ids.has(pickup.padId)) return true;
      this.scene.remove(pickup.mesh); this._disposeMesh(pickup.mesh); return false;
    });
    for (const state of states) {
      if (this._pickups.some(pickup => pickup.padId === state.padId)) continue;
      const pickup = {type: 'loot', padId: state.padId, mesh: new THREE.Group(), _animT: 0};
      this._replaceLoot(pickup, {...state, position: new THREE.Vector3(state.x, state.y, state.z)});
      this._pickups.push(pickup);
    }
    const byId = new Map(states.map((state) => [state.padId, state]));
    for (const pickup of this._pickups) {
      if (pickup.type !== 'loot') continue;
      const state = byId.get(pickup.padId);
      if (!state) continue;
      const changed = pickup.lootType !== state.lootType
        || pickup.gunId !== state.gunId
        || pickup.color !== state.color;
      if (changed) {
        this._replaceLoot(pickup, {
          ...state,
          position: new THREE.Vector3(state.x, state.y, state.z),
        });
      } else {
        pickup.mesh.position.set(state.x, state.y, state.z);
        pickup.active = state.active !== false;
        pickup.mesh.visible = pickup.active;
        if (!pickup.active) pickup._requestCooldown = 0;
      }
    }
  }

  update(dt, player, weaponSystem, hud) {
    const pPos = player.position;

    for (const p of this._pickups) {
      p._requestCooldown = Math.max(0, (p._requestCooldown || 0) - dt);
      if (!p.active) {
        if (this._authoritative) continue;
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          if (p.type === 'loot') {
            const next = rollLootItem(++this._lootSeed + p.padId * 101, p.padId, this.shieldsEnabled);
            this._replaceLoot(p, { ...next, active: true, position: p.mesh.position.clone() });
          } else {
            p.active = true;
            p.mesh.visible = true;
          }
        }
        continue;
      }

      // Float + spin animation — use frame time instead of Date.now() (avoids 20 syscalls/frame)
      p._animT += dt * 2.0;
      if (p.type === 'loot') {
        // Spin only the floating weapon; the beam/ring stay put.
        if (p._spin) { p._spin.rotation.y += dt * 1.1; p._spin.position.y = p.baseY + Math.sin(p._animT) * 0.10; }
      } else {
        p.mesh.position.y  = p.baseY + Math.sin(p._animT) * 0.12;
        p.mesh.rotation.y += dt * 1.4;
      }

      // Proximity collect
      const dx = pPos.x - p.mesh.position.x;
      const dy = pPos.y - p.mesh.position.y;
      const dz = pPos.z - p.mesh.position.z;
      const radius = p.type === 'loot' ? WEAPON_COLLECT_RADIUS : COLLECT_RADIUS;
      const closeEnough = Math.sqrt(dx * dx + dz * dz) < radius
        && (p.type !== 'loot' || Math.abs(dy) < WEAPON_COLLECT_HEIGHT);
      if (closeEnough && !player.isDead) {
        // Only collect if it does something useful.
        let needed = false;
        if (p.type === 'loot' && p.lootType === 'weapon') {
          // Duplicate weapons add a full supply, even above their starting ammo.
          needed = true;
        }
        if (p.type === 'loot' && p.lootType === 'shield') needed = player.maxShield < MAX_PICKUP_SHIELD;
        if (p.type === 'health')  needed = player.health  < player.maxHealth;
        if (p.type === 'ammo')    needed = weaponSystem?.loadout.some(w =>
          w.kind !== 'melee' && weaponSystem.state.get(w.id)?.reserveAmmo < w.reserveMax
        );
        if (needed) this._collect(p, player, weaponSystem, hud);
      }
    }
  }

  dispose() {
    for (const p of this._pickups) {
      this.scene.remove(p.mesh);
      this._disposeMesh(p.mesh);
    }
    this._pickups = [];
  }
}
