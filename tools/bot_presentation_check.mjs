import fs from 'node:fs';import assert from 'node:assert/strict';import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {installEvCharacter,buildEvCharacter} from '../src/player/EvCharacter.js';
import {BOT_SKIN} from '../src/player/skins.js';
import {WALK_SPEED,SPRINT_MULT} from '../src/sim/MovementConfig.js';
import {disposeModel} from '../src/core/ModelResources.js';
import {Avatar} from '../src/player/Avatar.js';
import {Bot} from '../src/entities/Bot.js';
import {createDeathReaction} from '../src/sim/DeathReaction.js';
globalThis.ProgressEvent??=class{constructor(type,data){Object.assign(this,data);}};
const bytes=fs.readFileSync(new URL('../public/ev-default.glb',import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''));
const bot=buildEvCharacter(BOT_SKIN),player=buildEvCharacter();
for(const material of bot.userData.bodyMats){
  assert(Math.abs(material.color.r-material.color.g)<1e-6 && Math.abs(material.color.g-material.color.b)<1e-6,'bot body retains colored plates');
  assert(Math.abs(material.emissive.r-material.emissive.b)<1e-6,'bot glow retains color');
}
assert(player.userData.bodyMats.some(m=>Math.abs(m.color.r-m.color.b)>.1),'player default was recolored');
assert.equal(bot.userData.standHeight,player.userData.standHeight,'bot proportions changed');
disposeModel(bot);disposeModel(player);
// Exercise the actual wrappers, including the first frame after respawn.
const scene=new THREE.Scene(), localBot=new Bot({},new THREE.Vector3());
const avatars=[new Avatar(scene),new Avatar(scene,{skin:BOT_SKIN})];
localBot.respawnAt(new THREE.Vector3());
{
 const tip=localBot.mesh.userData.getMuzzleWorldPosition(new THREE.Vector3());
 let origin;
 localBot._shootAt({position:new THREE.Vector3(0,0,-15)},()=>{},
  {raycastCollisionDistance:ray=>{origin=ray.origin.clone();return 0;}});
 assert(origin && origin.distanceTo(tip)<1e-6,'local bot bullet must start at its rendered barrel');
}
for(const avatar of avatars){
  avatar._alive=false;
  for(let frame=0;frame<60;frame++){
    avatar.update(1/60,{position:new THREE.Vector3(),yaw:0,pitch:0,grounded:true,alive:true,speed:0});
    assert(avatar.group.scale.distanceTo(localBot.mesh.scale)<1e-9,'player/bot scale differs during arrival');
    assert.equal(avatar.group.userData.standHeight,localBot.mesh.userData.standHeight);
  }
  avatar.dispose();
}
disposeModel(localBot.mesh);
// Exercise the real avatar wrapper: knockback must not attenuate the knee pose.
for (const hz of [30,60,144]) {
  const avatar=new Avatar(scene), position=new THREE.Vector3();
  for(let i=0;i<hz;i++)avatar.update(1/hz,{position,yaw:0,alive:true,speed:9,grounded:true});
  const calf=avatar.group.userData.bones.Bip001_R_Calf;
  avatar.group.userData.setDeathState(1,1); avatar.group.userData.mixer.update(0);
  const folded=calf.quaternion.clone();
  avatar.group.userData.triggerTeleport();
  avatar._deathSide=-1;
  const reaction=createDeathReaction('levershotgun',{px:0,py:0,pz:0},{x:0,z:3});
  for(let i=0;i<hz;i++)avatar.update(1/hz,{position,yaw:0,alive:false,deathReaction:reaction});
  assert(calf.quaternion.angleTo(folded)<.02,'shotgun knockback reduced the leg death pose');
  assert.equal(avatar.group.position.z,position.z,'dead body drifted from its death location');
  avatar.dispose();
}
let cases=0,worst=0;
for(const rate of [30,60,144])for(const speed of [1.2,4,WALK_SPEED,WALK_SPEED*SPRINT_MULT])for(const [dirF,dirR] of [[1,0],[0,1],[-1,0]]){
  const body=buildEvCharacter(BOT_SKIN),rig=body.userData,rows={L:[],R:[]}, strideTravel=[];
  rig.setLocomotion(speed,true,speed>5,0,dirF,dirR);
  for(let frame=0;frame<rate*12;frame++){
    body.position.x+=dirR*speed/rate;body.position.z-=dirF*speed/rate;
    rig.mixer.update(1/rate);body.updateMatrixWorld(true);
    if(frame<rate*2)continue;
    for(const side of ['L','R'])rows[side].push(rig.bones[`Bip001_${side}_Foot`].getWorldPosition(new THREE.Vector3()));
    if(dirF===1 && speed>=WALK_SPEED)strideTravel.push(rows.L.at(-1).z-body.position.z);
  }
  if(strideTravel.length) {
    const sweep=Math.max(...strideTravel)-Math.min(...strideTravel);
    assert(sweep>.65 && sweep<1.9,`walking gait left its leg reach: ${sweep}m at ${rate}Hz`);
    assert.match(rig.activeAnimation,/Walk/,'sprint selected a different leg animation');
  }
  for(const side of ['L','R']){
    const samples=rows[side],floor=Math.min(...samples.map(p=>p.y));
    // Consecutive ground-contact samples exclude the incoming swing touchdown.
    const slips=samples.slice(1).flatMap((p,i)=>p.y<floor+.03 && samples[i].y<floor+.03
      ? [Math.hypot(p.x-samples[i].x,p.z-samples[i].z)*rate]:[]).sort((a,b)=>a-b);
    assert(slips.length>=5,`${rate}Hz ${speed}m/s ${dirF},${dirR} ${side}: ${slips.length} contact samples`);
    const median=slips[Math.floor(slips.length/2)];worst=Math.max(worst,median);
    // Walking has a longer ground-contact phase than the retired run clip.
    // Bound residual ankle motion relative to travel, including toe-off.
    assert(median<Math.max(.25,speed*.08),`${rate}Hz ${speed}m/s ${dirF},${dirR} ${side}: foot slides ${median}m/s`);
  }
  if(dirF===1 && speed>=WALK_SPEED) {
    const support=rows.L.map((p,i)=>Math.min(p.y,rows.R[i].y));
    assert(Math.max(...support)-Math.min(...support)<.12,'walking/sprinting gained an airborne hopping phase');
  }
  rig.triggerTeleport();body.position.set(10,0,10);rig.setLocomotion(0,true,false);rig.mixer.update(1/rate);
  assert([...Object.values(rig.bones)].every(b=>b.position.toArray().every(Number.isFinite)));
  disposeModel(body);cases++;
}
console.log(`Bot presentation passed: gray default body; ${cases} walk/run/direction cases at 30/60/144Hz, median contact slip <= ${worst.toFixed(4)}m/s.`);

