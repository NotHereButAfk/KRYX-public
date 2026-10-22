// Shared shoulder motion moves both arms and the weapon as one assembly.
// Inertia comes from resolved velocity, and stride phase from actual travel.
export function firstPersonBodyPose(inertia, phase, stride, weight=1, sprint=0) {
  const w=Math.max(0,Math.min(1,weight));
  const step=Math.max(0,Math.min(1,stride))*(1+.5*Math.max(0,Math.min(1,sprint)));
  const sway=Math.sin(phase)*step, push=Math.sin(phase*2)*step;
  return {
    x:(inertia.roll*-.4+sway*.017)*w,
    y:(inertia.drop*.9-(1-Math.cos(phase*2))*step*.003)*w,
    z:(inertia.pitch*-.35+push*.008)*w,
    pitch:(inertia.pitch*.65+push*.006)*w,
    roll:(inertia.roll*.55+sway*.013)*w,
    yaw:(inertia.twist*.6+sway*.006)*w
  };
}
