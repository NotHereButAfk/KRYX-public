# Bot skill upgrade decisions

Normal reaction is 180-300ms and hard 120-220ms; both retain gradual aiming and world-space miss error. Hard turning now exceeds normal.
Visual motion samples predict only the age of a sighting, up to 120ms/1.5m. No projectile lead for hitscan. Target changes, teleports, long gaps and reacquisition reset velocity. Hidden sightings remain frozen.
Bots aim at center mass (server samples crouch/slide stance), reposition about 75% of close combat, use weapon-range-aware pursuit, shorter bursts pauses, and seek cover earlier when hurt. Existing navigation, ledge checks, speed, health, damage and ammo are retained.
Copilot helper and test proposals contained duplicate paths and were rejected by the supervisor. Manually reviewed nonempty files were salvaged; prediction timestamp/math and mismatched test expectations were corrected before integration. Antigravity failed compatibility preflight; Groq refused expired Free-plan confirmation. No paid provider, quota bypass, OpenRouter or local inference used.
Codex performed integration, corrective edits and verification after these provider failures. Studio run: 2026-11-03T11-22-24-022Z-bdbb0fe3 (failed proposals, not automatic integrations).
