// Peripheral speed streaks observed in the owner's recording at 37.5–38.5s.
// Original artwork: a clear centre, soft outward trails, no full-screen blur.
export function sprintEdgeTarget(game) {
  const p = game.player;
  if (!p || game.state !== 'playing' || game._menuOpen || game._chatOpen
    || game._spectating || game._roundGateVisible || game._authoritativeMapTransitioning
    || p.isDead || game._playerDowned || p.reduceMotion || p.weaponSprintBlocked
    || !p.isSprinting) return 0;
  return Math.max(0, Math.min(1, (Math.hypot(p.velocity?.x || 0, p.velocity?.z || 0) - 1) / 6));
}

export class SprintEdges {
  constructor(host) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'sprint-edges';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.amount = 0;
    this.time = 0;
  }

  update(dt, game) {
    const target = sprintEdgeTarget(game);
    const blocked = game.state !== 'playing' || game._menuOpen || game._chatOpen
      || game._spectating || game._roundGateVisible || game._authoritativeMapTransitioning
      || game.player?.isDead || game._playerDowned || game.player?.reduceMotion;
    this.amount = blocked ? 0 : target + (this.amount - target) * Math.exp(-dt * (target ? 9 : 14));
    this.canvas.hidden = this.amount < .005;
    if (this.canvas.hidden || !this.ctx) return;
    const host = this.canvas.parentElement;
    const w = Math.min(960, host.clientWidth), h = Math.max(1, Math.round(w * host.clientHeight / Math.max(1, host.clientWidth)));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.time += dt;
    const ctx = this.ctx, cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI * 2 / 24 + Math.sin(i * 17) * .07;
      const phase = (this.time * .65 + i * .618) % 1;
      const radius = .68 + phase * .38;
      const dx = Math.cos(angle) * cx, dy = Math.sin(angle) * cy;
      const x = cx + dx * radius, y = cy + dy * radius;
      const endX = cx + dx * (radius + .34), endY = cy + dy * (radius + .34);
      const alpha = this.amount * Math.sin(phase * Math.PI) * .065;
      const gradient = ctx.createLinearGradient(x, y, endX, endY);
      gradient.addColorStop(0, 'rgba(220,230,235,0)');
      gradient.addColorStop(.55, `rgba(220,230,235,${alpha})`);
      gradient.addColorStop(1, 'rgba(220,230,235,0)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3 + (i % 4) * 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY); ctx.stroke();
    }
  }
}
