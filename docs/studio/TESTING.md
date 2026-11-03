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


## Sound effects followup

npm run test:audio now includes spatial-audio.test.mjs: local-priority eviction regression, monotonic distance/cover profile, zero allocation/query for invalid/distant events, wall-impact rate cap, prompt silent-tail release. Existing bullet-impact tests additionally verify no contact audio for air/player/predicted hits, no early tracer sounds, and no stale/repeated-map events. tools/audio_browser_check.mjs uses CHROME, KYX_URL, KYX_AUDIO_OUTPUT and KYX_AUDIO_PHASE; captures the same27 events in26 seconds through real WebAudio with decoded CC0 footsteps, then checks mute/volume, HRTF, cover, overload, real gesture unlock, keyboard/mouse, settings reload and mobile Play.

## Final engagement validation (supersedes initial bot metrics)

The four focused engagement/firing-lane/target-switch/weapon-parity files pass 14 Node test cases. They exercise actual Three hit geometry, Battle Rifle partial magazines, stance/critical hits, muzzle failure, native 30/60/144 Hz local timing, actual authoritative M4/Uzi fractional-tick shot events, hidden-target selection and cover lifecycle. Awareness passes 16/16; authority passes 55/55. Tracking, movement/style, combat, casual behavior, player respawn and spawn-protection checks pass. The full bot run passes navigation/patrol across all nine maps and still stops on the unchanged obsolete colored-plates presentation assertion.

Final authoritative benchmark: 48 eight-second duels per scenario, stationary 43.125 DPS / 67.647% hits and moving 42.7604 DPS / 67.075% hits; average first shot .26042 seconds. Original f4aa5eb comparison was 9.974 and 7.135 DPS. Native player weapon values now apply, so this result combines behavior and restored weapon stats. No universal multiplier is claimed. Exposed unprovoked target dies at 2.5 seconds; spawn protection still respected. Live retaliation proof fires 26 shots, including 23 after reload, with 15 hits and movement bounded to 7.20 m/s.

Actual Evasion Game/BotManager/Bot fixed-60Hz browser proof: 36-metre first shot 1.583 -> .250 seconds without first approaching to 21 metres; 50 shots in eight seconds at mean .120-second intervals. 24-metre, 65-degree side, 8-metre rear and Click to Resume encounters also engage. Extended 12-second reload test emits 81 shots, returns from cover and resumes at 8.283 seconds; zero occluded shots and final sight clear. Controlled probes use extended target health; separate seven-bot live gameplay uses normal 100 health. Browser errors: zero. The built-in browser separately entered and visually inspected the final Evasion scene. Software WebGL timings are not hardware FPS measurements; authoritative multiplayer has headless/network coverage rather than this browser capture.


## Discord update bot

Discord publisher tests and dry preview cover successful requests, eligibility, no mentions, duplicate receipts, URL restrictions, rate limits and invalid notes. Live Discord delivery and hosted workflow execution await activation.


## K-only skin purchases

Ten real embedded-PostgreSQL/API cases pass: five-price policy, metadata/profile, auth/origin, forged prices, exact debit+ownership, retries/concurrent requests, insufficient balance, SQL rollback and market rotation. Payment and tournament fixtures retain historical SOL/USDC verification while rejecting new paid orders. The general economy suite passes after using a real catalog purchase/refund fixture. Discord publisher tests now7/7 including selected-channel bot credentials.


Final shop browser validation: actual MenuUI with mocked API, 1360px desktop and 390px touch layouts pass. Confirm/cancel, weapon+character purchase, inventory, reload restoration and insufficient funds verified; balance 2500 -> 1500 -> 500, rejected 2000 K purchase leaves500. Five visible offers and four present rarity prices checked; no cash-checkout requests or modal, no horizontal overflow, zero page errors. Existing read-only withdrawal states remain tested without submitting withdrawals. Browser fixtures are separate from real PostgreSQL transaction tests.


Final integration verification (2026-11-03): both production builds passed; all 11 skin database/API cases and all 7 Discord publisher cases passed in both repositories. Historical payment/tournament suites passed in both. Economy ledger suite passed in both; backend authorization/boundary suite and deployment-policy check passed in private. Added valid defaults for new admin catalog entries; configured earning multipliers and bonuses survive. Updated the obsolete API fixture to expect unknown-item rejection now that K purchases are enabled.

Playwright exercised the actual shop with API fixtures on desktop and mobile, including purchases, cancel, insufficient funds, inventory and account reload. Built-in browser confirmed guest shop login gating; its earnings page had no local API backend, so signed-in visual coverage comes from Playwright fixtures. No production purchases were made. Mythic pricing is configured and unit-checked; the current catalog has no mythic skin. Prior unrelated presentation/animation/map release blockers remain; keep both PRs draft. Discord live bot permissions and delivery are unverified until the private main deployment succeeds.
