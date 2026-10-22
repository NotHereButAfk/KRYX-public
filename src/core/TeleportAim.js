// Q selects blink; a fresh trigger press confirms it without also firing a gun.
export class TeleportAim {
  constructor(marker = null) {
    this.marker = marker;
    this.armed = false;
    this.blockUntilRelease = false;
    this.wasDown = false;
  }
  cancel() {
    this.armed = false;
    if (this.marker) this.marker.hidden = true;
  }
  update(input, enabled, cooldown) {
    const tap = input.consumeJustPressed('MobileFire');
    const down = !!input.mouseDown || tap;
    if (!down) this.blockUntilRelease = false;
    const select = input.consumeJustPressed('KeyQ');
    if (!enabled || cooldown > 0) this.cancel();
    else if (select) {
      this.armed = !this.armed;
      if (down) this.blockUntilRelease = true;
    }
    const confirmed = enabled && this.armed && !select && down && (tap || !this.wasDown);
    const block = this.armed || this.blockUntilRelease || confirmed;
    if (confirmed) { this.cancel(); this.blockUntilRelease = true; }
    this.wasDown = down;
    if (this.marker) this.marker.hidden = !this.armed;
    if (!this.filtered || Object.getPrototypeOf(this.filtered) !== input)
      this.filtered = Object.create(input);
    this.filtered.mouseDown = enabled && !block && down;
    this.filtered.rightMouseDown = enabled && !this.armed && input.rightMouseDown;
    this.filtered.teleportConfirmed = confirmed;
    return this.filtered;
  }
}
