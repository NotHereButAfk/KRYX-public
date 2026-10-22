// Cosmetic, server-authored death momentum. Never moves a living hitbox.
export function createDeathReaction(wid, target, source, raycast) {
  const blast = ['rpg', 'concussion', 'frag', 'timebomb'].includes(wid);
  const shotgun = wid === 'levershotgun';
  const separation = source ? Math.hypot(target.px-source.x, (target.py+.9)-(source.y??target.py+.9), target.pz-source.z) : 0;
  const force = blast ? Math.max(.35, 1-separation/18) : 1;
  const speed = blast ? 13 * force : shotgun ? 11 : wid === 'magnum' ? 3.2 : 1.5;
  const lift = blast ? 6.5 * force : shotgun ? 4.8 : .65;
  let x = target.px - (source?.x ?? target.px), z = target.pz - (source?.z ?? target.pz);
  const length = Math.hypot(x, z);
  if (length > .001) { x /= length; z /= length; } else { x = 0; z = 1; }
  let distance = source ? speed / 3 : 0;
  // Conservative torso sweeps stop the full body before nearby walls/cover.
  if (raycast && distance > 0) for (const h of [.35, .9, 1.5]) {
    for (const side of [-.3, 0, .3]) {
      const hit = raycast(target.px - z * side, target.py + h, target.pz + x * side, x, 0, z, distance + .55);
      if (Number.isFinite(hit)) distance = Math.min(distance, Math.max(0, hit - .55));
    }
  }
  // Death snapshots stop moving. Their feet height is not necessarily ground:
  // trace beneath the landing position, including when killed over a ledge.
  let groundOffset = 0;
  if (raycast) {
    const depth = 256;
    const hit = raycast(target.px + x * distance, target.py + .2,
      target.pz + z * distance, 0, -1, 0, depth);
    groundOffset = Number.isFinite(hit) && hit < depth ? Math.min(0, .2 - hit) : -depth;
  }
  const actualLift = source ? lift : 0;
  const landingTime = (actualLift + Math.sqrt(actualLift * actualLift - 36 * groundOffset)) / 18;
  return { x, z, speed: source ? speed : 0, lift: actualLift, distance, groundOffset,
    duration: Math.min(3, Math.max(blast || shotgun ? 1.65 : .9, landingTime + .35)) };
}

export function sampleDeathReaction(reaction, elapsed, yaw = 0) {
  if (!reaction) return null;
  const t = Math.max(0, elapsed);
  const fall = 1 - Math.pow(1 - Math.min(1, t / .85), 3);
  const travel = Math.min(reaction.distance, reaction.speed * (1 - Math.exp(-3 * t)) / 3);
  const floor = reaction.groundOffset ?? 0;
  const contact = (reaction.lift + Math.sqrt(reaction.lift * reaction.lift - 36 * Math.min(0,floor))) / 18;
  const settled = t-contact;
  // A short, dissipating contact rebound gives the body weight without ragdoll limbs.
  const rebound = settled>0 && settled<.24 ? Math.sin(Math.PI*settled/.24)*Math.min(.035,(reaction.lift+18*contact)*.0015)*(1-settled/.24) : 0;
  const air = Math.max(floor, reaction.lift * t - 9 * t * t) + rebound;
  const localX = reaction.x * Math.cos(yaw) - reaction.z * Math.sin(yaw);
  const localZ = reaction.x * Math.sin(yaw) + reaction.z * Math.cos(yaw);
  return { x: reaction.x * travel, y: air + .32 * fall, z: reaction.z * travel,
    air, pitch: localZ * 1.6 * fall, roll: -localX * 1.6 * fall, fall,
    done: t >= reaction.duration };
}
