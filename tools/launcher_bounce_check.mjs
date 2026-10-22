import assert from 'node:assert/strict';
import { AuthRoom } from '../server/authroom.mjs';
import { stepGrenade, grenadeHasSettled, launcherShouldExplode, LAUNCHER_GRENADE_RADIUS } from '../src/sim/GrenadePhysics.js';
const floor = (p,dx,dy,dz,length) => {
  const distance = dy < 0 ? -p.y/dy : Infinity;
  return distance >= 0 && distance <= length ? {distance,nx:0,ny:1,nz:0} : null;
};
for (const fps of [20,30,60,144]) for (const vx of [0,35]) {
  const p={x:0,y:1.8,z:0,vx,vy:3,vz:0};
  let bounced=false, time=0;
  while(time<12 && !grenadeHasSettled(p)) {
    const vy=p.vy; stepGrenade(p,1/fps,floor);time+=1/fps;
    if(vy<0 && p.vy>0)bounced=true;
    if(p.y>.2)assert(!grenadeHasSettled(p),'airborne grenade falsely settled');
  }
  assert(bounced && grenadeHasSettled(p),`grenade never settled at ${fps}Hz`);
  assert(time>1,'grenade detonated on first impact');
}
for(const fps of [20,30,60,144]) {
  const p={x:0,y:1.8,z:0,vx:35,vy:3,vz:0};
  let time=0, rebound=0;
  while(!launcherShouldExplode(p) && time<6) {
    stepGrenade(p,1/fps,floor,true);time+=1/fps;
    if(p.impactTime != null)rebound=Math.max(rebound,p.vy);
  }
  assert(rebound>0 && rebound<3,'launcher rebound is too strong');
  assert(time<3,'launcher kept bouncing/rolling too long');
  const flying={x:0,y:1000,z:0,vx:0,vy:0,vz:0};
  for(let i=0;i<fps*5+1;i++)stepGrenade(flying,1/fps,()=>null,true);
  assert(launcherShouldExplode(flying),'lost launcher round never reached backup fuse');
  const resting={x:0,y:LAUNCHER_GRENADE_RADIUS+.001,z:0,vx:0,vy:0,vz:0};
  for(let i=0;i<fps/2;i++)stepGrenade(resting,1/fps,floor,true);
  assert(grenadeHasSettled(resting),'floor separation reset resting timer');
}
const arena={id:'bounce-proof',half:100,platforms:[],boxes:[],spawns:[[0,0,0]],pickups:[],gravLifts:[],teleporters:[]};
const room=new AuthRoom(arena);
const shooter=room.players.get(room.add(()=>{},'Shooter'));
shooter.wid='concussion';shooter.invulnerableUntil=0;
room._resolveRocket(shooter,room.weaponDefinition('concussion'),0,-Math.PI/2);
assert.equal(room.projectiles[0].kind,'launcherGrenade');
let bounced=false;
for(let t=0;t<300 && room.projectiles.length;t++){
  room.tick++;room._updateProjectiles();
  if(room.projectiles[0]?.vy>0)bounced=true;
}
assert(bounced,'authority did not rebound grenade');
assert.equal(room.projectiles.length,0,'authority grenade never detonated');
assert.equal(room.events.filter(e=>e.e==='explosion').length,1,'must explode exactly once');
assert(shooter.health<100 || !shooter.alive,'settled grenade did not damage its shooter');
console.log('Launcher bounce passed: floor rebound, airborne safety, settled detonation, self damage, 20/30/60/144Hz.');
