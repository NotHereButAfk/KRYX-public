import { applyMouseLook } from '../core/MouseLook.js';
// Feature-flagged rendered bridge (Phase 3): drives the player from the
// deterministic 20 Hz MoveSim core instead of the legacy per-frame
// controller, with interpolation between ticks for smooth rendering.
//
// OFF by default — the legacy controller remains the shipping path until the
// G2 evidence gate passes. Enable with ?movesim=1 or
// localStorage.kx_movesim = "1".
//
// The bridge owns look + camera + movement while active; combat, weapons,
// HUD and everything else keep reading the same Player fields they always
// did (position, velocity, onGround, isCrouching, stamina, teleportCooldown).

import * as THREE from 'three';
import { sprintRequested, crouchRequested, consumeSlidePress } from '../core/GameplayInput.js';
import { createState, step, makeInput, isSprinting, worldAdapter, hashState, DT } from './MoveSim.js';

const SHIELD_REGEN = 6, SHIELD_REGEN_DELAY = 3.0;

export function moveSimEnabled() {
  try {
    if (new URLSearchParams(location.search).has('movesim')) return true;
    return localStorage.getItem('kx_movesim') === '1';
  } catch { return false; }
}

export class MoveBridge {
  constructor(player, world) {
    this.player = player;
    this.worldRef = world;
    this._headroomRay = new THREE.Ray();
    this.simWorld = this._adaptWorld(world);
    const p = player.position;
    this.state = createState(p.x, p.y, p.z);
    this.prev = this.state;
    this.acc = 0;
    this._edges = { jump: false, crouch: false, tele: false };
    this._written = new THREE.Vector3().copy(p);
    this._respawnEpoch = player._respawnEpoch || 0;
    this.recoveredThisFrame = false;
  }

  currentHash() { return hashState(this.state); }

  _adaptWorld(world) {
    const adapted = worldAdapter(world);
    if (world.raycastCollisionDistance) adapted.raycast = (ox, oy, oz, dx, dy, dz, far) => {
      this._headroomRay.origin.set(ox, oy, oz);
      this._headroomRay.direction.set(dx, dy, dz);
      return world.raycastCollisionDistance(this._headroomRay, far);
    };
    return adapted;
  }

  _resyncIfMoved() {
    // Respawns / pad teleports / external code moved the player — restart the
    // sim from wherever the game put them.
    const p = this.player.position;
    const respawned = (this.player._respawnEpoch || 0) !== this._respawnEpoch;
    if (respawned || p.distanceToSquared(this._written) > 2.25) {
      this.state = createState(p.x, p.y, p.z);
      this.prev = this.state;
      this.acc = 0;
      this._respawnEpoch = this.player._respawnEpoch || 0;
    }
  }

  update(dt, input, world) {
    const p = this.player;
    this.recoveredThisFrame = false;
    if (world !== this.worldRef) {           // map changed — rebuild adapter
      this.worldRef = world;
      this.simWorld = this._adaptWorld(world);
    }
    this._resyncIfMoved();

    // ── look (same math as the legacy controller) ──
    applyMouseLook(p, input);

    // recoil springs (same constants as the legacy controller)
    const rs = -p.recoilPitch * 18 - p.recoilPitchVel * 6;
    p.recoilPitchVel += rs * dt;
    p.recoilPitch += p.recoilPitchVel * dt;
    const ys = -p.recoilYaw * 18 - p.recoilYawVel * 6;
    p.recoilYawVel += ys * dt;
    p.recoilYaw += p.recoilYawVel * dt;

    // shield regen (gameplay state the legacy update owned)
    p.updateHealthRegen?.(dt);
    if (p._shieldRegenDelay > 0) p._shieldRegenDelay = Math.max(0, p._shieldRegenDelay - dt);
    else if (p.shield < p.maxShield) p.shield = Math.min(p.maxShield, p.shield + SHIELD_REGEN * dt);

    // ── collect edge inputs every frame, consume on the next tick ──
    if (input.consumeJustPressed('Space')) this._edges.jump = true;
    if (consumeSlidePress(input)) this._edges.crouch = true;
    if (input.teleportConfirmed) this._edges.tele = true;

    // ── fixed-tick stepping ──
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= DT) {
      this.acc -= DT;
      const mz = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      const mx = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      const inp = makeInput({
        mx, mz,
        yaw: p.yaw, pitch: p.pitch,
        sprint: sprintRequested(input, mz, p.weaponSprintBlocked, mx),
        crouch: crouchRequested(input),
        jumpJust: this._edges.jump,
        crouchJust: this._edges.crouch,
        teleJust: this._edges.tele,
      });
      this._edges.jump = this._edges.crouch = this._edges.tele = false;
      const before = this.state;
      this.sprinting = isSprinting(before, inp);
      this.prev = before;
      this.state = step(before, inp, this.simWorld);
      this.recoveredThisFrame ||= !!this.state.recovered;
      if (this.state.teleCD > before.teleCD) {
        p.onTeleport?.(
          new THREE.Vector3(before.px, before.py, before.pz),
          new THREE.Vector3(this.state.px, this.state.py, this.state.pz));
      }
    }

    // ── interpolate + write back to the shared Player fields ──
    const a = this.acc / DT, s = this.state, s0 = this.prev;
    p.position.set(
      s0.px + (s.px - s0.px) * a,
      s0.py + (s.py - s0.py) * a,
      s0.pz + (s.pz - s0.pz) * a);
    p.velocity.set(s.vx, s.vy, s.vz);
    p.onGround = !!s.onGround;
    p.isCrouching = !!s.crouch;
    p.isSliding = !!s.slide;
    p.isSprinting = !p.weaponSprintBlocked && !!this.sprinting;
    p._eyeHeight = s.eye;
    p.stamina = s.stamina;
    p.teleportCooldown = s.teleCD;
    this._written.copy(p.position);

    // ── camera (first-person; the bridge path doesn't do TPS orbit) ──
    p.camera.position.set(p.position.x, p.position.y + p._eyeHeight, p.position.z);
    p.camera.rotation.order = 'YXZ';
    p.camera.rotation.y = p.yaw + p.recoilYaw;
    p.camera.rotation.x = p.pitch + p.recoilPitch;
    p.camera.rotation.z = 0;
  }
}
