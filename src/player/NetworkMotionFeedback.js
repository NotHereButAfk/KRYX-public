import {strafeTilt} from './StrafeTilt.js';
// Multiplayer bypasses Player.update: advance presentation from rendered travel.
export function networkMotionFeedback(p,dt,active=true){
 const previous=p._networkMotionPosition;
 p._networkMotionPosition={x:p.position.x,z:p.position.z};
 const dx=previous?p.position.x-previous.x:0,dz=previous?p.position.z-previous.z:0;
 const distance=Math.hypot(dx,dz);
 const valid=active&&dt>0&&distance<Math.max(.5,25*dt)&&p.onGround&&!p.isSliding;
 if(valid&&distance>.0001){
  const stride=p.isCrouching?1.2:p.isSprinting?2.35:2;
  p.bobTime=(p.bobTime||0)+distance/stride*Math.PI;
 }
 const lateral=valid?(dx*Math.cos(p.yaw)-dz*Math.sin(p.yaw))/dt:0;
 p._strafeTilt=strafeTilt(p._strafeTilt||0,lateral,dt,active&&!p.reduceMotion);
 return p.reduceMotion?0:p._strafeTilt;
}
