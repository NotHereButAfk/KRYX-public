import assert from 'node:assert/strict';
import { AuthRoom } from '../server/authroom.mjs';
import { AuthNetBridge } from '../src/net/AuthNetBridge.js';
const events=[];
const room={tick:100,events,_canSimulate:()=>true,_kill:t=>{t.alive=false;}};
const victim={id:2,alive:true,health:20,shield:10,state:{px:3,py:4,pz:5},damageContributors:new Map()};
AuthRoom.prototype._damage.call(room,victim,{id:1},80,true,'shotgun');
assert.equal(events[0].dmg,30,'overkill must not inflate displayed damage');
assert.equal(events[0].killed,true);
assert.deepEqual([events[0].x,events[0].y,events[0].z],[3,5.5,5]);
const calls=[];
const bridge={client:{you:1,drainEvents:()=>[
 ...events,{...events[0],by:3},{...events[0],id:1},
 {e:'kill',by:3,id:2}
]},player:{camera:{}},remotes:new Map(),game:{
 hud:{flashHitmarker:()=>{}},damageNumbers:{spawn:(...args)=>calls.push(args)}
}};
AuthNetBridge.prototype._drainEvents.call(bridge);
assert.equal(calls.length,1,'only own outgoing confirmed hits display numbers');
assert.equal(calls[0][2],30);
assert.deepEqual(calls[0][3],{headshot:true,killed:true});
assert.deepEqual(calls[0][1].toArray(),[3,5.5,5]);
console.log('Damage feedback passed: server damage cap, world position, kill/headshot styling, no self/other hit numbers.');
