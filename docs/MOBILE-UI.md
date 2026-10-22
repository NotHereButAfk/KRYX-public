# Mobile reference UI

Touch devices use the same detection as InputManager. The home screen has three
large tiles (abilities, character/loadout, settings), a blurred map backdrop,
TAP TO PLAY, and the existing account/rankings/feedback/More links. During a
match the same screen offers TAP TO RESUME. More retains game modes, profile,
shop, party and private-match navigation, including account gates.

The joystick moves the player and automatically sprints when pushed forward.
Right-side controls provide reload, hold-to-aim, frag grenade, hold-to-fire,
weapon swap, hold-to-crouch/slide, jump and ability. Dragging the open right
area, Fire, or Aim turns the camera. Multiple fingers own their actions
independently; releasing movement does not release crouch or fire. Cancelling
a touch, hiding controls, changing viewport, or losing window focus releases
held input. Smoke remains available through its keyboard binding.

`npm run test:mobile-ui` opens the real game in Chromium touch emulation,
checks panels and play/resume, checks landscape/portrait target bounds and
non-overlap, then drives the actual touch handlers with CDP multi-touch events.
Set MOBILE_UI_SHOTS to a directory to save screenshots. This validates browser
touch behavior; physical iOS/Android hardware feel is not measured by the probe.
