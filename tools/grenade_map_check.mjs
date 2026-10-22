import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { World } from '../src/world/World.js';
import { IMPORTED_ARENAS } from '../server/rookarena.mjs';
import { AuthRoom } from '../server/authroom.mjs';
import { stepGrenade, launcherShouldExplode, LAUNCHER_GRENADE_RADIUS } from '../src/sim/GrenadePhysics.js';
import { GrenadeSystem } from '../src/weapons/GrenadeSystem.js';
import { WeaponSystem } from '../src/weapons/WeaponSystem.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';

const radius = LAUNCHER_GRENADE_RADIUS;
const ray = new THREE.Ray();
const world = Object.create(World.prototype);
world._raycastBoxes = [];
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100,100));
floor.rotation.x = -Math.PI/2;
floor.position.y = 8;
floor.updateMatrixWorld(true);
world._mapOctree = new Octree().fromGraphNode(floor);
const clientRay = (p,dx,dy,dz,length) => {
  ray.origin.set(p.x,p.y,p.z); ray.direction.set(dx,dy,dz);
  const hit = world.raycastCollisionHit(ray,length);
  return hit && {distance:hit.distance,nx:hit.normal.x,ny:hit.normal.y,nz:hit.normal.z};
};

let trajectories = 0;
function checkFloor(label, x, y, z, cast) {
  for (const fps of [20,60,144]) for (const [height,vy] of [[radius+.001,0],[1.8,-35],[1.8,3]]) {
    const p={x,y:y+height,z,vx:0,vy,vz:0};
    let time=0;
    while(time<6 && !launcherShouldExplode(p)) {
      stepGrenade(p,1/fps,cast,true); time+=1/fps;
      // A sloped surface can deflect a vertical shot downhill. Compare against
      // the floor at its current X/Z, not the height where it was fired.
      const floor=cast({x:p.x,y:y+2,z:p.z},0,-1,0,5);
      assert(floor,`${label}: grenade left the floor fixture`);
      const gap=p.y-(y+2-floor.distance);
      assert(gap>=radius-.003,`${label}: grenade crossed floor at ${fps} Hz: ${gap}`);
    }
    assert(launcherShouldExplode(p) && p.impactTime!=null,`${label}: missing impact/detonation`);
    assert(time<3.5,`${label}: never settled after bouncing`);
    trajectories++;
  }
}
checkFloor('client elevated, zero-thickness floor',0,8,0,clientRay);
// A projectile can contact a wall within less than a centimetre too.
const wall = new THREE.Mesh(new THREE.PlaneGeometry(100,100));
wall.position.set(0,0,-2); wall.updateMatrixWorld(true);
world._mapOctree = new Octree().fromGraphNode(wall);
const againstWall={x:0,y:2,z:-2+radius+.001,vx:0,vy:0,vz:-1};
stepGrenade(againstWall,1/60,clientRay,true);
assert(againstWall.vz>0 && againstWall.z>=-2+radius,'near-wall rebound missed');

for (const arena of IMPORTED_ARENAS) {
  const cast=(p,dx,dy,dz,length)=>arena.raycastHit(p.x,p.y,p.z,dx,dy,dz,length);
  const samples=[...arena.spawns,...arena.pickups.map(p=>[p.x,p.y,p.z])];
  let floors=0;
  for(const [x,y,z] of samples) {
    const hit=arena.raycastHit(x,y+.3,z,0,-1,0,5);
    if(!hit || hit.ny<.99)continue;
    checkFloor(`${arena.id} (${x},${z})`,x,y+.3-hit.distance,z,cast);
    floors++;
  }
  assert(floors>=4,`${arena.id}: not enough real map floor coverage`);
  // Exercise the authoritative room, including one-and-only-one detonation.
  const room=new AuthRoom(arena);
  const shooter=room.players.get(room.add(()=>{},'Grenade regression'));
  shooter.wid='concussion'; shooter.invulnerableUntil=0;
  room._resolveRocket(shooter,room.weaponDefinition('concussion'),0,-Math.PI/2);
  for(let i=0;i<360 && room.projectiles.length;i++){room.tick++;room._updateProjectiles();}
  assert.equal(room.projectiles.length,0,`${arena.id}: projectile remained alive`);
  assert.equal(room.events.filter(e=>e.e==='explosion').length,1,`${arena.id}: incorrect explosion count`);
  console.log(`${arena.name}: ${floors} floor locations and authoritative detonation passed`);
}

// Local shots and server snapshots must draw the same grenade, not a mini rocket.
const local={scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),rockets:[],
  models:new Map([['concussion',{muzzle:new THREE.Object3D()}]])};
WeaponSystem.prototype._spawnRocket.call(local,getWeapon('concussion'));
const net=new GrenadeSystem(new THREE.Scene());
net.syncProjectiles([{id:'blue',kind:'launcherGrenade',wid:'concussion',x:0,y:0,z:0,vx:0,vy:0,vz:-35}]);
const held=local.rockets[0].mesh, remote=net.projectileMeshes.get('blue');
assert.deepEqual(held.children.map(m=>m.name),remote.children.map(m=>m.name));
for(const mesh of [held,remote]) {
  const body=mesh.getObjectByName('Blue segmented body');
  assert(body && body.material.color.b>body.material.color.r*3,'launcher grenade is not blue');
  mesh.quaternion.identity(); mesh.updateMatrixWorld(true);
  const size=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  assert(size.x>=.23 && size.y>=.28,'launcher grenade is still too small');
  mesh.traverse(part=>{
    if(!part.isMesh)return;
    const v=new THREE.Vector3(),vertices=part.geometry.attributes.position;
    for(let i=0;i<vertices.count;i++) {
      v.fromBufferAttribute(vertices,i).applyMatrix4(part.matrixWorld);
      assert(v.length()<=radius+.0001,`${part.name} extends through collision hull`);
    }
  });
}
net.reset();
console.log(`Grenade map checks passed: ${trajectories} trajectories, close-contact walls, blue local/network models.`);

// Replicated launcher visuals originate at the visible gun, without changing
// server positions or reattaching already-flying projectiles to the muzzle.
for (const wid of ['rpg','concussion','plasmarifle']) {
  const p={id:'muzzle-'+wid,kind:wid==='concussion'?'launcherGrenade':'rocket',wid,by:'self',x:0,y:2,z:-8,vx:0,vy:0,vz:-35};
  const muzzle=new THREE.Vector3(.4,1.6,-1);
  net.syncProjectiles([p],1/60,()=>muzzle);
  const mesh=net.projectileMeshes.get(p.id);
  assert(mesh.position.distanceTo(muzzle)<1e-8,'replicated projectile does not start at muzzle');
  const before=mesh.position.clone();
  net.syncProjectiles([p],1/60,()=>new THREE.Vector3(100,100,100));
  assert(mesh.position.distanceTo(new THREE.Vector3(p.x,p.y,p.z))<before.distanceTo(new THREE.Vector3(p.x,p.y,p.z)), 'projectile fails to join authoritative trajectory');
  assert(p.x===0 && p.y===2 && p.z===-8,'visual correction changed authoritative position');
}
net.syncProjectiles([]);
console.log('Replicated launcher shots leave the muzzle and join unchanged server trajectories.');
