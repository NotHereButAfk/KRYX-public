# Public EV.IO Comparison

Last checked: 2026-08-15

Legend: PASS = matching observable contract; PARTIAL = close or partially verified; NO = incorrect/incomplete; UNKNOWN = current EV.IO value unavailable.

| Mechanic | Public EV.IO observation | KYX.IO measured/observed | Status | Difference / evidence |
|---|---|---|---|---|
| Game entry | Public site exposes `CLICK TO PLAY` and immediate browser play | Guest entry and play button boot a match in the browser smoke | PASS | Same low-friction observable flow |
| Startup loading sequence | Public EV.IO first presents `Connecting ...`, then identifies/builds the arena before exposing the game interface | Black game boot is followed by a distinct DAYTIME ROOK map card; browser measured 3,577 ms boot, 2,496 ms map stage, then menu | PASS | Separate game and map readiness stages are now explicit and regression-tested |
| Between-game map rotation | EV.IO rounds transition through an arena-loading stage before the next match | A completed local game advanced Daytime Rook â†’ Winter-Graveyard in the real browser, waited for readiness, then entered the next game; imported maps wrap continuously | PASS | Authoritative sessions still accept the server-selected next map to prevent client/server collision desync |
| First-person weapon hold | Public gameplay stills show a compact diagonal rifle from lower right, with hands attached at the grip/handguard | Corrected shared mount: 0.18 rad pitch, 0.31 rad yaw, -0.10 rad roll, 0.76 scale; hands inherit the same transform | PARTIAL | Hold is mechanically correct and similarly readable; KYX model/skin remains intentionally original |
| Third-person model and firearm carry | Public character material shows a connected animated figure and a shouldered firearm with the head/chest readable | Shinobi, Frost Ronin, and Nightstalker use one connected lightweight shinobi body family for the local player, all seven bots, and authoritative remotes. The silhouette has fitted shoulders/chest, a wrapped dark mask, narrow eye slit, hood knot, and short scarf tails. Every firearm owns explicit trigger-hand, support-hand, and reload contact geometry shared by first- and third-person rigs. Both the connected fallback and loaded Soldier use role-correct carries: two-hand compressed-ready pistols, tight compact holds, stock-retained rifle/shotgun low-ready, weight-supported LMG and precision holds, and shoulder-height launcher tubes. Procedural firearm meshes are uniformly fitted to per-model length and per-class height envelopes so showcase-sized pistols/compact guns cannot overwhelm the body. All 17 firearms pass 272 fallback plus 816 loaded-Soldier carry/action poses without torso penetration | PASS | Mechanical modeling/pose contract matches; KYX art remains intentionally original. The complete 17-weapon browser galleries guard visible family and physical-size differences as well as numerical IK |
| Walk | Controlled current EV.IO timing unavailable | Browser peak 6.20 m/s; distance-derived gait now transitions into a smoothed 2.08 cycles/s arena-walk cap instead of accelerating to 6.35 cycles/s. Direction, ordinary-speed foot-plant, jump, and connected-body locomotion gates pass | UNKNOWN | Visual treadmill effect fixed; exact EV.IO cadence still needs controlled current footage |
| Sprint | Controlled current EV.IO timing unavailable | Browser peak 10.85 m/s; sprint/walk ratio and gait gates pass | UNKNOWN | KYX behavior works; EV.IO timing not measured today |
| Jump | Controlled current EV.IO timing unavailable | Browser-observed peak +4.42 m; deterministic jump fixture passes | UNKNOWN | EV.IO jump arc still needs current frame analysis |
| Auto Rifle cadence | Public live timing unavailable | 9 rounds/s contract test passes | UNKNOWN | Do not claim parity until equivalent EV.IO footage is timestamped |
| Ammo/reload | EV.IO visibly has finite magazine HUD and reload | Live ammo consumption and reload start/completion pass; action pose checks keep hands attached; death-during-reload reset passes | PARTIAL | Observable contract matches; exact EV.IO reload duration unknown |
| Weapon switching | EV.IO exposes numbered weapon inventory | Gun-to-melee-to-gun browser sequence passes; hands and weapon remain on one transform | PARTIAL | Exact public swap duration unknown |
| ADS/crosshair | EV.IO supports right-click aim and reticle change | Rapid-look stress and ADS enter/exit pass; all firearms clear the first ADS frame; 30/60/144 Hz state agrees | PARTIAL | Exact EV.IO FOV/sensitivity not measured |
| Blink/teleport | EV.IO exposes teleport ability and cooldown | Q activates blink and enters cooldown; a new life resets it to ready | PARTIAL | Exact public range/cooldown not remeasured today |
| Frag/smoke abilities | EV.IO publicly exposes throwable combat abilities | G/F consume distinct frag/smoke charges; both refill at the new-life boundary | PARTIAL | Exact public cooldown and projectile timing remain unmeasured |
| Scoreboard | EV.IO exposes leaderboard/performance UI | Hold Tab opens live scoreboard; release closes it | PASS | Input/UI contract matches |
| Death/respawn | EV.IO uses a death/respawn flow | Dedicated overlay on local and authoritative paths; monotonic automatic respawn; clean weapon/ability state verified | PARTIAL | Public exact delay unavailable in the controlled session |
| Health/shield | EV.IO shows health/shield resources | 100 health; armor-dependent shield; damage and regeneration gates pass | PARTIAL | Exact public regeneration values unverified |
| Collision/map bounds | EV.IO uses angular arena collision and kill volumes | Deterministic wall/ceiling/corner/fall fixtures, map topology, and spawn gates pass | PARTIAL | KYX map uses public Rook data, but feel needs human A/B play |
| Match population | EV.IO displays multiplayer population | KYX displays 8/8 with seven bot slots by default | NO | Default shipped game is not equivalent public multiplayer |
| Bot weapon behavior | Current EV.IO room advertised an 8-player Team Deathmatch; embedded pointer lock prevented a controlled opponent trial | Eight-slot local lobby now cycles M4, M16, Comet Rifle, LMG, and blade roles; ranged bots use weapon-specific damage/cadence/range/audio, finite magazines, and animated reload pauses | PARTIAL | KYX now exposes real weapon-role variety and reload counterplay; exact public EV.IO opponent loadouts and timings remain unmeasured |
| Team Slayer | Public EV.IO has team modes | KYX menu entry currently runs deathmatch logic | NO | Teams not implemented |
| Capture the Flag | Public EV.IO has CTF | No flags implemented | NO | Mode incomplete |
| King of the Hill | Public EV.IO has objective modes | No hill implemented | NO | Mode incomplete |
| Firefight/survival | Public EV.IO exposes survival/PvE | KYX has wave defense, down/revive, and zombies | PARTIAL | Exact wave and difficulty parity unverified |
| Performance stability | Public value is device-dependent | 64-player sim at or below 0.7 ms/tick; automated soak reports no leak | PARTIAL | Needs comparable live-client FPS capture on the same hardware |
| Console/network health | Public server state is outside KYX code | Zero first-party errors/failures in system-Chrome smoke | PASS | Embedded entry also reaches HUD without pointer-lock rejection errors |

## Current public reference limitation

The public EV.IO page was re-opened on 2026-08-15. A current 8-player Team Deathmatch room on Resistance and its live map spectator loaded; activating `CLICK TO PLAY` again hit the embedded Chromium pointer-lock limitation, so no controlled EV.IO player-input timings are presented as verified facts. Weapon framing uses public gameplay stills; the KYX acceptance target is anatomically correct holding and animation, not copied EV.IO model art.

## Next comparison cycle

1. Retry a controlled current EV.IO match and capture timestamps for jump, Auto Rifle cadence, reload, swap, and respawn.
2. Run an equivalent scripted KYX sequence at the same viewport/FOV.
3. Prioritize the largest player-noticeable mismatch.
4. Implement the smallest focused correction.
5. Rerun `test:gameplay-smoke`, affected contract tests, and `certify`.
