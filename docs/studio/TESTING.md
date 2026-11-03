# Bot skill validation

`npm run test:bot-skill` runs pure helpers, authoritative/offline tracking lifecycle, controlled duel benchmark, real rig movement across 30/60/144Hz and smoke/flash/cover/reload checks. `npm run test:bots` also includes the new tests.
Baseline f4aa5eb: 48 deterministic eight-second duels per scenario; stationary DPS 9.974, moving DPS 7.135, first shot .40625s. Upgraded: stationary DPS 16.797, moving DPS 18.333, first shot .26042s. Stationary hit rate 34.3%, moving 37.5%. Exposed unprovoked kill 5.7s versus baseline 9.2s. No weapon damage increase.
Benchmarks are controlled synthetic encounters, not claims of a universal skill multiplier or human playtest results.
12-second live authoritative fixture: 60.1m repositioning, 180 moving/60 aiming ticks; ordinary walking speed cap, no free dash. Offline authored-rig tests at 30/60/144Hz pass.
Full bot navigation checks passed all nine maps on upgraded code. Full bot suite stops on the pre-existing Reforged material assertion in bot_presentation_check.mjs, reproduced unchanged.
Windows ARM64 native Rolldown is blocked by Application Control. Build/browser QA uses existing official x64 Node and isolated matching Rolldown1.2.15/LightningCSS1.33.0 bindings; no package lock or app dependencies changed.
Browser harness: CHROME points to an installed Chrome executable; KYX_URL points to a local Vite server; run node tools/bot_skill_browser_check.mjs. KYX_MOBILE_ONLY=1 runs only the390x844 followup. Screenshots/report go to KYX_SKILL_OUTPUT or ignored/local artifacts. It tests actual browser input, settings persistence and a real Bot on a deterministic floor, not imported-map combat path quality.

## Lighting validation

`npm run test:map-lighting` covers per-map profiles, all eight corners of shifted map bounds inside sun frusta, map/quality invalidation, shadow target disposal, mixed hidden/opaque groups, dynamic-caster exclusion, exception-safe restoration and owned-resource disposal.

`tools/lighting_browser_check.mjs` uses a real local browser and identical camera poses for before/after comparisons. Configure CHROME, KYX_URL, KYX_LIGHTING_OUTPUT and KYX_LIGHTING_POSES; use KYX_LIGHTING_PHASE=before or after. Instrument actual onBeforeShadow calls to verify first-render architecture draws, zero cached redraws and zero non-map casters. Compare Evasion, Fractal and Gypsum; check high/medium/low targets and portrait rendering. The baseline and upgraded static scenes use the same pose data.


## Spawn protection followup

npm run test:player-respawn now includes five spawn-protection regressions: local wall-clock boundaries without updates, Arena/Survival server boundaries, repeated-ready nonrenewal, respawn and self-damage. server/authnet_test.mjs checks protection at tick39 and damage at40. tools/spawn_protection_browser_check.mjs uses real Play/Escape/resume UI and deterministic Game enemy-hit fixtures; configure CHROME, KYX_URL and KYX_SPAWN_OUTPUT. It checks paused damage, fresh2s window, no movement ticks during expiry, unchanged menu deadline and self/hazard bypass.
