import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PatrolNavigation, choosePatrolGoal } from '../server/patrol-navigation.mjs';
import { chooseReachableRoamPoint } from '../src/entities/BotCombat.js';
import { AuthRoom } from '../server/authroom.mjs';
import { getServerArena } from '../server/rookarena.mjs';
import { MAP_CATALOG } from '../src/world/MapRegistry.js';
// Keep regression scenarios and bot IDs stable when the live rotation changes.
const IMPORTED_ARENAS = MAP_CATALOG.map(map => getServerArena(map.id));
import { quantizeBotMove } from '../src/entities/BotCombat.js';
import { makeInput } from '../src/sim/MoveSim.js';
import { STAMINA_MAX, WALK_SPEED } from '../src/sim/MovementConfig.js';
const winter = getServerArena('winter-graveyard');
const landingProbe = { state: { px: -48.59, py: 27.054, pz: 45.964 } };
assert(AuthRoom.prototype._botGroundSafe.call({ arena: winter }, landingProbe, 0, 1, Math.atan2(-3.295, -2.234)),
  'solid landing below the Winter-Graveyard platform was mistaken for void');
assert(!AuthRoom.prototype._botGroundSafe.call({ arena: winter },
  { state: { px: winter.half + 20, py: 27, pz: winter.half + 20 } }, 0, 1, 0),
  'patrol accepted an actual void edge');
// A map-specific safe drop must not allow bots to walk into the void.
{
  const arena={half:100,killY:-20,botMaxDrop:4,groundHeightAt:()=>-3,raycast:(_x,_y,_z,_dx,_dy,_dz,d)=>d};
  const bot={state:{px:0,py:0,pz:0}};
  assert(AuthRoom.prototype._botGroundSafe.call({arena},bot,0,1,0));
  assert(new PatrolNavigation({arena}).lane([0,0,0],[0,-3,-2]));
  arena.groundHeightAt=()=>-Infinity;
  assert(!AuthRoom.prototype._botGroundSafe.call({arena},bot,0,1,0));
  assert.equal(new PatrolNavigation({arena}).lane([0,0,0],[0,-3,-2]),null);
}
for (let angle = 0; angle < Math.PI * 2; angle += .04) {
  const [mx, mz] = quantizeBotMove(Math.cos(angle) * .7, Math.sin(angle) * .7);
  const actual = makeInput({ mx, mz });
  assert(actual.mx || actual.mz, 'avoidance was truncated to idle');
}
// A route must finish a detour that initially leads away from the goal.
{
  const wall = new THREE.Box3(new THREE.Vector3(4,-1,-26),new THREE.Vector3(6,5,26));
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  const arena = {half:40,killY:-10,groundHeightAt:()=>0,
    raycast(x,y,z,dx,dy,dz,far) {
      ray.origin.set(x,y,z);ray.direction.set(dx,dy,dz);
      return ray.intersectBox(wall,hit) ? Math.min(far,hit.distanceTo(ray.origin)) : far;
    }};
  const nav = new PatrolNavigation({arena});
  nav.request(1,[0,0,0],[12,0,0]);
  let result, ticks=0;
  const lane=nav.lane.bind(nav);let calls=0;
  nav.lane=(...args)=>{calls++;return lane(...args);};
  for(;ticks<1000 && !result;ticks++) {
    calls=0;nav.update(ticks);const count=calls;nav.update(ticks);
    assert.equal(calls,count,'multiple bots cannot multiply the room search budget');
    assert(count<=112,'routing collision work must remain bounded per tick');
    result=nav.take(1);
  }
  assert(ticks>1,'long route should resume across server ticks');
  assert.equal(result?.status,'ready','search abandoned a reachable destination behind a wall');
  assert.deepEqual(result.route.at(-1),[12,0,0]);
  assert(result.route.some(p=>Math.abs(p[2])>26),'route cut through the wall');
  let previous=[0,0,0];
  for(const p of result.route){assert(lane(previous,p),'route segment does not fit capsule');previous=p;}
  const room={arena,_patrolNavigation:nav};
  AuthRoom.prototype._setSimArena.call(room,{...arena,id:'next-map'});
  assert.equal(room._patrolNavigation,null,'map rotation must discard cached collision/routes');
}
{
  // Same crossing/step acceptance as the imported arena, including step-up.
  const groundHeightAt=(x,z,previous,next)=>{
    const top=Math.max(0,Math.floor(x/.6)*.2);
    return top<=Math.max(previous,next)+.61 && ((previous>=top-.06 && next<=top+.06)
      || (next<=top+.55 && next>=top-.8)) ? top : -Infinity;
  };
  const arena={half:40,killY:-10,groundHeightAt,raycast:(x,y,z,dx,dy,dz,far)=>far};
  const nav=new PatrolNavigation({arena});
  assert(nav.lane([0,0,0],[8,2.6,0]),'uphill stairs were mistaken for a blocked route');
  assert(AuthRoom.prototype._botGroundSafe.call({arena},{state:{px:0,py:0,pz:0}},0,1,-Math.PI/2),
    'bot refuses to actually step onto its planned stairs');
  const local=chooseReachableRoamPoint({...arena,x:0,y:0,z:0,random:()=>0,minDistance:8,maxDistance:8});
  assert(local && local[1]>2,'local patrol fallback must also climb stairs');
}
console.log('Patrol routing: bounded persistent detours, uphill stairs, capsule clearance and map-cache reset passed');
// Measure map-scale coverage and completed destinations, independently of
// whether a corridor runs along X or Z.
for (const arena of IMPORTED_ARENAS) {
  const room = new AuthRoom(arena, { targetPopulation: 8 });
  // Isolate patrol coverage; bot-versus-bot combat is tested separately.
  room.opponents = () => false;
  const xs=arena.navigation.points.map(p=>p[0]), zs=arena.navigation.points.map(p=>p[2]);
  const coverageSpan=Math.min(150,Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))*.6);
  // Preserve the old sprint-only travel opportunity at exhausted walking speed.
  // Keep coverage thresholds unchanged while allowing stamina recovery.
  const ticks = Math.ceil(2400 * Math.max(1, 14 / WALK_SPEED));
  room._rotateMatch = () => false;
  const records = new Map([...room.players].map(([id, p]) => [id,
    { moving: 0, forward: 0, patrolMoves: 0, travel: 0, last: [p.state.px, p.state.pz], cells: new Set(), zones: new Set(), minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }]));
  const timing = [];
  for (let tick = 0; tick < ticks; tick++) {
    const start = performance.now(); room.update(); timing.push(performance.now()-start);
    for (const [id, p] of room.players) {
      assert.ok(p.state.stamina >= 0 && p.state.stamina <= STAMINA_MAX, 'FFA stamina must stay within player limits');
      assert.equal(p.kills, 0, 'isolated patrol fixture must not enter combat');
      const r = records.get(id), distance = Math.hypot(p.state.px - r.last[0], p.state.pz - r.last[1]);
      if (p._botState === 'roam' && distance > .1 && distance < 2 && p.state.onGround) {
        const headingDot = ((p.state.px - r.last[0]) * -Math.sin(p._lastYaw)
          + (p.state.pz - r.last[1]) * -Math.cos(p._lastYaw)) / distance;
        r.patrolMoves++;
        if (headingDot > .65) r.forward++;
      }
      if (distance < 2) { r.travel += distance; if (distance > .05) r.moving++; }
      r.last = [p.state.px, p.state.pz];
      r.minX = Math.min(r.minX,p.state.px); r.maxX = Math.max(r.maxX,p.state.px);
      r.minZ = Math.min(r.minZ,p.state.pz); r.maxZ = Math.max(r.maxZ,p.state.pz);
      r.zones.add(`${Math.floor(p.state.px / 20)},${Math.floor(p.state.pz / 20)}`);
      r.cells.add(`${Math.floor(p.state.px / 5)},${Math.floor(p.state.pz / 5)}`);
    }
  }
  for (const [id, r] of records) {
    assert(r.forward / r.patrolMoves > .9, `${arena.id} bot ${id} routinely moved sideways (${r.forward}/${r.patrolMoves})`);
    assert(r.moving > ticks * .75, `${arena.id} bot ${id} mostly stationary (${r.moving}/${ticks} ticks)`);
    const spanX = r.maxX-r.minX, spanZ = r.maxZ-r.minZ;
    const broadCoverage = r.zones.size >= 16 && Math.hypot(spanX,spanZ) > coverageSpan;
    assert(room.players.get(id)._botLandmarkVisits.size >= 3,
      arena.id+' bot '+id+' runs without completing distinct navigation goals');
    assert(broadCoverage,
      `${arena.id} bot ${id} remains in one map district (${r.zones.size} zones, X ${r.maxX-r.minX}, Z ${r.maxZ-r.minZ})`);
    assert(r.travel > 300 && r.cells.size >= 80, `${arena.id} bot ${id} never patrols beyond one area`);
  }
  timing.sort((a,b)=>a-b);
  console.log(`${arena.id}: tick median ${timing[Math.floor(ticks * .5)].toFixed(2)}ms, p95 ${timing[Math.floor(ticks * .95)].toFixed(2)}ms; minimum zones ${Math.min(...[...records.values()].map(r=>r.zones.size))}`);
  console.log(`${arena.id}: all eight bots patrol; minimum active movement ${Math.round(Math.min(...[...records.values()].map(r => r.moving)) / ticks * 100)}%`);
}

{
  const goals = [[40,0,0],[-40,0,0],[0,0,40],[0,0,-40]];
  const bots = new Map(Array.from({length:4},(_,i)=>[i,{id:i,isBot:true,alive:true,state:{px:0,pz:0},_botLandmarkVisits:new Map()}]));
  for(const bot of bots.values()) bot._botGoal=choosePatrolGoal(bot,bots,goals,0,()=>.5);
  assert.equal(new Set([...bots.values()].map(b=>b._botGoal.join(','))).size,4,'bots starting together must independently spread to different patrol destinations');
  const first=bots.get(0);first._botLandmarkVisits.set(first._botGoal.join(','),4);
  assert.notDeepEqual(choosePatrolGoal(first,new Map([[0,first]]),goals,1,()=>.5),first._botGoal,'individual visit memory must discourage circling the same area');
}
