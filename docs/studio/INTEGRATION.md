# Bot skill integration

Private target NotHereButAfk/Ev.io (base f4aa5eb); public target NotHereButAfk/KRYX-public (base 490cff6). Identical shared game code at start; public/private package metadata and deployment files preserved.
Work occurs on codex/bot-skill-upgrade isolated worktrees. Original dirty checkouts remain untouched. Both origin fetch and push URLs must be verified before publishing. Standing project authorization allows ordinary game updates to main after checks; main triggers deployment.

Validation outcome (2026-11-03): focused skill suites pass in both repositories; both production builds pass with the x64 runtime workaround. Backend authorization/boundary suite passes. Updated movement/actions/population/facing/human-motion/account/official-map checks pass; stress soak has zero invalid states (max5.83ms); survival retry passes with p955.74ms. The complete release certificate is not green: old presentation/model/map/economy/gameplay assertions remain, and aggregate certify remains incomplete. A final isolated, matched x64 authority rerun passes55/55 including smoke, matching the unchanged baseline. Earlier smoke failures under load did not reproduce; no smoke code or test was changed.

Browser QA: desktop settings persistence, real Bot600-frame combat fixture (>5 shots, positive damage, >15m travel, >300 moving frames), actual W/mouse look/fire pass. Mobile390x844 tap-to-play passes with no overflow or page errors. Pointer lock is simulated in headless Chrome. Desktop/mobile screenshots inspected. Desktop and mobile scenarios passed in separate runs after correcting the test's mobile selector; full final combined harness was not rerun. Existing random roam harness showed7 moving bots and zero stuck samples but one excessive falling-duration sample. Existing fixed-time smoke startup click raced asset readiness.

Publication policy: prepare reviewed feature branches and pull requests in both repositories. Do not claim live deployment while the required aggregate checks remain failing. Original dirty worktrees are preserved.

Draft PRs published: https://github.com/NotHereButAfk/Ev.io/pull/17 and https://github.com/NotHereButAfk/KRYX-public/pull/1. Identical bot source and tests verified across repositories. Main is unchanged pending release-gate resolution or explicit owner override.

## Lighting followup

Lighting work extends the same two feature branches and PRs, preserving the completed bot improvements. Copilot jobs: arena-lighting (2026-11-03T11-45-57-871Z-ac8e9775), lighting-tests (2026-11-03T11-47-52-727Z-1d6c41c4). Both rejected duplicate files; root reviewed salvageable implementation and corrected sky coordinates, static caster filtering, shadow target lifecycle and viewmodel target matrices. Regression assertions were rewritten after rejecting invalid API assumptions. Studio raw logs remain ignored/private.

Final lighting validation (2026-11-03): both production builds and both five-test lighting suites pass. Viewmodel, client-performance and evmap checks pass. Real browser fixed-camera captures cover Evasion, Fractal, Gypsum and Ancient. Architecture draws on first render:89/41/75/50; subsequent frames and excluded actor draws:0. High2048, medium1024, low releases the shadow target. All six maps across two laps retain exactly matching geometry/texture counts, five fixed scene lights and one current map root. Zero page errors. Portrait390x844 low tier inspected; built-in browser also loaded Gypsum and entered a match. Earlier bot-task keyboard/mouse and mobile Play checks remain documented above. No real-device FPS or new multiplayer lighting test claimed.

Lighting changes match across both repos while retaining the public repository's existing post-match countdown implementation and each package's metadata. Existing main-release blockers remain; updates stay in the two draft PRs.


## Spawn protection followup

Spawn-protection followup: Copilot test proposal run2026-11-03T12-05-41-189Z-8b1831be reviewed and manually corrected. Five focused checks and player-respawn pass; all55 authority checks pass. Matched x64 baseline/current health-regeneration checks pass. Browser proof: visible resume overlay100->80; fresh spawn blocks17 damage with no hurt feedback; after2.1s paused100->80 with Player.update count unchanged5->5. Menu toggles preserve deadline; self/hazard bypass works; zero page errors. Source changes retain both repos existing bot/lighting work and public-specific post-match code. Existing unrelated deployment gates still apply.


## Sound effects followup

Copilot weapon-acoustics and spatial-audio-profile run2026-11-03T12-20-56-538Z-4245baeb returned duplicate path entries and were rejected; manually reviewed snippets were corrected for body texture, reflection layers and silent-tail cleanup. The first regression task did not start in the sandbox; the next lacked an uncommitted context file. Corrected run2026-11-03T12-30-55-823Z-6d0aba67 returned duplicate entries; root corrected imports/listener fixtures and added meaningful priority/culling/impact/tail assertions. Documentation run2026-11-03T12-32-37-358Z-47e58463 succeeded; reviewed prose corrected cover-ceiling and spawn-protection wording.

Final browser result: 27-event26 s48 kHz stereo after capture peak0.747775/RMS0.071278, zero clipped samples and retained voices; five decoded footsteps. HRTF side/distance, cover attenuation, volume/platform mute pass. 101-shot overload stays32 voices, retains local feedback, peak0.92424 and cleans up. Real gesture suspended-to-running unlock passes. Desktop W/mouse/R, settings25% save/reload,390x844 mobile Play/context and no overflow pass. Ten simultaneous wall impacts create one voice; a real map endpoint produces audio only on arrival. Zero page errors. Built-in browser separately entered Evasion and visually inspected arena/HUD. No subjective listening claim. Audio source/tests match across repos; public package metadata and post-match behavior preserved. Existing PRs remain drafts, not deployed.

Both repositories pass test:audio, test:gunfeel and production build (2026-11-03).
