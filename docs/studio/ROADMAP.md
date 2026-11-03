# Bot skill upgrade roadmap

- [x] Verify repositories and benchmark shipped behavior.
- [x] Dispatch bounded studio proposals and review salvageable code.
- [x] Integrate tracking and combat behavior into offline/server bots.
- [x] Validate focused suites, builds, security, authority and browser behavior.
- [x] Synchronize shared source and publish both reviewed feature branches/PRs.
- [ ] Merge/deploy after existing release gates are resolved or owner explicitly authorizes an exception.

## Lighting followup

- [x] Audit renderer, map material ownership, active map metadata and quality tiers.
- [x] Dispatch Copilot lighting implementation and test proposals; review and correct manually after duplicate-output rejection.
- [x] Integrate smooth shading, map-aware sky/sun, cached architectural shadows and viewmodel environment.
- [x] Validate shadow frusta, quality resource lifecycle and excluded actor restoration.
- [x] Complete visual tuning, desktop/mobile verification, both builds and sync both PRs.


## Spawn protection followup

- [x] Align authoritative/local spawn protection at two seconds, verify paused damage and synchronize both PRs.


## Sound effects followup

Completed sound pass: nine weapon reports, distance filtering, visible-contact audio, lowest-priority voice eviction, silent-tail trimming, focused regressions, real browser audio/input/settings/mobile QA and matched before/after WAV capture. Both repository builds are checked before publication.

## Human behavior followup

- [x] Capture the approach-before-shooting, forced-pause and awareness problems in actual Evasion gameplay.
- [x] Replace bot weapon copies, firing delays, time-based strafing and acquisition distance caps.
- [x] Preserve a clear firing lane, return from reload cover and clear plans when switching opponents.
- [x] Verify native local/server cadence, actual hit geometry, authority, real-map gameplay and both builds.
- [x] Synchronize the final source, tests and notes into both existing feature PRs.
- [ ] Resolve the documented pre-existing release gates before main deployment.


## Discord update bot

Implemented publisher, deployment trigger, release notes, persistent worker role and HTTP tests. Pending channel/webhook secret, main merge and real Discord delivery verification.


## K-only skin purchases

Integrated shared prices, authoritative ledger purchases, shop UI and blocked new cash orders. Actual SQL/API and historical settlement tests pass. Browser QA and final paired builds are being recorded below. Discord publisher now uses the existing configuration secret for the selected channel; live delivery awaits main deployment.


Final shop browser validation: actual MenuUI with mocked API, 1360px desktop and 390px touch layouts pass. Confirm/cancel, weapon+character purchase, inventory, reload restoration and insufficient funds verified; balance 2500 -> 1500 -> 500, rejected 2000 K purchase leaves500. Five visible offers and four present rarity prices checked; no cash-checkout requests or modal, no horizontal overflow, zero page errors. Existing read-only withdrawal states remain tested without submitting withdrawals. Browser fixtures are separate from real PostgreSQL transaction tests.


Final integration verification (2026-11-03): both production builds passed; all 11 skin database/API cases and all 7 Discord publisher cases passed in both repositories. Historical payment/tournament suites passed in both. Economy ledger suite passed in both; backend authorization/boundary suite and deployment-policy check passed in private. Added valid defaults for new admin catalog entries; configured earning multipliers and bonuses survive. Updated the obsolete API fixture to expect unknown-item rejection now that K purchases are enabled.

Playwright exercised the actual shop with API fixtures on desktop and mobile, including purchases, cancel, insufficient funds, inventory and account reload. Built-in browser confirmed guest shop login gating; its earnings page had no local API backend, so signed-in visual coverage comes from Playwright fixtures. No production purchases were made. Mythic pricing is configured and unit-checked; the current catalog has no mythic skin. Prior unrelated presentation/animation/map release blockers remain; keep both PRs draft. Discord live bot permissions and delivery are unverified until the private main deployment succeeds.
