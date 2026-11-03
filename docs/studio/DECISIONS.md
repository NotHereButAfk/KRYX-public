# Bot skill upgrade decisions

Normal reaction is 180-300ms and hard 120-220ms; both retain gradual aiming and world-space miss error. Hard turning now exceeds normal.
Visual motion samples predict only the age of a sighting, up to 120ms/1.5m. No projectile lead for hitscan. Target changes, teleports, long gaps and reacquisition reset velocity. Hidden sightings remain frozen.
Bots aim at center mass (server samples crouch/slide stance), reposition about 75% of close combat, use weapon-range-aware pursuit, shorter bursts pauses, and seek cover earlier when hurt. Existing navigation, ledge checks, speed, health, damage and ammo are retained.
Copilot helper and test proposals contained duplicate paths and were rejected by the supervisor. Manually reviewed nonempty files were salvaged; prediction timestamp/math and mismatched test expectations were corrected before integration. Antigravity failed compatibility preflight; Groq refused expired Free-plan confirmation. No paid provider, quota bypass, OpenRouter or local inference used.
Codex performed integration, corrective edits and verification after these provider failures. Studio run: 2026-11-03T11-22-24-022Z-bdbb0fe3 (failed proposals, not automatic integrations).

## Lighting decisions

Active maps contain no baked lightmaps. Lambert diffuse shading replaces hard Toon bands; authored colors, textures and emissive inputs remain intact. Tone mapping now applies consistently on medium/direct and high/composer paths. Existing ACES exposure is adjusted to .92; Fractal has extra cool fill for corner visibility. The sky is a lightweight world-oriented gradient with a restrained sun glow and no external assets.

Use one cached sun shadow map (1024 medium, 2048 high), refreshed only for map/quality changes. Render only opaque architecture into the cache: temporarily suppress non-map casters and restore in finally. Three tests the main camera layers during shadow rendering, so shadow-camera layers cannot filter characters. Invisible type3 material groups become visible=false; mixed meshes retain their visible opaque groups. Low quality releases the shadow target. No SSAO, additional point lights or per-frame shadow passes. Viewmodels share existing PMREM resources and updated directional targets.


## Spawn protection followup

Share SPAWN_PROTECTION_SECONDS=2 between server tick deadlines and the local Player wall-clock deadline. Only respawn starts the local timer. Game damage routing checks it before hurt feedback, irrespective of menus. Preserve existing self-explosive and kill-plane behavior; loading/spectator exclusions remain separate from active-player immunity.


## Sound effects followup

Keep synthesis cached in four seeded variants per event and the existing master limiter. Use one HRTF bus per event with the existing lifecycle and ray-query budget; distance adds a low-pass filter, not a second inverse gain law. Cull beyond 85 m before allocating. Wall sounds follow already-confirmed tracer endpoints and share a 45 ms cap. Preserve finite voice budget32; evict lowest eligible priority then oldest. Trim gun-buffer silent tails with8 ms padding. Details: [AUDIO.md](AUDIO.md).

## Final engagement decisions

Use the player weapon catalog for all four bot firearm roles and sword values. Retain the ordinary shared cooldown as the sole server fire clock; rounding a second bot timer up to whole ticks incorrectly slowed M4/Uzi. Local cooldown preserves fractional frame overshoot and cannot bank idle shots. Battle Rifle consumes and fires up to three remaining rounds with independent ray spread and nearest head/body intersections.

Strafe direction persists until geometry or a threat changes the decision. A bounded cached floor/collision/sight probe chooses a clear side or retreat; it can hold when every safe lane is blocked. No time-based stop beats or forced burst breaks remain. After reload, retrace the last clear firing position before pursuing enemy memory. Target changes clear cover, return and lane state/deadlines; repeated hits from the same opponent preserve intent. Awareness uses 140 degrees plus nearby 10-metre peripheral sight, actual visibility and no arbitrary distance cap. See BOT-ENGAGEMENT.md.


## Discord update bot

Use a lightweight webhook bot after successful main push deployment. Private repo is the sole sender. Reviewed immutable release ids and receipt artifacts reduce duplicate posts; no background paid AI calls.
