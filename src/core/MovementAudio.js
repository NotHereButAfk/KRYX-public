// Consume fresh predicted ticks, never server reconciliation or render smoothing.
export class MovementAudio {
  constructor() { this.distance = 0; }
  update(audio, before, after, sprint, active, dt) {
    const travel = Math.hypot(after.px-before.px, after.pz-before.pz);
    if (!active || !Number.isFinite(travel) || travel > 25*dt) {
      this.distance = 0;
      return;
    }
    if (!before.onGround && after.onGround && before.vy < -2)
      audio?.playLand?.(before.vy < -12);
    if (!after.onGround || after.slide || travel < .0001) {
      this.distance = 0;
      return;
    }
    const stride = after.crouch ? 1.2 : sprint ? 2.35 : 2;
    this.distance += travel;
    if (this.distance >= stride) {
      this.distance %= stride;
      audio?.playFootstep?.(sprint);
    }
  }
}
