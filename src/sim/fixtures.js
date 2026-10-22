// Phase 3 fixture suite — nine sealed movement/collision scenarios plus the
// flat-floor stability case. Each fixture is a tiny analytic world + an input
// tape (segments of {ticks, input}) + invariant checks. Shared by the Node
// runner (tools/movesim_fixtures.mjs) and the browser movement lab.

import { makeInput } from './MoveSim.js';
import { WALK_SPEED, SPRINT_MULT } from './MovementConfig.js';

const flat = { half: 60, killY: -25, platforms: [], boxes: [], gravLifts: [], teleporters: [] };
const box = (x0, y0, z0, x1, y1, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const W = (o) => ({ ...flat, ...o });

// tape helper: expand [{ticks, ...input}] into per-tick inputs
export function expandTape(segments) {
  const tape = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.ticks; i++) {
      // edge flags only fire on the segment's first tick
      const first = i === 0;
      tape.push(makeInput({
        ...seg,
        jumpJust: first && seg.jumpJust,
        crouchJust: first && seg.crouchJust,
        teleJust: first && seg.teleJust,
      }));
    }
  }
  return tape;
}

export const FIXTURES = [
  {
    id: 'flatfloor',
    title: 'Flat floor / support normal — stand dead still',
    world: W({}),
    spawn: [0, 0, 0],
    tape: [{ ticks: 200 }],
    check(states) {
      const settled = states.slice(40);
      const p0 = settled[0];
      for (const s of settled) {
        if (s.px !== p0.px || s.py !== p0.py || s.pz !== p0.pz) {
          return 'position drifted while standing still';
        }
        if (s.nY !== 1 || s.nX !== 0 || s.nZ !== 0) return 'support normal not exactly up on flat floor';
        if (!s.onGround) return 'onGround flickered on flat floor';
      }
      return null;
    },
  },
  {
    id: 'wall',
    title: 'Wall — run straight in, stop at radius, no penetration',
    world: W({ boxes: [box(-6, 0, -14, 6, 3, -10)] }),
    spawn: [0, 0, 0],
    tape: [{ ticks: 120, mz: 1, yaw: 0 }],   // forward is -Z at yaw 0
    check(states) {
      const last = states[states.length - 1];
      // wall front face at z=-10; capsule radius 0.45 → z must stay ≥ -9.55-ε
      if (last.pz < -9.5501) return `penetrated wall (z=${last.pz})`;
      const tail = states.slice(-20);
      for (let i = 1; i < tail.length; i++) {
        if (Math.abs(tail[i].pz - tail[0].pz) > 1e-6) return 'jitter against wall';
      }
      return null;
    },
  },
  {
    id: 'corner',
    title: 'Corner — run diagonally into an interior corner, settle',
    world: W({ boxes: [box(-14, 0, -14, 2, 3, -10), box(2, 0, -14, 6, 3, 2)] }),
    spawn: [-2, 0, -4],
    tape: [{ ticks: 140, mz: 1, mx: 1, yaw: 0 }],
    check(states) {
      const last = states[states.length - 1];
      if (last.pz < -9.5501) return 'penetrated corner wall (z)';
      if (last.px > 1.5501) return 'penetrated corner wall (x)';
      const tail = states.slice(-20);
      for (let i = 1; i < tail.length; i++) {
        if (Math.abs(tail[i].px - tail[0].px) > 1e-6 ||
            Math.abs(tail[i].pz - tail[0].pz) > 1e-6) return 'jitter in corner';
      }
      return null;
    },
  },
  {
    id: 'ramp',
    title: 'Ramp — walk up the slope, grounded throughout, tilted normal',
    // axis z, t=(z-minZ)/len: y0 is the minZ end. Spawn near the low end and
    // walk toward +z (yaw π) so this tape climbs to roughly 3 metres.
    world: W({ platforms: [{ minX: -3, maxX: 3, minZ: -20, maxZ: -4, y0: 0, y1: 4, axis: 'z' }] }),
    spawn: [0, 0, -19],
    tape: [
      { ticks: 6 },
      { ticks: Math.round(10.56 / (WALK_SPEED * 0.05)), mz: 1, yaw: Math.PI },
      { ticks: 20 },
    ],
    check(states) {
      const mid = states.slice(8);
      let sawTilt = false;
      for (const s of mid) {
        if (!s.onGround) return 'lost ground contact on ramp';
        if (s.nY < 1) sawTilt = true;
      }
      if (!sawTilt) return 'ramp never reported a tilted support normal';
      const last = states[states.length - 1];
      if (last.py < 2.6 || last.py > 3.9) return `wrong height after the climb (y=${last.py})`;
      return null;
    },
  },
  {
    id: 'step',
    title: 'Step — 0.3 ledge climbs, 0.9 collider blocks',
    world: W({
      platforms: [{ minX: -4, maxX: 4, minZ: -12, maxZ: -6, y0: 0.3, y1: 0.3, axis: 'z' }],
      boxes: [box(-4, 0, -20, 4, 0.9, -16)],
    }),
    spawn: [0, 0, 0],
    tape: [{ ticks: 200, mz: 1, yaw: 0 }],
    check(states) {
      let climbed = false;
      for (const s of states) if (s.py >= 0.2999 && s.onGround) climbed = true;
      if (!climbed) return 'did not climb the 0.3 step';
      const last = states[states.length - 1];
      if (last.pz < -15.5501) return 'penetrated the 0.9 blocker';
      if (last.py > 0.3001) return 'climbed the 0.9 blocker (should block)';
      return null;
    },
  },
  {
    id: 'ceiling',
    title: 'Ceiling — jump under a low slab, head clamps, no pop-through',
    world: W({ boxes: [box(-4, 2.2, -4, 4, 3.2, 4)] }),
    spawn: [0, 0, 0],
    tape: [
      { ticks: 5 },
      { ticks: 40, jumpJust: true },
      { ticks: 60 },
    ],
    check(states) {
      let peak = 0;
      for (const s of states) peak = Math.max(peak, s.py);
      // slab underside at 2.2, standing height 1.7 → feet may not exceed 0.5
      if (peak > 0.5001) return `head popped through ceiling (peak y=${peak})`;
      const last = states[states.length - 1];
      if (!last.onGround || last.py !== 0) return 'did not land back on the floor';
      return null;
    },
  },
  {
    id: 'crouchtunnel',
    title: 'Crouch tunnel — blocked standing, passable crouched, no stand-up inside',
    world: W({ boxes: [box(-3, 1.25, -16, 3, 4, -8)] }),  // 1.25 headroom gap
    spawn: [0, 0, 0],
    tape: [
      { ticks: 60, mz: 1, yaw: 0 },                        // walk in standing → blocked? no: gap is overhead…
      { ticks: 10 },
      { ticks: 90, mz: 1, yaw: 0, crouch: true },          // crouch through
      { ticks: 30, mz: 1, yaw: 0 },                        // try to stand inside → must stay crouched
      { ticks: 80, mz: 1, yaw: 0, crouch: false },
    ],
    check(states) {
      // while feet are under the slab span, crouch must be held
      for (const s of states) {
        const inside = s.pz < -8.45 && s.pz > -15.55;
        if (inside && !s.crouch && !s.slide) return `stood up inside the tunnel (z=${s.pz})`;
      }
      const last = states[states.length - 1];
      if (last.pz > -15.5) return 'did not pass through the tunnel';
      if (last.crouch) return 'stayed crouched after clearing the tunnel';
      return null;
    },
  },
  {
    id: 'slide',
    title: 'Slide — C while running covers ground, ends clean',
    world: W({}),
    spawn: [0, 0, 0],
    tape: [
      { ticks: 3, crouch: true, crouchJust: true },         // too slow: crouch only
      { ticks: 5 },
      { ticks: 30, mz: 1, sprint: true, yaw: 0 },
      { ticks: 20, mz: 1, sprint: true, yaw: 0, crouchJust: true },
      { ticks: 40 },
    ],
    check(states) {
      if (states.slice(0, 8).some((s) => s.slide)) return 'slide started below its speed threshold';
      let slid = false;
      for (const s of states) if (s.slide) slid = true;
      if (!slid) return 'slide never started';
      const start = states[37], last = states[states.length - 1];
      const dist = Math.abs(last.pz - start.pz);
      if (dist < 4) return `slide covered too little ground (${dist})`;
      if (last.slide) return 'slide never ended';
      if (Math.abs(last.vx) > 1e-6 || Math.abs(last.vz) > 1e-6) return 'residual velocity after slide';
      return null;
    },
  },
  {
    id: 'mobility',
    title: 'Mobility — sprint reaches the configured speed and jump rises above 4 metres',
    world: W({}),
    spawn: [0, 0, 0],
    tape: [
      { ticks: 8 },
      { ticks: 80, mz: 1, sprint: true, yaw: 0, jumpJust: true },
      { ticks: 40 },
    ],
    check(states) {
      let peak = 0;
      let topSpeed = 0;
      for (const s of states) {
        peak = Math.max(peak, s.py);
        topSpeed = Math.max(topSpeed, Math.hypot(s.vx, s.vz));
      }
      if (peak < 4) return `jump peak too low (${peak})`;
      if (Math.abs(topSpeed - WALK_SPEED * SPRINT_MULT) > 1e-6) return `sprint speed too low (${topSpeed})`;
      const last = states[states.length - 1];
      if (!last.onGround || last.py !== 0) return 'did not land after mobility check';
      return null;
    },
  },
  {
    id: 'teleport',
    title: 'Teleport — blink forward lands on support; wall blink stops short',
    world: W({ boxes: [box(-6, 0, -30, 6, 6, -26)] }),
    spawn: [0, 0, 0],
    tape: [
      { ticks: 4 },
      { ticks: 40, teleJust: true, yaw: 0 },               // open floor: full range would hit wall at 26 → stops short
      { ticks: 116 },
    ],
    check(states) {
      const after = states[6];
      if (after.pz > -15) return 'teleport did not move the player';
      const last = states[states.length - 1];
      if (last.pz < -25.5501) return 'teleport ended inside the wall';
      if (!last.onGround || last.py !== 0) return 'did not settle on support after blink';
      return null;
    },
  },
  {
    id: 'recovery',
    title: 'Recovery — fall past the kill plane, restore last safe support',
    world: W({
      // an elevated platform with an open edge; killY catches the fall
      platforms: [{ minX: -4, maxX: 4, minZ: -8, maxZ: 0, y0: 6, y1: 6, axis: 'z' }],
      killY: -10,
      // no base floor for this one: mark it so the runner replaces supportAt's
      // implicit y=0 floor with a void
      noBaseFloor: true,
    }),
    spawn: [0, 6, -4],
    tape: [
      { ticks: 20 },
      { ticks: 60, mz: 1, yaw: 0 },   // walk off the front edge into the void
      { ticks: 120 },
    ],
    check(states) {
      let fell = false, recovered = false;
      for (const s of states) {
        if (s.py < -2) fell = true;
        if (s.recovered) recovered = true;
      }
      if (!fell) return 'never fell off the platform';
      if (!recovered) return 'kill-plane recovery never fired';
      const last = states[states.length - 1];
      if (Math.abs(last.py - 6) > 0.001) return 'did not recover to the safe platform';
      if (!last.onGround) return 'not grounded after recovery';
      return null;
    },
  },
];
