# Bot engagement

Bots engage from useful range and continue native weapon fire while moving. They no longer need to approach within a short bot-only radius, pause after canned bursts, stop on a time schedule or ignore a plainly visible nearby opponent.

## Weapons and movement

All four firearm roles copy the player weapon catalog. Local M4 is 10 damage / .12 seconds / 50 rounds / 1.8-second reload / 150-metre range; Uzi is 12 / .07 / 32 / 1.5 / 80. Battle Rifle emits three independent rays (or the rounds left in its magazine), consumes those rounds and uses ordinary critical-hit geometry. Plasma Rifle is a 65-damage direct hitscan shot, consistent with the actual player firing path. The sword also takes its values from the catalog.

The server uses the same fractional cooldown as players without another rounded bot timer. Offline firing preserves fractional frame timing at 30/60/144 Hz, updates cooldown while turning or occluded and cannot bank shots during idle time. Native spread, bloom, movement penalties, ammo and reloads remain. These are our weapon values, not verified constants from official ev.io.

Persistent strafe intent replaces clock-driven side changes. Bots maintain distance when the weapon is useful, advance while aiming beyond useful range, and retreat when close or reloading. A cached probe checks floor steps, ledges, movement collision and the candidate firing line, with at most three candidates/four rays each. When reloading breaks sight, a bot returns toward its own last clear firing position instead of driving directly into the intervening wall. The plan clears on sight restoration, arrival, respawn or opponent change. Repeated hits from the same opponent preserve the ongoing plan.

## Awareness and fairness

Normal field of view is 140 degrees with nearby 10-metre peripheral awareness. Acquisition/tracking have no arbitrary distance caps; fire still respects each weapon's range. Actual line of sight, server smoke/flash and spawn protection remain. A visible alternative can replace a target unseen for more than .35 seconds. Hidden focus priority uses remembered coordinates. Reaction time and imperfect aim remain; offline smoke parity is not claimed.

## Verified behavior

The actual Evasion browser encounter at 36 metres now fires at .25 seconds instead of 1.583 seconds after approaching to 21.253 metres. Native M4 fire averages .12 seconds, with 50 shots in eight simulated seconds. The extended encounter fires 81 shots in 12 seconds and resumes after reload/peek at 8.283 seconds with no occluded shots or wall stall. Nearby rear, side, ordinary visible and resume-overlay cases engage. Normal-health seven-bot gameplay is checked separately from extended-health controlled captures.

Focused regression cases, authority and awareness checks pass; see TESTING.md for methods and limits. Existing presentation/map/release failures remain documented. Both draft PRs include the changes; this is not a live deployment or a claim that AI has become indistinguishable from a person.
