import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PlayerSpectatorRig} from '../src/core/PlayerSpectatorRig.js';
const clear=(_ray,distance)=>distance;
const results=[];
for(const fps of [30,60,144]) {
 const camera=new THREE.PerspectiveCamera();const rig=new PlayerSpectatorRig(camera);
 let maxAngle=0;const previous=new THREE.Quaternion();
 rig.update({x:0,y:0,z:0,yaw:0},1/fps,true,clear);
 const forward=new THREE.Vector3();camera.getWorldDirection(forward);
 assert(forward.dot(rig.focus.clone().sub(camera.position).normalize())>0.999,'camera must face the followed player');
 for(let i=0;i<fps*3;i++) {
  previous.copy(camera.quaternion);
  const t=i/fps;
  rig.update({x:t*3,y:Math.sin(t*30)*0.06,z:0,yaw:Math.sin(t*30)*0.3},1/fps,false,clear);
  maxAngle=Math.max(maxAngle,previous.angleTo(camera.quaternion)*fps);
 }
 assert(maxAngle<1,'twitch aiming/stair jitter must not whip the follow camera');
 assert(camera.position.distanceTo(rig.focus)<6,'runner escaped follow distance');
 assert(Number.isFinite(camera.position.x));results.push(camera.position.clone());
 // A wall must pull the camera inward immediately, then recover gently.
 rig.update({x:9,y:0,z:0,yaw:0},1/fps,false,(_ray,d)=>Math.min(d,1.2));
 assert(camera.position.distanceTo(rig.focus)<=1.2);
 rig.update({x:9,y:0,z:0,yaw:0},1/fps,false,clear);
 assert(camera.position.distanceTo(rig.focus)<1.5,'wall clearance recovery snapped outward');
 rig.update({x:100,y:2,z:100,yaw:Math.PI},1/fps,true,clear);
 assert(camera.position.distanceTo(new THREE.Vector3(100,3.3,100))<5,'target switch left camera at old player');
}
for(const position of results)assert(position.distanceTo(results[1])<0.15,'follow motion depends on frame rate');
console.log('Player spectate passed: jitter suppression, stable framing, wall clearance, target switch, 30/60/144Hz agreement');
