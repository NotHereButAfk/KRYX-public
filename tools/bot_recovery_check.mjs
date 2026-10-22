import assert from 'node:assert/strict';
import {AuthRoom} from '../server/authroom.mjs';
import {PatrolNavigation} from '../server/patrol-navigation.mjs';
const arena={id:'recovery-proof',half:40,killY:-20,spawns:[[0,0,0]],boxes:[],platforms:[],pickups:[],gravLifts:[],teleporters:[],groundHeightAt:()=>0,raycast:(_x,_y,_z,_dx,_dy,_dz,d)=>d};
const room=new AuthRoom(arena,{targetPopulation:1}),bot=[...room.players.values()][0];
Object.assign(bot.state,{px:0,py:0,pz:0,vx:0,vy:0,vz:0,onGround:1});
bot._botRoamTarget=[0,0,-20];bot._botRoamUntil=1000;bot._botAimYaw=0;bot._botPatrolCheck=0;bot._botLastX=bot._botLastZ=0;
let recoveredAt=null;const recover=room._recoverBotPatrol.bind(room);
room._recoverBotPatrol=p=>{recoveredAt??=room.tick;recover(p);};
// Simulate a capsule trapped by physical collision, without teleport recovery.
for(let tick=0;tick<20 && recoveredAt==null;tick++){
 room.update();Object.assign(bot.state,{px:0,py:0,pz:0,vx:0,vz:0});
}
assert(recoveredAt!=null && recoveredAt<=15,`blocked bot waited ${recoveredAt} ticks`);
assert(Math.hypot(bot._botRoamTarget[0],bot._botRoamTarget[2])>=.75,'escape must actually move away');
assert(new PatrolNavigation({arena}).lane([0,0,0],bot._botRoamTarget),'escape must have verified floor and clearance');
const goal=[15,0,15];bot._botGoal=goal;bot._botRoute=[goal];bot._botRecoveryAt=room.tick;bot._botRouteFailures=1;
room._patrolNavigation=new PatrolNavigation(room);room._patrolNavigation.jobs.set(bot.id,{status:'searching'});
const position=[bot.state.px,bot.state.py,bot.state.pz];recover(bot);
assert.equal(bot._botGoal,null,'second blockage must stop retrying the same destination');
assert(bot._botFailedGoals.get(goal.join(','))>room.tick,'failed goal must be temporarily excluded');
assert.equal(room._patrolNavigation.jobs.has(bot.id),false,'stale route job must be cancelled');
assert.deepEqual([bot.state.px,bot.state.py,bot.state.pz],position,'recovery must not teleport');
bot._botAreaAnchor=[bot.state.px,bot.state.pz];bot._botAreaSince=room.tick-60;
bot._botLastX=bot.state.px-1;bot._botLastZ=bot.state.pz;bot._botPatrolCheck=room.tick;
recoveredAt=null;room.update();assert(recoveredAt!=null,'shuffling in one corner must also trigger recovery');
console.log(`Recovery passed: blockage detected within 0.75s; safe local escape, repeated-goal exclusion, no teleport`);
