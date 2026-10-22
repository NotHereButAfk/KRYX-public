import fs from 'node:fs';
import {WALK_SPEED,SPRINT_MULT} from '../src/sim/MovementConfig.js';
import {AuthRoom} from '../server/authroom.mjs';
import {IMPORTED_ARENAS} from '../server/rookarena.mjs';
const label=process.argv[2]||'latest';const seconds=Number(process.argv[3]||180);const only=process.argv[4];
const results=[];
for(const arena of IMPORTED_ARENAS.filter(a=>!only||a.id===only)){
 const room=new AuthRoom(arena,{targetPopulation:8});room._rotateMatch=()=>false;
 const records=new Map([...room.players].map(([id,p])=>[id,{id,trail:[],runAnimationTicks:0,sprintTicks:0,roamJumps:0,jumps:0,wasGrounded:false,moving:0,idleRun:0,maxIdle:0,travel:0,last:[p.state.px,p.state.py,p.state.pz],goalsReached:0,goals:new Set(),zones:new Set(),reversals:0,lastDir:null}]));const timings=[];
 const drive=room._driveBot.bind(room);room._driveBot=p=>{const cmd=drive(p);if(cmd.inp.jumpJust && p._botRoamJumpYaw!==null)records.get(p.id).roamJumps++;return cmd;};
 for(let t=0;t<seconds*20;t++){
 const start=performance.now();room.update();timings.push(performance.now()-start);
 for(const[id,p]of room.players){const r=records.get(id),s=p.state;if(r.wasGrounded && !s.onGround && s.vy>0)r.jumps++;r.wasGrounded=!!s.onGround;const d=Math.hypot(s.px-r.last[0],s.pz-r.last[2]);r.last=[s.px,s.py,s.pz];if(d<2)r.travel+=d;
 if(d>.05){if(p._lastSprint)r.runAnimationTicks++;if(Math.hypot(s.vx,s.vz)>=WALK_SPEED*SPRINT_MULT*.95)r.sprintTicks++;r.moving++;r.idleRun=0;}else r.maxIdle=Math.max(r.maxIdle,++r.idleRun);
 if(process.env.NAV_DIAGNOSTICS && r.idleRun===60)console.log('IDLE',arena.id,p.id,JSON.stringify({pos:r.last,goal:p._botGoal,route:p._botRoute.slice(0,5),roam:p._botRoamTarget,job:room._patrolNavigation?.jobs.get(p.id)?.status,nearest:room._patrolNavigation?.nearest?.(r.last)}));
 r.goalsReached=[...p._botLandmarkVisits.values()].reduce((a,b)=>a+b,0);for(const key of p._botLandmarkVisits.keys())r.goals.add(key);
 r.zones.add(`${Math.floor(s.px/20)},${Math.floor(s.pz/20)}`);
 if(t%20===0){const prev=r.trail.at(-1);r.trail.push([s.px,s.py,s.pz]);if(prev){const dx=s.px-prev[0],dz=s.pz-prev[2],n=Math.hypot(dx,dz);if(n>1){const dir=[dx/n,dz/n];if(r.lastDir&&dir[0]*r.lastDir[0]+dir[1]*r.lastDir[1]<-.5)r.reversals++;r.lastDir=dir;}}}
 }}
 timings.sort((a,b)=>a-b);const bots=[...records.values()].map(r=>({id:r.id,runAnimationPercent:Math.round(r.runAnimationTicks/Math.max(1,r.moving)*100),sprintPercent:Math.round(r.sprintTicks/Math.max(1,r.moving)*100),jumps:r.jumps,roamJumps:r.roamJumps,moving:Math.round(r.moving/(seconds*20)*100),maxIdleSeconds:r.maxIdle/20,travel:Math.round(r.travel),goalsReached:r.goalsReached,uniqueGoals:r.goals.size,zones:r.zones.size,reversals:r.reversals,trail:r.trail}));
 const result={map:arena.id,seconds,p95ms:timings[Math.floor(timings.length*.95)],bots};results.push(result);console.log(JSON.stringify({...result,bots:bots.map(({trail,...r})=>r)}));
 fs.writeFileSync(`artifacts/bot-navigation-${label}.json`,JSON.stringify(results,null,2));
}
