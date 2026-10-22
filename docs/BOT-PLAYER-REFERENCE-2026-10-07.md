# Player-like bot behavior study

Reference samples viewed in the browser on 2026-10-07:

- [Maximumandroid: ev.io Mobile Gameplay](https://www.youtube.com/watch?v=E5uJuOW2oxo),
  samples around 0:02, 0:22, 1:01, 1:27, 2:23 and 3:12.
  Observed route traversal through rooms/stairs, changing view direction between
  lanes, weapon lowering during travel, and backwards movement while firing
  near the smoke-filled lane at 2:23 (touch joystick below center).
- [Fractal Radio: EV.IO ULTIMATE SHOOTER](https://www.youtube.com/watch?v=Kzl9heLoyTY),
  sampled gameplay between the promotional title cards: scoped rifle encounter
  at a doorway, later aimed shooting beside stairs. This is an edited trailer,
  not a representative full match or a source for precise movement constants.

These are visual samples, not a statistical study of all players. They cannot
establish exact reaction times, input rates, physics values, or average skill.
They support separating traversal, aiming and repositioning instead of one
continuous orbit. Detailed numerical behavior below is our design choice.

## Adaptation

- Keep independent existing patrol paths, obstacle recovery and safe jumps.
- Use player sprint speed for ordinary patrol, removing recurring free boosts.
- On attack, keep a reaction delay and imperfect aim. Then interleave short
  walking adjustments with steady aiming periods, rather than staying planted
  for the entire encounter. Never sprint while returning fire.
- Per-bot encounter timing and alternating directions prevent synchronized
  sidesteps. Back away briefly when crowded or reloading; close at long range.
- Reject unsupported combat steps and steer around walls. Losing visibility
  stops combat movement/fire and eventually returns the bot to patrol.
- Preserve neutral humans until attacked and no arena bot-versus-bot damage.
  The October 7 request supersedes the old permanent stationary retaliation
  pose, not these separate target eligibility rules.

The shared steering helper is exercised at 20/30/60/144 Hz. Server integration
tests cover actual movement, aim pauses, walking-speed limits, live shots,
repeated damage, ledges and lost line of sight. Full-map patrol simulation
covers eight bots per map for three simulated minutes.

## Simulation results

Final 180-second runs used the real authoritative room and rotating map collision
data. Each row is the worst bot on that map, not an average that hides outliers.

| Map | Minimum time moving | Longest stop | Minimum distinct goals | Minimum 20-unit zones |
| --- | ---: | ---: | ---: | ---: |
| Daytime Rook | 84% | 1.55 s | 9 | 46 |
| Winter Graveyard | 87% | 1.50 s | 11 | 53 |
| Evasion | 87% | 1.20 s | 13 | 29 |
| Depot | 88% | 1.50 s | 12 | 93 |

The 12-second controlled duel moved 20.2 units, with 45 walking ticks and 195
aiming ticks, never exceeding walking speed. This is a regression fixture,
not a measurement of human performance. The simulation also exposed premature
route abandonment mid-turn; recovery now waits for alignment before declaring
that the intended lane is blocked. A dedicated corner fixture covers it.
