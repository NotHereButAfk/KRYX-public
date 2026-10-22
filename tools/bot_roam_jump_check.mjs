import assert from 'node:assert/strict';
import {AuthRoom} from '../server/authroom.mjs';
const arena={id:'jump-proof',half:100,killY:-20,spawns:[[0,0,0]],boxes:[],platforms:[],pickups:[],gravLifts:[],teleporters:[],groundHeightAt:()=>0,raycast:(_x,_y,_z,_dx,_dy,_dz,d)=>d};
const room=new AuthRoom(arena,{targetPopulation:1}),bot=[...room.players.values()][0];
Object.assign(bot.state,{px:0,py:0,pz:0,vx:0,vy:0,vz:0,onGround:1});
assert(room._botRoamJumpSafe(bot,0),'open floor permits a running jump');
arena.groundHeightAt=(_x,z)=>z < -8 ? -20 : 0;
assert(!room._botRoamJumpSafe(bot,0),'reject a void within the flight corridor');
arena.groundHeightAt=()=>0;
room.simWorld.raycast=(_x,_y,_z,_dx,dy,_dz,d)=>dy>0 ? 2 : d;
assert(!room._botRoamJumpSafe(bot,0),'reject low ceilings');
room.simWorld.raycast=(_x,_y,_z,_dx,dy,_dz,d)=>dy===0 ? Math.min(5,d) : d;
assert(!room._botRoamJumpSafe(bot,0),'reject walls before landing');
room.simWorld.raycast=(_x,_y,_z,_dx,_dy,_dz,d)=>d;
bot._botRoamTarget=[0,0,-30];bot._botRoamUntil=1000;bot._botAimYaw=0;bot._botPatrolCheck=1000;bot._botNextRoamJump=0;bot._botNextDashTick=1000;
const input=room._driveBot(bot);
assert(input.inp.jumpJust,'safe roaming bot jumps');assert(!input.botDash,'jump does not stack a dash');assert(bot._botNextRoamJump>=60,'jump cooldown is at least three seconds');
bot.state.onGround=0;bot.state.py=2;const airborne=room._driveBot(bot);
assert.equal(airborne.inp.jumpJust,0);assert.equal(airborne.inp.yaw,0);assert.equal(airborne.inp.mz,1);
console.log('Roaming jumps passed: safe landing, wall/ceiling/void rejection, cooldown, stable airborne heading');

// A nearby baked waypoint is not a reason to drop to a walking gait.
Object.assign(bot.state,{px:0,py:0,pz:0,vx:0,vy:0,vz:0,onGround:1});
bot._botRoamJumpYaw=null;bot._botNextRoamJump=Infinity;bot._botRoamTarget=[0,0,-2];
room.arena.navigation={};
assert.equal(room._driveBot(bot).inp.sprint,1,'sprint through nearby navigation waypoints');
bot._botAimYaw=Math.PI;
assert.equal(room._driveBot(bot).inp.sprint,0,'turn toward the route before sprinting');
console.log('Bot sprint passed: nearby waypoints retain sprint; sharp turns still stop safely');

bot._botAimYaw=0;bot._botRoamTarget=[0,0,-1.15];bot._botRoamUntil=1000;
room.update();
assert(bot._lastSprint,'brief waypoint braking keeps the visible running gait');
console.log('Bot run presentation stays active through brief corner braking');
