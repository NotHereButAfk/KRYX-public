import assert from 'node:assert/strict';
import {stepGrenade} from '../src/sim/GrenadePhysics.js';
function surfaces(p,dx,dy,dz,length) {
 const hits=[];
 if(dy<0)hits.push({distance:-p.y/dy,nx:0,ny:1,nz:0});
 if(dx>0)hits.push({distance:(3-p.x)/dx,nx:-1,ny:0,nz:0});
 return hits.filter(h=>h.distance>=0&&h.distance<=length).sort((a,b)=>a.distance-b.distance)[0];
}
const endpoints=[];
for(const fps of [20,30,60,144]) {
 const p={x:0,y:1.5,z:0,vx:10,vy:3,vz:2};let bouncedWall=false,bouncedFloor=false;
 for(let i=0;i<fps*4;i++) {
  const oldY=p.vy;stepGrenade(p,1/fps,surfaces);
  if(p.vx<0)bouncedWall=true;
  if(oldY<0&&p.vy>0)bouncedFloor=true;
  assert(p.y>=0.07&&p.x<=3,'grenade tunneled through floor/wall');
 }
 assert(bouncedWall&&bouncedFloor,'grenade must rebound from both floor and wall');
 assert(Math.hypot(p.vx,p.vy,p.vz)<0.2,'grenade must settle instead of bouncing forever');
 endpoints.push(p);
}
for(const p of endpoints)assert(Math.hypot(p.x-endpoints[0].x,p.z-endpoints[0].z)<0.3,'frame rate changed trajectory too far');
console.log('Grenade physics passed: wall/floor rebounds, no tunneling, settling and 20/30/60/144Hz agreement');
