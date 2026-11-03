# Discord game update bot

Status: publisher configured for the owner's selected server/channel (1519626567041417296 / 1519628887246639187). GitHub secret metadata confirms DISCORD_CONFIG_JSON exists; its token value was not retrieved. Seven mocked HTTP tests pass. Live permissions/delivery and main deployment remain unverified; no live Discord post has been sent.

## Assigned studio role

Copilot is the Release Notes Editor (studio role: documentation). For each game update, inspect the actual diff and replace release/game-update.json with a NEW immutable id, short title and 1-12 truthful player-facing changes. Never reuse an id for changed text, promise untested improvements, include credentials/private links or claim drafts are live. Codex reviews the notes and synchronizes both repos before release. This is an on-demand studio assignment, not an unattended AI service. Dispatch with existing allowance/tool denial; never bypass auth, cooldown or free-plan guards. If unavailable, Codex prepares/reviews the notes and records the fallback.

The first bounded Copilot assignment was refused by the studio as unavailable/cooling down (run 2026-11-03T13-53-55-283Z-ee3446b6). No proposal was accepted; Codex implemented the publisher and tests locally. No paid provider was enabled.

## Automatic publishing

The Discord game updates workflow runs after a successful Deploy to VPS push deployment on main. Draft branches, failed deployments, forks, public-mirror runs and manual service audits do not post. It checks out the deployed commit and sends its reviewed release/game-update.json. Only NotHereButAfk/Ev.io sends; the public repo mirrors the implementation. This leaves the existing tournament Discord integration unchanged.

The publisher reuses the existing Discord bot via DISCORD_CONFIG_JSON and the fixed owner-selected channel. A webhook remains an optional fallback. No gateway process, AI API bill or new bot permissions are required by the code. GitHub Actions runner usage remains subject to the repository's existing plan; no billing settings were changed.

Successful receipt artifacts suppress repeat release ids for their 90-day retention period. Posts are serialized. This is NOT an exactly-once guarantee: an interrupted send/receipt upload or expired/deleted artifact can allow a duplicate. Inspect the channel before rerunning an uncertain failure. HTTP failures, including rate limits, fail without automatic POST retries. An unchanged release id is intentionally skipped while its receipt exists, so the editor must supply a fresh note for every game update.

## Activate

1. Destination: https://discord.com/channels/1519626567041417296/1519628887246639187 . The existing bot must be able to view and send messages in this channel; permissions are not yet live-verified.
2. The primary repository already has a DISCORD_CONFIG_JSON Actions secret by name. The publisher reads DISCORD_BOT_TOKEN inside it, without logging the credential. No secret value was inspected or changed. An optional DISCORD_UPDATES_WEBHOOK_URL is used only when DISCORD_CONFIG_JSON is absent.
3. Merge the reviewed workflow and notes to main when the game's release gates permit. The next successful main push deployment posts the prepared update. Failed/missing credentials fail the announcement job visibly without rolling back deployment.
4. Confirm the message in the chosen channel and receipt in Actions. Bot requests also use Discord's recent-message nonce protection, but long-term duplicate limits remain as described above. Live delivery has not yet been tested.

## Checks and preview

Run node --test tests/discord-updates.test.mjs. Set DRY_RUN=1 and run node tools/discord-updates.mjs to preview without network or credentials. Tests cover deployment eligibility, disabled mentions, payload limits, actual request construction, receipt suppression, credential destination validation and HTTP failure behavior. No game UI or browser runtime changes are made by this feature.

References: [Discord webhooks](https://github.com/discord/discord-api-docs/blob/main/developers/resources/webhook.mdx), [GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [receipt artifact API](https://docs.github.com/en/rest/actions/artifacts).
