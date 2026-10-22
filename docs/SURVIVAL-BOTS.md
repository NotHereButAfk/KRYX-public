# Survival AI

Public Survival is human players versus zombie enemies. Empty survivor seats stay empty; automatic friendly soldier bots are disabled, including in older server configuration files. The capacity remains 10 human participants.

The ally implementation below is retained for explicit test fixtures and development simulations. It is not enabled by the production config loader.

## Existing systems reused

`SurvivalRoom` extends the existing authoritative room. Allies submit ordinary
MoveSim inputs and server fire requests, using the real weapon catalog, hitscan,
ammo, reserve, reload, health, shield, deaths and replication. They do not get
the legacy FFA bot stamina refill or target-snapping fire adjustment. Exhausted
guns fall back to the normal sword. Difficulty never changes weapon damage.

Every entity retains `isBot`; `survivalEnemy` identifies PvE entities and
`survivalAlly` identifies participant bots. Participant filtering drives capacity,
the scoreboard, survivor checks and replacement. Enemy perception, movement and
damage target both humans and allied bots. Existing FFA behavior is unchanged.

## Behavior

`survival-bot-ai.mjs` implements spawn, roam, search, engage, chase, retreat,
regroup, intermission and death. Perception is staggered and limited to a small
candidate budget. Acquisition requires distance, FOV and line of sight; shooting
checks current LOS and smoke. Lost targets use a time-limited last-seen point,
not their hidden live position. Low enemy counts increase the visual search
range and encourage independent patrols without revealing enemies through walls.

Reusable threat scoring prioritizes personal danger, attacks on nearby humans,
bosses, fast/ranged types and weak close targets. Cooldown and hysteresis prevent
constant switching. Bots turn gradually, miss physically, fire variable bursts,
strafe, maintain weapon-specific spacing, and retreat from crowds/low health.
Exposed enemy `dangerZones` are avoided if supplied by future boss mechanics.

Navigation reuses the arena ground/raycast queries and existing reachable patrol
sampling. A bounded local search adds routes around obstacles, checking elevation
at each step rather than connecting separate floors. Route work is limited to
one bot per server tick, a node budget and a time budget. Grounded steering avoids
edges; friendly separation spreads bots out. Failed movement retries routes and
temporarily drops unreachable targets. Only after the longer recovery timeout
may it reposition to a validated previous safe point or authored spawn. This is
local navigation, not a precomputed global navmesh; unusual geometry should be
covered by additional map-specific playtests.

## Waves, replacement and lives

The default retains the existing no-respawn Survival rule. Optional `wave`
respawns and limited lives apply equally to humans and allied bots. No refill
occurs just because a bot dies. Dead bots remain on the scoreboard. A disconnect
filled during an active wave creates a dead replacement, preventing extra lives
from repeated departures. Such replacements wait for the configured wave respawn
or the next match. Incoming humans replace dead bots first, then bots farthest
from combat; humans are never removed to make a seat. Intermission naturally
provides the least disruptive time for an active replacement.

Wave clear updates waves survived, reload/regroup behavior and the intermission.
Game over stops combat, displays its HUD state for the configured pause, then
uses the existing authoritative round/results/map reset. Names come from the
configured list with unique suffixes only when needed. The scoreboard excludes
enemies and includes real kills, assists, damage, boss damage and waves survived.

## Server configuration

Set `SURVIVAL_BOT_CONFIG` to the absolute path of a JSON file and restart the game
service. Only overrides are required; defaults and validation live in
`server/survival-bot-config.mjs`. Invalid configuration stops startup instead of
silently accepting unsafe values. For example:

```json
{
  "desiredParticipants": 10,
  "maximumBots": 9,
  "difficulty": "normal",
  "survivalFriendlyBots": true,
  "botsCountAsAlive": true,
  "respawnRule": "wave",
  "limitedLives": 3,
  "weapons": ["m4", "levershotgun", "boltsniper"],
  "names": ["Vortex", "Cipher", "Ranger", "Echo"]
}
```

Other settings cover perception, FOV, reaction/memory, switch thresholds,
accuracy/spread/tracking, burst timing, retreat/spacing, scans/path budgets,
stuck/recovery delays and capped wave scaling. Supported difficulties are easy,
normal and hard. Scaling improves reaction by at most 15% by default and does
not make aim perfect. Leave the override file outside the rsynced server folder
so deployment cannot delete it.

For development debugging, both `NODE_ENV=development` on the server and
`debug: true` are required. Development clients show a text diagnostic panel
with bot state, target, threat, range and path points. Production packets omit
these diagnostics even if a browser supplies a QA query.

## E and verification

Bots never join the economy's account/participant journal and never hold a
balance. Their kills generate normal score only. Real player PvE kills and
assists use the existing server E rules, active-human minimum, caps and match
validation. Bots do not satisfy the active-human minimum. Participant kills
cannot earn E, including when friendly fire is explicitly enabled. Boss rewards
cannot be claimed by a bot account because no such account is created.

`npm run test:survival-bots` checks filling/replacement, enemy roles, friendly
fire, LOS, reaction, actual damage/ammo/movement, lives, survivor rules, navigation,
scoreboard, E isolation and a real imported-map 10-bot/30-enemy tick workload.
Existing combat, economy and release certification remain regression checks.
