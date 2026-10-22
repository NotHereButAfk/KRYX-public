// Apply every accumulated mouse delta once, without frame-time scaling or lag.
export function applyMouseLook(player, input) {
  const base = player.baseFov || 75;
  const fov = player.camera?.fov || base;
  const zoom = Math.min(1, Math.tan(fov * Math.PI / 360) / Math.tan(base * Math.PI / 360));
  const sensitivity = 0.0024 * (player.sensitivityMult ?? 1) * zoom;
  const dx = Number.isFinite(input.mouseDX) ? input.mouseDX : 0;
  const dy = Number.isFinite(input.mouseDY) ? input.mouseDY : 0;
  player.yaw -= dx * sensitivity;
  player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05,
    player.pitch + (player.invertY ? 1 : -1) * dy * sensitivity));
}
