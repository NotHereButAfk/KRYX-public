# E economy

E is an internal in-game currency. No conversion, external currency integration,
redemption, wallet, or payment flow is connected to E.

## Architecture and compatibility

- `server/economy/calculate.mjs` is the shared authority for previews and final
  rewards. Four-place BigInt fixed-point arithmetic (`money.mjs`) returns decimal
  strings. PostgreSQL stores balances/amounts as NUMERIC(18,4).
- `config.mjs` defines validated defaults and supported actions. Each action has
  independent normal score, `earnsE`, and Survival wave eligibility. The global
  `E_PER_100_SCORE` never changes normal score values.
- `runtime.mjs` tracks validated activity, contributions, multipliers, boss
  instances, and pending earnings. `store.mjs` journals active matches and owns
  every E balance write. A unique (match_id,user_id) finalization plus per-type
  ledger keys prevent duplicate payments. A user row lock serializes daily caps
  and balance changes across rooms. Inserts, balance updates, daily totals and
  finalization records commit together or roll back together.
- `001_e_economy.sql` is additive and runs after existing account tables finish
  initialization. Re-running it is safe. Account IDs, passwords, stats and owned
  server skins are retained. Editable browser `sio_shop` coins/ownership remain
  legacy local data, not a source of permanent E or earning item entitlement.
- Authenticated WebSocket identities come from the existing HttpOnly session
  cookie. Neither a display name nor local login state proves E eligibility.
  Guests cannot earn E, including with legacy guest-enabled configuration. Signing out stops further earnings immediately; legitimate pending earnings from before sign-out remain eligible for match finalization.

## Gameplay

The production process hosts FFA, Team Slayer and Survival using the same
origin (`?mode=teamslayer`, `?mode=survival` on WebSocket/discovery URLs). Team
Slayer disables friendly fire and ends at 50 team kills or ten minutes.
Survival reuses the authoritative collision/combat simulation, with advancing
waves, melee enemies, server-owned boss health/damage and one-shot direct rewards.
The old local Survival path remains usable offline, without permanent E.

Server kills and five-second damage assists award normal score and eligible
score independently. Objective/match-specific handlers can call the server-only
`EconomyRuntime.objective()` / `award()` methods after their own simulation checks.
There is no client objective/score/boss-reward message. Existing CTF/KOTH are
marked coming-soon in the game; their configurations and generic action hooks
are ready, but this economy does not invent those objective game modes or a
Battle Royale implementation. Unimplemented/local modes cannot mint E.

Default protection: registered account, two active humans, 60-second match,
20 seconds active participation, 100 score, no ordinary bot earnings, 30-second
AFK threshold, 30 kills/minute anomaly threshold, repeated-victim reductions
(5 full, next 5 half, thereafter zero within 180 seconds). Player score remains
independent of suppressed E. Daily cap is 5,000 E, match cap 500 E and rate cap
200 E/minute of participation. All are administrator configurable; caps can be
removed except the independently configured earning-rate bound.

Survival waves use 1.0× for 1–9, +0.10 every ten waves, capped at 1.50×. Assists
ignore this multiplier by default. Bosses support independent score/direct E,
spawn chance (0.001 = 0.1%), minimum wave, health, damage and mode restrictions.
The example Relic boss is disabled until configured by an admin. Direct rewards
are not multiplied, and still obey participation checks and caps.

Item slots are character and weapon, selected through /earnings and verified
against server-owned inventory. Two legendary +15% items produce 1.30× under
additive stacking. Multiplicative stacking is supported. Item configuration and
equipment are snapshotted at match join; changes affect subsequent matches.
Boosters can target account IDs, times, modes, match counts and sources. Match
uses are reserved transactionally, including reconnects. Non-stackable boosts
compete with the combined stack; only the strongest applies. Events can override
caps/win rewards, enable selected bosses and add direct reward drops through
`directE` plus `directDropChance`. Event and booster eligibility uses server time.
All config changes take effect for new matches, preserving current-match rules.

## Durability and operations

Pending match journals are checkpointed every five seconds, on disconnect and
at round end. A graceful SIGTERM/SIGINT closes the match and settles earned E.
On restart, an advisory lock for the stable server ID prevents competing
recoveries; unfinished journals close at their last checkpoint and finalize once.
An abrupt process/host failure can lose the uncheckpointed tail (up to five
seconds); it cannot duplicate committed rewards. Database writes retry transient
failures three times, then E fails closed while normal gameplay continues. Durable
closed journals can be recovered on restart; the HUD reports E unavailability.

A stable unique `E_SERVER_ID` is required per public process (default public-1);
secondary room IDs are derived from it. Never reuse it for simultaneous replicas.
Use the existing `ACCOUNT_DATABASE_URL`. Grant admin access by setting
`E_ADMIN_USER_IDS` to a comma-separated list of existing registered numeric user
IDs in the service environment; no user-supplied role is trusted. All mutation
routes check same origin. Admin changes use revision checks and an audit trail.

When a trusted reverse proxy is in front of Node, set `E_TRUST_PROXY=1` ONLY when
that proxy overwrites/sanitizes X-Forwarded-For and direct untrusted access to Node
is blocked. Otherwise the socket peer is used. Set a private `E_NETWORK_SALT` for
network pseudonyms. Shared-network farming flags do not automatically ban anyone;
admins can allow shared-network earning for managed LAN households if appropriate.
No fingerprinting or device identifiers are collected.

## UI and endpoints

- `/earnings`: server balance/session/daily progress, owned earning equipment,
  config-priced E purchases, recent summaries and the last 100 transactions.
- `/economy-admin`: global/action/mode/Survival/item/booster/event/boss editors,
  account ledger lookup, recorded adjustments/full purchase refunds, review flags.
- `GET /api/e/me`, `/history`: authenticated self only.
- `POST /api/e/equip`, `/purchase`: owned/configured IDs, never client prices.
- `/api/e/admin/config`, `/review`, `/ledger`, `/adjust`: admin only.
- No add-E or client match-completion endpoint exists. All permanent changes
  have MATCH_EARNING, WIN_REWARD, BOSS_REWARD, EVENT_REWARD, ADMIN_ADJUSTMENT,
  SHOP_PURCHASE or REFUND ledger records.

The live overlay shows pending E, session total, balance and daily progress.
Individual notices combine repeated rewards. The post-match dialog displays only
nonzero categories and shows the committed final E and balance. Display rounding
is two decimal places; calculations/storage retain four.

## Verification

`npm run test:economy` runs fixed-point arithmetic and configuration scenarios,
real embedded PostgreSQL migrations/transactions/rollback/idempotency,
reconnect/farming protection, production assist/Survival/team combat hooks and
HTTP account/admin/CSRF/replay checks. The embedded database uses a single
connection; deployment PostgreSQL provides the row locking for concurrent hosts.
`node tools/economy_ui_check.mjs` verifies admin forms, account views, escaped
ledger text and the mobile earnings summary using deterministic API fixtures.
Set E_UI_SHOTS to save screenshots. Physical-device gameplay feel and production
DB backup/restore policies remain operational responsibilities.
