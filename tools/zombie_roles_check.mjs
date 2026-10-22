import assert from 'node:assert/strict';
import { SurvivalRoom } from '../server/survivalroom.mjs';
import { SurvivalNavigation } from '../server/survival-navigation.mjs';
import { AuthClient } from '../src/net/AuthClient.js';
import { ZOMBIE_ROSTER, zombieForWave, zombieStats } from '../src/entities/ZombieRoster.js';
const arena = {id:'zombie-test',name:'Test',half:80,killY:-20,boxes:[],platforms:[],gravLifts:[],teleporters:[],
  spawns:[[0,0,0],[20,0,0],[-20,0,0],[0,0,20]],groundHeightAt:()=>0,raycast:(_x,_y,_z,_dx,_dy,_dz,far)=>far};
assert.equal(new Set(ZOMBIE_ROSTER.map(z=>z.name)).size,20);
for (const type of ['walker','runner','gunner']) {
  const a=zombieStats(1,type),b=zombieStats(10,type),c=zombieStats(30,type);
  for (const key of ['health','damage','speed']) assert(a[key]<b[key]&&b[key]<c[key],`${type} ${key} stopped scaling`);
}
assert(zombieStats(10,'runner').speed>zombieStats(10,'walker').speed*1.8);
assert(Array.from({length:20},(_,i)=>zombieForWave(1,i)).every(z=>z.type==='walker'));
assert(Array.from({length:20},(_,i)=>zombieForWave(2,i)).some(z=>z.type==='runner'));
assert(Array.from({length:20},(_,i)=>zombieForWave(4,i)).some(z=>z.type==='gunner'));
const client=new AuthClient('test');
const room=new SurvivalRoom(arena,{botConfig:{desiredParticipants:1,maximumBots:0}});
room._rotateMatch=()=>false;
const human=room.players.get(room.add(m=>client._recv(JSON.stringify(m)),'Tester'));
room.wave=3;room.nextWaveTick=0;room.update();
const enemies=room.enemies();
assert.equal(new Set(enemies.map(p=>p.enemyType)).size,3);
for (const p of enemies) {
  assert.equal(p.health,p.maxHealth);
  assert.equal(p.shield,0);
  assert.equal(p.wid,p.enemyType==='gunner'?'m4':'sword');
  assert(Number.isInteger(p.zombieVariant));
}
room.update();
const states=client.remoteStates();
assert(states.length && states.every(p=>p.survivalEnemy && Number.isInteger(p.zombieVariant)), 'network lost the zombie identity');
const gunner=enemies.find(p=>p.enemyType==='gunner');
for (const p of enemies) if(p!==gunner) { p.alive=false;p.deadUntil=Infinity; }
Object.assign(gunner.state,{px:0,py:0,pz:0,vx:0,vz:0});
Object.assign(human.state,{px:0,py:0,pz:-10,vx:0,vz:0});
gunner.invulnerableUntil=human.invulnerableUntil=0;human.health=10000;
let shots=0;
for(let i=0;i<160;i++){room.update();shots+=room.events.filter(e=>e.e==='shot'&&e.by===gunner.id).length;}
assert(shots>0,'gunner never fired an authoritative shot');
assert(human.health<10000,'gunner bullets never registered damage');
const health=gunner.health;
room._damage(gunner,gunner,10,false);
for(let i=0;i<160;i++)room.update();
assert(gunner.health<health,'damaged zombie regenerated to full health');
const friendly=room.players.get(room.addBot('Friendly'));
friendly.survivalAlly=true;friendly.invulnerableUntil=0;friendly.health=100;
room._damage(friendly,gunner,20,false);
assert(friendly.health<100,'bot immunity accidentally disabled zombie attacks on allies');

// A long wall requires temporarily moving AWAY from the destination.
const wallArena={...arena,raycast(x,y,z,dx,dy,dz,far){
  let lo=0,hi=far;
  for(const [origin,dir,min,max] of [[x,dx,-1,1],[z,dz,-6,6]]){
    if(Math.abs(dir)<1e-8){if(origin<min||origin>max)return far;continue;}
    const a=(min-origin)/dir,b=(max-origin)/dir;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
  }
  return lo<=hi?lo:far;
}};
const nav=new SurvivalNavigation({arena:wallArena},{navigationBudgetMs:Infinity,navigationCell:2,pathNodeBudget:160});
assert.equal(nav.lane([0,0,0],[0,8,0])[1],0,'stacked floors became a vertical shortcut');
const start=[-8,0,0],goal=[8,0,0],path=nav.path(start,goal);
assert(path.length>2,'wall detour was not generated');
assert(Math.hypot(path.at(-1)[0]-8,path.at(-1)[2])<1,'path budget ran out at the same wall');
let last=start;for(const point of path){assert(nav.lane(last,point),'route cuts through a wall');last=point;}
console.log(`Zombie roles passed: 20 identities, three wave-scaled types, network identity, ${shots} real gunner shots, PvE damage and complete wall detour.`);
