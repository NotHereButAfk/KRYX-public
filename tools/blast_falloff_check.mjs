import assert from 'node:assert/strict';
import { blastDamage } from '../src/sim/BlastDamage.js';
import { getWeapon } from '../src/weapons/weaponDefs.js';
import { AuthRoom } from '../server/authroom.mjs';
const open = () => Infinity;
for (const id of ['rpg', 'concussion']) {
  const w = getWeapon(id);
  const hit = distance => blastDamage({x:0,y:.85,z:0},
    {px:distance+.42,py:0,pz:0}, w.splashRadius,w.damage,w.splashMin,open);
  assert(hit(0) >= 100, `${id}: point-blank blast kills a normal full-health target`);
  assert(hit(w.splashRadius*.15) >= 100, `${id}: close blast is lethal`);
  assert(hit(w.splashRadius*.5) < 100, `${id}: midrange blast is survivable`);
  let previous=Infinity;
  for(let step=0;step<=100;step++) {
    const amount=hit(w.splashRadius*step/100);
    assert(amount<=previous+1e-9); previous=amount;
  }
  assert.equal(hit(w.splashRadius+.01),0);
  assert.equal(blastDamage({x:0,y:.85,z:0},{px:2,py:0,pz:0},
    w.splashRadius,w.damage,w.splashMin,()=>0),0,'solid cover blocks blast');
}
const arena={id:'blast-test',half:100,boxes:[],platforms:[],spawns:[[0,0,0]],pickups:[],gravLifts:[],teleporters:[]};
let lastHealth=-1;
for (const distance of [0, 1, 5, 8, 10]) {
  const room=new AuthRoom(arena);
  const player=room.players.get(room.add(()=>{},'Blast test',false));
  Object.assign(player.state,{px:distance,py:0,pz:0});
  player.invulnerableUntil=0;
  room._explodeFrag({by:player.id,x:0,y:.85,z:0,kind:'frag'});
  assert(player.health>=lastHealth,'grenade damage must decrease with distance');
  lastHealth=player.health;
  if(distance<=1) assert.equal(player.alive,false,'close frag kills');
  if(distance===5) assert(player.alive && player.health<100,'outer frag wounds');
  if(distance===10) assert.equal(player.health,100,'outside blast stays unharmed');
}
console.log('Blast falloff passed: lethal close range, decreasing damage, survivable outer blast, cover and radius limits, authoritative frag detonation');
