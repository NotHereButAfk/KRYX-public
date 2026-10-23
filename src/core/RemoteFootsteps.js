// Distance-driven remote Foley: interpolation stalls, spawns and teleports
// must never produce running-in-place or a burst of catch-up footsteps.
export class RemoteFootsteps {
  constructor() { this.ready = false; this.distance = 0; }
  update(state, dt, audible = true) {
    const valid = Number.isFinite(state.x) && Number.isFinite(state.y)
      && Number.isFinite(state.z) && Number.isFinite(dt) && dt > 0;
    if (!valid) { this.ready = false; this.distance = 0; return null; }
    const travel = this.ready ? Math.hypot(state.x-this.x,state.z-this.z) : 0;
    const discontinuity = !this.ready || travel > Math.max(1,dt*24)
      || Math.abs(state.y-this.y) > Math.max(2,dt*40);
    const landed = this.ready && !this.grounded && state.grounded && this.vy < -2;
    const hard = this.vy < -12;
    this.x=state.x; this.y=state.y; this.z=state.z;
    this.grounded=!!state.grounded; this.vy=state.vy || 0; this.ready=true;
    if (discontinuity || !audible || state.alive === false || !state.grounded || state.sliding) {
      this.distance=0; return null;
    }
    if (landed) { this.distance=0; return hard ? 'hard-land' : 'land'; }
    if (travel < .0001) { this.distance=0; return null; }
    const stride=state.crouch ? 1.2 : state.sprint ? 2.35 : 2;
    this.distance+=travel;
    if (this.distance < stride) return null;
    this.distance%=stride;
    return state.sprint ? 'run' : 'step';
  }
}
