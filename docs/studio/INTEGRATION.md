# Bot skill integration

Private target NotHereButAfk/Ev.io (base f4aa5eb); public target NotHereButAfk/KRYX-public (base 490cff6). Identical shared game code at start; public/private package metadata and deployment files preserved.
Work occurs on codex/bot-skill-upgrade isolated worktrees. Original dirty checkouts remain untouched. Both origin fetch and push URLs must be verified before publishing. Standing project authorization allows ordinary game updates to main after checks; main triggers deployment.

Validation outcome (2026-11-03): focused skill suites pass in both repositories; both production builds pass with the x64 runtime workaround. Backend authorization/boundary suite passes. Updated movement/actions/population/facing/human-motion/account/official-map checks pass; stress soak has zero invalid states (max5.83ms); survival retry passes with p955.74ms. The complete release certificate is not green: old presentation/model/map/economy/gameplay assertions remain, and the latest full authority run is54/55 (smoke-volume timing assertion under investigation).

Browser QA: desktop settings persistence, real Bot600-frame combat fixture (>5 shots, positive damage, >15m travel, >300 moving frames), actual W/mouse look/fire pass. Mobile390x844 tap-to-play passes with no overflow or page errors. Pointer lock is simulated in headless Chrome. Desktop/mobile screenshots inspected. Desktop and mobile scenarios passed in separate runs after correcting the test's mobile selector; full final combined harness was not rerun. Existing random roam harness showed7 moving bots and zero stuck samples but one excessive falling-duration sample. Existing fixed-time smoke startup click raced asset readiness.

Publication policy: prepare reviewed feature branches and pull requests in both repositories. Do not claim live deployment while the required aggregate checks remain failing. Original dirty worktrees are preserved.
