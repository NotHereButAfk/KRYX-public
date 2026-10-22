# Recording review — September 24, 2026

Reference: user-supplied `Recording 2026-09-24 214555.mp4` (2m 15.77s, approximately 30 fps). The recording is not stored in the repository.

## Observed visual evidence

- 0–18s: results table remains over the last arena view, with winner heading, leaderboard/earn/performance tabs, earnings footer and next-game countdown.
- Approximately 18.25–19.75s: the incoming arena preview fills the screen, with a narrow translucent left strip containing map name, region, mode and player count. Then the lobby camera appears. This duration is an observation, not a required loading delay.
- 28–31s (inspected at 0.2s intervals): the followed character alternates airborne and grounded poses; brief expanding floor puffs help show takeoff/landing. The upper body retains its weapon-facing pose through movement.
- Later gameplay shows compact ability/status bars, low first-person weapon placement, bottom-center reward feedback and a vertical weapon list. These already exist in KYX and are retained.

## Applied changes

- Match results gain a winner/draw heading for deathmatch and a K earnings footer. Live Tab standings stay compact.
- Arena loading retains its full preview, uses a slimmer information panel and remains readiness-driven. The separate startup logo stays in place.
- Remote player presentation gains a short, world-anchored landing cue, driven by actual airborne-to-grounded state and falling velocity. Each avatar reuses one mesh and disposes it on teardown.

## Limits

A moving spectator camera does not establish exact world speed, stride length, acceleration, collision constants or animation playback rates. Existing measured gait, jump and weapon-carry logic is retained instead of inferring physics values from screen motion. This review concerns the visuals and transitions; it does not claim an audio comparison.

## Movement follow-up

Revisited the 28–31 second third-person sequence and the 40–42 second rifle
sequence. The torso remains aimed while the legs change travel direction;
takeoff tucks the legs with a short boot plume. The moving camera prevents an
exact world-distance measurement. Public changelog https://ev.io/changelog
also records separate sprint/normal running animations and historical sprint
speed changes, but does not publish numerical movement speeds.

KYX tuning choices, **not verified EV.IO constants**:
- Walk/strafe 6.6 m/s; sprint 9.24 m/s (1.4x). Previously 9.24 / 12.936.
- Slide launch follows sprint speed at 1.65x rather than retaining an unrelated
  30.492 m/s launch after lowering sprint.
- First-person footsteps/bob advance from resolved horizontal travel. No
  footsteps against walls, during jumps, slides, or teleport discontinuities.
- Smaller 1.8 cm camera bob, eased out on stopping; quieter sprint camera roll.
- Existing distance-measured skeletal cadence, directional lower-body pose,
  tucked jump legs, boot jets and weapon grips remain in use. Jump reach is
  preserved to avoid invalidating authored platform routes.

Speed goldens were regenerated only after preserving collision invariants;
the ramp tape was lengthened so the slower player reaches the same slope area.
