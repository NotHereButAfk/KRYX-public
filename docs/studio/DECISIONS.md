# Bot skill upgrade decisions

Normal reaction is 180-300ms and hard 120-220ms; both retain gradual aiming and world-space miss error. Hard turning now exceeds normal.
Visual motion samples predict only the age of a sighting, up to 120ms/1.5m. No projectile lead for hitscan. Target changes, teleports, long gaps and reacquisition reset velocity. Hidden sightings remain frozen.
Bots aim at center mass (server samples crouch/slide stance), reposition about 75% of close combat, use weapon-range-aware pursuit, shorter bursts pauses, and seek cover earlier when hurt. Existing navigation, ledge checks, speed, health, damage and ammo are retained.
Copilot helper and test proposals contained duplicate paths and were rejected by the supervisor. Manually reviewed nonempty files were salvaged; prediction timestamp/math and mismatched test expectations were corrected before integration. Antigravity failed compatibility preflight; Groq refused expired Free-plan confirmation. No paid provider, quota bypass, OpenRouter or local inference used.
Codex performed integration, corrective edits and verification after these provider failures. Studio run: 2026-11-03T11-22-24-022Z-bdbb0fe3 (failed proposals, not automatic integrations).

## Lighting decisions

Active maps contain no baked lightmaps. Lambert diffuse shading replaces hard Toon bands; authored colors, textures and emissive inputs remain intact. Tone mapping now applies consistently on medium/direct and high/composer paths. Existing ACES exposure is adjusted to .92; Fractal has extra cool fill for corner visibility. The sky is a lightweight world-oriented gradient with a restrained sun glow and no external assets.

Use one cached sun shadow map (1024 medium, 2048 high), refreshed only for map/quality changes. Render only opaque architecture into the cache: temporarily suppress non-map casters and restore in finally. Three tests the main camera layers during shadow rendering, so shadow-camera layers cannot filter characters. Invisible type3 material groups become visible=false; mixed meshes retain their visible opaque groups. Low quality releases the shadow target. No SSAO, additional point lights or per-frame shadow passes. Viewmodels share existing PMREM resources and updated directional targets.
