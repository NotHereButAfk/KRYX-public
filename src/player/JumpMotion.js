const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const jumpLandingDuration = speed => .12 + clamp(speed / 12,0,1) * .18;
export function jumpAirPose(grounded, vy=0) {
  return {tuck:grounded?0:clamp((vy+3)/10,0,1),
    clipTime:.68+.54*clamp((8-vy)/16,0,1),
    weaponY:grounded?0:clamp(-vy*.003,-.035,.035),
    weaponPitch:grounded?0:clamp(-vy*.004,-.045,.045)};
}
export function isJumpImpulse(grounded, wasGrounded, vy, previousVy) {
  return !grounded && vy>2 && (wasGrounded || vy-previousVy>3);
}
