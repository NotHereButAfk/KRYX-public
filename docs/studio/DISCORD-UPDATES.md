# Discord game update bot

Status: implemented and tested with mocked HTTP and a local preview; live Discord activation awaits the owner's channel/webhook and merge into main. No live Discord post has been sent.

## Assigned studio role

Copilot is the Release Notes Editor (studio role: documentation). For each game update, inspect the actual diff and replace release/game-update.json with a NEW immutable id, short title and 1-12 truthful player-facing changes. Never reuse an id for changed text, promise untested improvements, include credentials/private links or claim drafts are live. Codex reviews the notes and synchronizes both repos before release. This is an on-demand studio assignment, not an unattended AI service. Dispatch with existing allowance/tool denial; never bypass auth, cooldown or free-plan guards. If unavailable, Codex prepares/reviews the notes and records the fallback.

The first bounded Copilot assignment was refused by the studio as unavailable/cooling down (run 2026-11-03T13-53-55-283Z-ee3446b6). No proposal was accepted; Codex implemented the publisher and tests locally. No paid provider was enabled.

## Automatic publishing

The Discord game updates workflow runs after a successful Deploy to VPS push deployment on main. Draft branches, failed deployments, forks, public-mirror runs and manual service audits do not post. It checks out the deployed commit and sends its reviewed release/game-update.json. Only NotHereButAfk/Ev.io sends; the public repo mirrors the implementation. This leaves the existing tournament Discord integration unchanged.

KRYX Updates is a lightweight Discord webhook bot: no gateway process, AI API bill or bot-token permission expansion. GitHub Actions runner usage remains subject to the repository's existing plan; no billing settings were changed.

Successful receipt artifacts suppress repeat release ids for their 90-day retention period. Posts are serialized. This is NOT an exactly-once guarantee: an interrupted send/receipt upload or expired/deleted artifact can allow a duplicate. Inspect the channel before rerunning an uncertain failure. HTTP failures, including rate limits, fail without automatic POST retries. An unchanged release id is intentionally skipped while its receipt exists, so the editor must supply a fresh note for every game update.

## Activate

1. Choose the Discord server and a normal text announcement channel. In its integrations, create a webhook named KRYX Updates. Do not paste its credential-bearing URL into chat, code or release notes.
2. Store the URL directly as the private Ev.io repository Actions secret DISCORD_UPDATES_WEBHOOK_URL. Do not put it in the public mirror. Existing DISCORD_CONFIG_JSON is for tournament/account features and is not used here.
3. Merge the reviewed workflow and notes to main when the game's release gates permit. The next successful push deployment posts the prepared update. A missing secret fails the announcement job visibly; it does not roll back a game deployment.
4. Check Discord game updates in Actions and confirm the message in the selected channel. If delivery succeeded but receipt storage failed, check for a duplicate before retrying. Live delivery has not yet been verified.

## Checks and preview

Run node --test tests/discord-updates.test.mjs. Set DRY_RUN=1 and run node tools/discord-updates.mjs to preview without network or credentials. Tests cover deployment eligibility, disabled mentions, payload limits, actual request construction, receipt suppression, credential destination validation and HTTP failure behavior. No game UI or browser runtime changes are made by this feature.

References: [Discord webhooks](https://github.com/discord/discord-api-docs/blob/main/developers/resources/webhook.mdx), [GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [receipt artifact API](https://docs.github.com/en/rest/actions/artifacts).
