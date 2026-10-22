import { BACKWARD_WALK_MULT, WALK_SPEED, SPRINT_MULT, SLIDE_LAUNCH_SPEED, SLIDE_DURATION, SLIDE_RECOVERY, JUMP_SPEED, PLAYER_EYE_HEIGHT } from './MovementConfig.js';
import { canStartSlide, advanceSlide } from './SlideMotion.js';
// ─────────────────────────────────────────────────────────────────────────────
// MoveSim — deterministic fixed-20 Hz movement/collision core (Phase 3).
//
// A pure function of (state, input, world) → state with every number quantized
// to 1e-6 after each tick, so identical input tapes produce bit-identical
// state on every run, machine, and frame schedule. No THREE, no DOM, no
// randomness — runs headless in Node for the fixture suite and in the browser
// for the movement lab + the feature-flagged bridge.
//
// The rules mirror the legacy Player controller (same constants, same
// platform/collider semantics as World.groundHeightAt/resolveCollisions) and
// SEAL the gaps the legacy path leaves open:
//   • flat-floor/support-normal: explicit support solve with snap-down
//     hysteresis — standing still is bit-stable, ramps report a real normal
//   • ceiling: upward motion clamps against collider undersides
//   • crouch tunnel: collision height follows the crouch state, and you
//     cannot stand up under a blocked headroom
//   • recovery: falling past the kill plane restores the last safe support
//
// World interface (plain data — World.js adapts to this, fixtures build it):
//   { half, killY,
//     platforms: [{minX,maxX,minZ,maxZ, y0,y1, axis}],   // walkable tops
//     boxes:     [{min:[x,y,z], max:[x,y,z]}],           // solid colliders
//     gravLifts: [{x,z,r,topY,power}],
//     teleporters: [{x,z,r, dest:{x,z}}] }
// ─────────────────────────────────────────────────────────────────────────────

import { STAMINA_DRAIN, STAMINA_MAX, STAMINA_REGEN, STAMINA_REGEN_DELAY } from './MovementConfig.js';
import { characterSweepSegments } from './CharacterSweep.js';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

// Movement constants — kept identical to the legacy controller.

const GRAVITY = -20;
const RADIUS = 0.45;
const STAND_H = PLAYER_EYE_HEIGHT;
const CROUCH_H = 1.0;
const CROUCH_SPEED = 0.55;
const COYOTE_TIME = 0.14;
const STEP_UP = 0.55, GRACE = 0.06;      // platform support (matches World)
const SNAP_DOWN = 0.12;                  // grounded hysteresis (defect fix)
const TELEPORT_RANGE = 22, TELEPORT_COOLDOWN = 15.0;
const SAFE_TICKS = 3;                    // grounded ticks before a spot is "safe"
const HEADROOM_OFFSETS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];

const Q = 1e6;
const q = (v) => Math.round(v * Q) / Q;

export function createState(x = 0, y = 0, z = 0) {
  return {
    tick: 0,
    px: q(x), py: q(y), pz: q(z),
    vx: 0, vy: 0, vz: 0,
    eye: STAND_H,
    crouch: 0, slide: 0, slideT: 0, slideDx: 0, slideDz: 0, slideCD: 0,
    onGround: 1, nY: 1, nX: 0, nZ: 0,     // support normal (unit, quantized)
    coyote: 0, airJumpUsed: 0, stamina: STAMINA_MAX, stamDelay: 0,
    teleCD: 0, padCD: 0,
    safeX: q(x), safeY: q(y), safeZ: q(z), safeTicks: 0,
    recovered: 0,                          // 1 on the tick a recovery fired
  };
}

// Input for one tick. Edge flags (…Just) are computed by the caller.
export function makeInput(o = {}) {
  return {
    mx: o.mx | 0, mz: o.mz | 0,           // -1/0/1 strafe / forward
    yaw: q(o.yaw ?? 0),
    sprint: o.sprint ? 1 : 0,
    crouch: o.crouch ? 1 : 0,
    jumpJust: o.jumpJust ? 1 : 0,
    crouchJust: o.crouchJust ? 1 : 0,
    teleJust: o.teleJust ? 1 : 0,
    pitch: q(o.pitch ?? 0),               // used only for teleport aim
  };
}

/** Exact authoritative sprint predicate shared by the sim and snapshots. */
export function isSprinting(s, input) {
  const moving = Math.hypot(input.mx, input.mz) > 0;
  return moving && input.sprint === 1 && !input.crouch && input.mz >= 0
    && s.stamina > 2 && !s.slide && !s.crouch;
}

// Highest walkable support under (x,z) — platform semantics identical to
// World.groundHeightAt, plus the base floor at y=0 inside the arena. Returns
// { y, nx, ny, nz } so flat floors report an EXACT up normal and ramps a real
// tilted one (the support-normal part of the Phase 3 defect).
export function supportAt(world, x, z, prevY, newY) {
  // Base floor at y=0 unless the fixture world is a void (noBaseFloor).
  let sy = world.noBaseFloor ? -1e9 : 0, nx = 0, ny = 1, nz = 0;
  for (const p of world.platforms) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    let top, slope = 0;
    if (p.y0 === p.y1) {
      top = p.y0;
    } else {
      const len = p.axis === 'x' ? (p.maxX - p.minX) : (p.maxZ - p.minZ);
      const t = p.axis === 'x' ? (x - p.minX) / len : (z - p.minZ) / len;
      top = p.y0 + (p.y1 - p.y0) * t;
      slope = (p.y1 - p.y0) / len;
    }
    const crossed = prevY >= top - GRACE && newY <= top + GRACE;
    const stepping = newY <= top + STEP_UP && newY >= top - 0.8;
    if ((crossed || stepping) && top > sy) {
      sy = top;
      if (slope === 0) { nx = 0; ny = 1; nz = 0; }
      else {
        const inv = 1 / Math.hypot(1, slope);
        if (p.axis === 'x') { nx = q(-slope * inv); ny = q(inv); nz = 0; }
        else { nx = 0; ny = q(inv); nz = q(-slope * inv); }
      }
    }
  }
  return { y: q(sy), nx, ny, nz };
}

function circleVsBoxes(world, x, z, y, height) {
  // Horizontal circle-vs-AABB pushout, same order & math as the legacy
  // resolver but with a crouch-aware height window.
  let px = x, pz = z;
  for (const b of world.boxes) {
    const cx = Math.max(b.min[0], Math.min(px, b.max[0]));
    const cz = Math.max(b.min[2], Math.min(pz, b.max[2]));
    const dx = px - cx, dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < RADIUS * RADIUS && y < b.max[1] && y + height > b.min[1]) {
      const d = Math.sqrt(d2) || 0.0001;
      const ov = RADIUS - d;
      px += (dx / d) * ov;
      pz += (dz / d) * ov;
    }
  }
  const half = world.half - 1.2;
  px = Math.max(-half, Math.min(half, px));
  pz = Math.max(-half, Math.min(half, pz));
  return [q(px), q(pz)];
}

function headroomBlocked(world, x, y, z) {
  // Is there a collider preventing standing (height STAND_H) at this spot?
  for (const b of world.boxes) {
    const cx = Math.max(b.min[0], Math.min(x, b.max[0]));
    const cz = Math.max(b.min[2], Math.min(z, b.max[2]));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < RADIUS * RADIUS &&
        b.min[1] < y + STAND_H && b.max[1] > y + CROUCH_H) return true;
  }
  // Imported maps expose their shared mesh collision through a scalar ray
  // callback instead of boxes. Probe the part of the capsule that would rise
  // when standing, including its shoulders, on both prediction and authority.
  if (world.raycast) {
    const clearance = STAND_H - CROUCH_H;
    for (const [ox, oz] of HEADROOM_OFFSETS) {
      if (world.raycast(x + ox, y + CROUCH_H + 0.01, z + oz, 0, 1, 0, clearance) < clearance - 0.01) return true;
    }
  }
  return false;
}

function ceilingClamp(world, x, y, z, height, vy, previousY) {
  // Moving up into a collider underside stops vertical motion (legacy gap).
  if (vy <= 0) return [y, vy];
  for (const b of world.boxes) {
    const cx = Math.max(b.min[0], Math.min(x, b.max[0]));
    const cz = Math.max(b.min[2], Math.min(z, b.max[2]));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < RADIUS * RADIUS &&
        previousY + height <= b.min[1] + 0.001 && y + height > b.min[1]) {
      return [q(b.min[1] - height), 0];
    }
  }
  return [y, vy];
}

// AABB slab raycast for the deterministic teleport (replaces the legacy
// THREE.Raycaster-vs-meshes path with pure math over the same boxes).
function rayVsBoxes(world, ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  for (const b of world.boxes) {
    let t0 = 0, t1 = best, hit = true;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < b.min[a] || o[a] > b.max[a]) { hit = false; break; }
      } else {
        let ta = (b.min[a] - o[a]) / d[a];
        let tb = (b.max[a] - o[a]) / d[a];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { hit = false; break; }
      }
    }
    if (hit && t0 > 0.1 && t0 < best) best = t0;
  }
  return best;
}

export function step(s, input, world, tuning = {}) {
  const n = { ...s };
  n.tick = s.tick + 1;
  n.recovered = 0;

  // timers
  n.teleCD = q(Math.max(0, s.teleCD - DT));
  n.padCD = q(Math.max(0, s.padCD - DT));
  n.slideCD = q(Math.max(0, (s.slideCD || 0) - DT));

  // wish direction from yaw (matches legacy forward = -Z at yaw 0 … same math)
  const sinY = Math.sin(input.yaw), cosY = Math.cos(input.yaw);
  let wx = 0, wz = 0;
  const len = Math.hypot(input.mx, input.mz);
  if (len > 0) {
    const mx = input.mx / len, mz = input.mz / len;
    wx = sinY * -mz + Math.sin(input.yaw + Math.PI / 2) * mx;
    wz = cosY * -mz + Math.cos(input.yaw + Math.PI / 2) * mx;
  }
  const sprinting = isSprinting(s, input);

  // stamina
  if (sprinting) {
    n.stamina = q(Math.max(0, s.stamina - STAMINA_DRAIN * DT));
    n.stamDelay = STAMINA_REGEN_DELAY;
  } else if (s.stamDelay > 0) {
    n.stamDelay = q(Math.max(0, s.stamDelay - DT));
  } else {
    n.stamina = q(Math.min(STAMINA_MAX, s.stamina + STAMINA_REGEN * DT));
  }

  // slide / ground / air movement
  const speed = WALK_SPEED * (sprinting ? SPRINT_MULT : (s.crouch ? CROUCH_SPEED : 1)) * (tuning.speedScale ?? 1) * (input.mz < 0 ? BACKWARD_WALK_MULT : 1);
  const horizontalSpeed = Math.hypot(s.vx, s.vz);
  if (n.slide && !s.onGround) {
    n.slide = 0; n.slideT = 0; n.slideCD = SLIDE_RECOVERY;
  }
  if (sprinting && canStartSlide(s.vx, s.vz, s.onGround, s.slide, n.slideCD, input.crouchJust)) {
    n.slide = 1;
    n.slideT = SLIDE_DURATION;
    n.slideDx = q((s.vx / horizontalSpeed) * SLIDE_LAUNCH_SPEED);
    n.slideDz = q((s.vz / horizontalSpeed) * SLIDE_LAUNCH_SPEED);
  }
  if (n.slide) {
    const motion = advanceSlide(n.slideT, n.slideDx, n.slideDz, wx, wz, input.crouch, DT);
    n.slideT = q(motion.time); n.slideDx = q(motion.dx); n.slideDz = q(motion.dz);
    n.vx = q(motion.vx); n.vz = q(motion.vz);
    if (n.slideT <= 0) { n.slide = 0; n.crouch = input.crouch; n.slideCD = SLIDE_RECOVERY; }
  } else if (s.onGround) {
    n.vx = q(wx * speed);
    n.vz = q(wz * speed);
    n.crouch = (input.crouch && !sprinting) ? 1 : 0;
  } else {
    const blend = Math.min(1, DT * 3.5);
    n.vx = q(s.vx + (wx * speed - s.vx) * blend);
    n.vz = q(s.vz + (wz * speed - s.vz) * blend);
    n.crouch = input.crouch ? 1 : 0;
  }

  // crouch tunnel seal: cannot stand while headroom is blocked
  if (!n.slide && !n.crouch && (s.crouch || s.slide) &&
      headroomBlocked(world, s.px, s.py, s.pz)) {
    n.crouch = 1;
  }
  const height = (n.crouch || n.slide) ? CROUCH_H : STAND_H;

  // eye height (cosmetic but deterministic — the bridge reads it)
  const targetEye = (n.slide || n.crouch) ? 0.85 : STAND_H;
  n.eye = q(s.eye + (targetEye - s.eye) * Math.min(1, DT * 16));

  // teleport blink (deterministic ray vs the same collider boxes)
  if (input.teleJust && s.teleCD <= 0) {
    const cp = Math.cos(input.pitch), sp = Math.sin(input.pitch);
    const dx = -sinY * cp, dy = sp, dz = -cosY * cp;
    const eyeY = s.py + STAND_H;
    const hitT = rayVsBoxes(world, s.px, eyeY, s.pz, dx, dy, dz, TELEPORT_RANGE);
    const dist = Math.max(0.1, hitT - (hitT < TELEPORT_RANGE ? 0.9 : 0));
    n.px = q(s.px + dx * dist);
    n.pz = q(s.pz + dz * dist);
    n.py = q(Math.max(0, eyeY + dy * dist - STAND_H));
    n.vx = 0; n.vy = 0; n.vz = 0;
    if (n.slide) n.slideCD = SLIDE_RECOVERY;
    n.slide = 0; n.slideT = 0;
    n.onGround = 0;
    n.teleCD = TELEPORT_COOLDOWN;
  }

  // coyote + jump
  n.coyote = s.onGround ? COYOTE_TIME : q(Math.max(0, s.coyote - DT));
  n.airJumpUsed = s.onGround ? 0 : (s.airJumpUsed || 0);
  const groundJump = s.onGround || n.coyote > 0;
  if (input.jumpJust && (groundJump || !n.airJumpUsed) && !headroomBlocked(world, s.px, s.py, s.pz)) {
    if (!groundJump) n.airJumpUsed = 1;
    n.vy = q(n.crouch ? JUMP_SPEED * 1.1 : JUMP_SPEED);
    n.onGround = 0;
    n.crouch = 0;
    if (n.slide) n.slideCD = SLIDE_RECOVERY;
    n.slide = 0; n.slideT = 0;
    n.coyote = 0;
  }

  // grav lifts
  for (const L of world.gravLifts) {
    const dx = n.px - L.x, dz = n.pz - L.z;
    if (dx * dx + dz * dz < L.r * L.r && n.py < L.topY) {
      n.vy = q(L.power);
      n.onGround = 0;
      n.coyote = 0;
    }
  }

  // Gravity + swept integration. At doubled arena speed a 20 Hz tick can move
  // more than a metre; one endpoint collision test would tunnel through thin
  // walls, skip stair treads, and lose ramp support. Resolve short segments
  // along the exact same deterministic route instead.
  n.vy = q(n.vy + GRAVITY * DT);
  const totalDX = n.vx * DT, totalDZ = n.vz * DT;
  const segments = characterSweepSegments(totalDX, totalDZ);
  const segmentDt = DT / segments;
  let supported = !!s.onGround;
  for (let segment = 0; segment < segments; segment++) {
    const prevY = n.py;
    n.px = q(n.px + totalDX / segments);
    n.pz = q(n.pz + totalDZ / segments);
    n.py = q(n.py + n.vy * segmentDt);

    // Ceiling clamp precedes support so a blocked jump can land in this sweep.
    [n.py, n.vy] = ceilingClamp(world, n.px, n.py, n.pz, height, n.vy, prevY);
    const sup = supportAt(world, n.px, n.pz, prevY, n.py);
    const snap = supported ? (tuning.snapDown ?? SNAP_DOWN) : 0.05;
    if (n.py <= sup.y + snap && n.vy <= 0.001) {
      n.py = sup.y;
      n.vy = 0;
      supported = true;
      n.nX = sup.nx; n.nY = sup.ny; n.nZ = sup.nz;
    } else {
      supported = false;
      n.nX = 0; n.nY = 1; n.nZ = 0;
    }
    [n.px, n.pz] = circleVsBoxes(world, n.px, n.pz, n.py, height);
  }
  n.onGround = supported ? 1 : 0;

  // teleporter pads
  if (n.padCD <= 0) {
    for (const T of world.teleporters) {
      const dx = n.px - T.x, dz = n.pz - T.z;
      if (dx * dx + dz * dz < T.r * T.r) {
        n.px = q(T.dest.x); n.pz = q(T.dest.z); n.py = 0;
        n.vx = 0; n.vy = 0; n.vz = 0;
        n.onGround = 1;
        n.padCD = 1.0;
        break;
      }
    }
  }

  // last-safe tracking + kill-plane recovery
  if (n.onGround) {
    n.safeTicks = Math.min(SAFE_TICKS, s.safeTicks + 1);
    if (n.safeTicks >= SAFE_TICKS) { n.safeX = n.px; n.safeY = n.py; n.safeZ = n.pz; }
  } else {
    n.safeTicks = 0;
  }
  if (n.py < (world.killY ?? -25)) {
    n.px = s.safeX; n.py = s.safeY; n.pz = s.safeZ;
    n.vx = 0; n.vy = 0; n.vz = 0;
    n.onGround = 1;
    n.recovered = 1;
  }

  if (n.onGround) n.airJumpUsed = 0;
  return n;
}

// ── evidence: stable state hash (FNV-1a over the quantized state) ───────────
const HASH_FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'eye', 'crouch',
  'slide', 'slideT', 'onGround', 'nX', 'nY', 'nZ', 'coyote', 'airJumpUsed', 'stamina',
  'teleCD', 'safeX', 'safeY', 'safeZ'];

export function hashState(s) {
  let h = 0x811c9dc5;
  for (const f of HASH_FIELDS) {
    // quantized values fit comfortably in 32 bits at 1e6 precision here
    let v = Math.round(s[f] * Q) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= (v >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Adapt the live game World to the sim's plain-data interface.
export function worldAdapter(world) {
  return {
    half: world.arenaHalf,
    killY: world.killY ?? -25,
    platforms: world.platforms,
    boxes: world.colliders.map(({ box }) => ({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    })),
    gravLifts: world.gravLifts ?? [],
    teleporters: world.teleporters ?? [],
  };
}
