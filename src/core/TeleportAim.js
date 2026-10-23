// Q selects blink; a fresh trigger press confirms it without also firing a gun.
export class TeleportAim {
  constructor(marker = null) {
    this.marker = marker;
    this.armed = false;
    this.blockUntilRelease = false;
    this.wasDown = false;
    this.blockAimUntilRelease = false;
  }
  cancel() {
    this.armed = false;
    if (this.marker) this.marker.hidden = true;
  }
  update(input, enabled, cooldown, validTarget = true) {
    // Preserve short desktop clicks even if mouseup arrives before a frame.
    const mobileTap = input.consumeJustPressed('MobileFire');
    const tap = input.consumeJustPressed('PrimaryFire') || mobileTap;
    const down = !!input.mouseDown || tap;
    if (!down) this.blockUntilRelease = false;
    if (!input.rightMouseDown) this.blockAimUntilRelease = false;
    const select = input.consumeJustPressed('KeyQ');
    if (!enabled || cooldown > 0) this.cancel();
    else if (select) {
      this.armed = !this.armed;
      if (down) this.blockUntilRelease = true;
    }
    if (this.armed && input.rightMouseDown) {
      this.cancel(); this.blockAimUntilRelease = true;
      if (down) this.blockUntilRelease = true;
    }
    const confirmed = enabled && this.armed && validTarget && !select && down && (tap || !this.wasDown);
    const block = this.armed || this.blockUntilRelease || confirmed;
    if (confirmed) { this.cancel(); this.blockUntilRelease = true; }
    this.wasDown = down;
    if (this.marker) this.marker.hidden = !this.armed;
    if (!this.filtered || Object.getPrototypeOf(this.filtered) !== input)
      this.filtered = Object.create(input);
    this.filtered.mouseDown = enabled && !block && down;
    this.filtered.rightMouseDown = enabled && !this.armed && !this.blockAimUntilRelease && input.rightMouseDown;
    this.filtered.teleportConfirmed = confirmed;
    return this.filtered;
  }
}
