# Movement reference, 2026-10-05

Inspected the public script loaded by https://ev.io/preview/:
`https://ev.io/preview/bundle.js?v=12456678000cnnn`.

The baseline locomotion code uses 0.45 units per 50 ms tick for normal
movement and a 0.70 sprint cap: 9 and 14 world units per second. Game modes
and upgrades can modify these. KYX now uses those baseline speeds, retaining
its own acceleration, stamina and collision implementation.

The reference standing camera offset is 1.8 units. KYX matches that eye
height and keeps its existing body proportions (0.936 eye/stature ratio),
giving both bots and players a 1.923-unit body. This is an adapted size,
not a claim that the reference's complete collision capsule is identical.

The preview's Run control is a stationary animation demonstration, not a
travel-speed measurement. KYX retains distance-driven cadence and planted
feet for its own clips; no exact animation-curve equivalence is claimed.

The owner separately requested a higher jump. KYX's shared jump impulse
is multiplied by sqrt(1.2), approximately 20% more ballistic height at
unchanged gravity. This jump change is independent of the EV reference.

## October 8 recording review

Reviewed sampled frames across the 161.45-second user recording
`Recording 2026-10-08 205203.mp4`, plus quarter-second movement frames at
83–88 seconds and half-second transition frames at 147–157 seconds.
This is visual reference review, not a measurement of exact source animation
curves or world-space speeds.

- The opening Little Town 2065 map card precedes the menu camera. The menu
  camera changes position slowly while looking across the central buses and
  archway; this is a map tour, not proof of individual-player chase-camera rules.
- At 83–88 seconds, the opponent uses visible alternating leg extension,
  bent knees while airborne, and an upper body oriented toward combat. Grounded
  travel and the jump pose are distinct. These moving-camera frames do not
  establish foot-slip measurements or an exact cadence.
- At approximately 151 seconds the results display changes to Gypsum's map
  card, followed around 152.5 seconds by the menu view. A fixed ten-second
  loading delay would not reproduce this observed transition. Keep KYX's
  map/connection readiness gate, separate from its requested ten-second results.
- Retain the owner's latest walking-cycle-for-both-speeds instruction. The
  recording does not justify silently restoring the older hopping push-off.

Loading adaptation: keep the separate black startup screen, then the selected map image with a left information panel and spinner. The card now exposes actual preparation/retry stages and waits for map shader compilation before fading into the ready scene. Match results retain their separate ten-second duration; no minimum map-loading timer is added. Browser checks cover cold startup, map rotation, failed asset fetches and interrupted connections.

## Complete presentation pass, October 8

The owner clarified that the whole recording is the target except for models.
Compared the full-duration contact sheet, the 86–89 second movement sequence,
and full-resolution gameplay/results frames at 67 and 136 seconds.

- Results: the recording shows a 0:15 countdown, a moving arena camera, no held
  weapon, tabbed standings, and the next map returning to Click to Play. Use a
  shared 15-second result duration; keep the separate slow-loader gate capped
  at 10 seconds. Combat remains frozen while the presentation camera moves.
- Menus: retain a clear map tour instead of blurring the whole world. Keep
  KYX navigation/account features and the existing individual-player spectator.
- HUD: restore the clock icon, responsive wide health/stamina bars, neutral
  translucent results, and a guest sign-in prompt. No reference branding added.
- Movement: retain the previously verified 9/14 baseline speeds and existing
  shared grounded/jump poses. Reduce camera/weapon bounce and share the
  resolved-distance step clock between footsteps and the held gun.
- Arena materials: retain authored colors without filmic tone compression.
- Existing models, weapon statistics and custom audio assets remain intact.
  The video does not establish exact recoil, damage, spread or sound waveforms;
  those are not claimed as reverse-engineered constants.

Browser verification covers a moving results camera with frozen player state,
slow-client readiness, map loading, return to the menu, and recapture only on
Play. Existing motion, grip, weapon, audio and map gates remain required.

## Loading motion correction, October 8

A closer frame-by-frame review at 2–10 seconds shows the loading background
changing scale/position while the left information panel stays fixed and the
bottom-right spinner rotates. It is not a still presentation. The footage
does not establish whether this is an image transform or a rendered camera.
Our implementation pans/zooms the map artwork on a separate compositor layer,
blurs the translucent fixed panel, and restores the blurred Click to Play map
view. It preserves real readiness completion without a forced loading delay.
Reduced-motion users receive static artwork and indicator. Chromium verified
background/spinner movement, fixed panel position, and reduced-motion behavior;
the startup/rotation check also passed.
