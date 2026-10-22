import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { WALK_SPEED, SPRINT_MULT } from '../src/sim/MovementConfig.js';
import { DT } from '../src/sim/MoveSim.js';
import {
  MAX_CHARACTER_SWEEP_DISTANCE,
  characterSweepSegments,
} from '../src/sim/CharacterSweep.js';

const sprintDistance = WALK_SPEED * SPRINT_MULT * DT;
const sprintSegments = characterSweepSegments(0, sprintDistance);
assert.ok(sprintSegments >= 3, `sprint tick only received ${sprintSegments} stair samples`);
assert.ok(sprintDistance / sprintSegments <= MAX_CHARACTER_SWEEP_DISTANCE + 1e-9,
  'sprint collision samples are farther apart than the stair sweep contract');

// A representative narrow staircase: an unswept 20 Hz sprint crosses three
// 18 cm treads and meets a 60 cm rise at once. The production sweep must see
// each 20 cm riser separately, while the existing 55 cm step limit still
// rejects a real wall.
function climbNarrowStairs(useSweep) {
  const tread = 0.18;
  const riser = 0.20;
  const stepLimit = 0.55;
  let z = 0;
  let y = 0;
  for (let tick = 0; tick < 5; tick++) {
    const dz = -sprintDistance;
    const segments = useSweep ? characterSweepSegments(0, dz) : 1;
    for (let segment = 0; segment < segments; segment++) {
      const candidateZ = z + dz / segments;
      const stair = Math.min(10, Math.floor((-candidateZ + 1e-9) / tread));
      const top = stair * riser;
      if (top - y > stepLimit) return { y, z, blocked: true };
      y = top;
      z = candidateZ;
    }
  }
  return { y, z, blocked: false };
}

assert.equal(climbNarrowStairs(false).blocked, true,
  'control case no longer reproduces the skipped-tread stair blockage');
const swept = climbNarrowStairs(true);
assert.equal(swept.blocked, false, 'swept sprint still blocks on ordinary stairs');
assert.ok(swept.y >= 1.8, `swept sprint did not climb the staircase (y=${swept.y})`);
assert.ok(0.9 > 0.55, 'wall-height guard changed unexpectedly');

const player = readFileSync(new URL('../src/player/Player.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/net/AuthNetBridge.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/rookarena.mjs', import.meta.url), 'utf8');
for (const [name, source] of [['offline player', player], ['client prediction', bridge], ['server authority', server]]) {
  assert.match(source, /characterSweepSegments\(/, `${name} is missing stair substeps`);
}

console.log(`stair movement passed: ${sprintSegments} samples per ${WALK_SPEED * SPRINT_MULT}m/s tick, narrow stairs climb, 0.9m walls remain blocked`);
import {createState, step, makeInput} from '../src/sim/MoveSim.js';
import {IMPORTED_ARENAS} from '../server/rookarena.mjs';
const sideWorld={half:100,killY:-25,platforms:[],boxes:[{min:[0.4,1,-1],max:[1,1.4,1]}],gravLifts:[],teleporters:[]};
const sideJump=step(createState(),makeInput({jumpJust:true}),sideWorld);
assert.ok(sideJump.vy>12 && sideJump.py>0.6,'a raised step beside the capsule was treated as a ceiling');
const ceilingWorld={...sideWorld,boxes:[{min:[-2,2,-2],max:[2,2.3,2]}]};
const ceilingJump=step(createState(),makeInput({jumpJust:true}),ceilingWorld);
assert.equal(ceilingJump.vy,0,'real ceiling did not stop the jump');
assert.ok(ceilingJump.py<=0.301,'jump passed through ceiling');
// Actual imported stair/ramp contacts, tested while travelling into the rise.
const locations=[[10.25,-0.002716,-27.72],[-164.825012,11.749955,49.739998]];
for(let i=0;i<Math.min(IMPORTED_ARENAS.length, locations.length);i++) {
 const arena=IMPORTED_ARENAS[i];const [x,y,z]=locations[i];
 let state=createState(x,y,z),peak=y;
 for(let tick=0;tick<20;tick++){
  state=arena.resolveState(state,step(state,makeInput({mx:1,jumpJust:tick===0}),arena));
  peak=Math.max(peak,state.py);
 }
 assert.ok(peak-y>4,`${arena.id} stair jump truncated to ${peak-y}m`);
}
console.log('Stair jumps retain full height on imported maps; raised sides cannot cancel ascent; low ceilings still block.');
