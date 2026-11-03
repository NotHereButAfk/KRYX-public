# Existing baseline issues

Reproduced on unchanged f4aa5eb: bot_presentation_check requires obsolete colored plates; ev_character_check expects walk instead of run clip; net_presentation_check expects action weight >.99. Economy multiplayer fixture fails schema/JSON setup. One baseline patrol run failed checkpoint goal count; upgraded full map patrol run passed.
These unrelated baseline failures are not silently changed or represented as passing. Broad check and browser results are recorded in INTEGRATION.md after completion.

## Lighting scope and limits

Copilot's two lighting jobs returned duplicate path entries and were rejected as invalid_output. The implementation draft was manually corrected and integrated; test output assumed nonexistent APIs and incorrect ownership, so its assertions were rewritten against real behavior. Antigravity remained version-preflight blocked; Groq free-plan confirmation expired. No guards were bypassed and no paid/local fallback was enabled.

Architectural shadow maps span the full arena, so edges are coarser on medium than high. Moving players/bots intentionally do not cast into the static cache. Software-rendered browser QA verifies behavior and visuals, not a real-device frame-rate promise. Existing release failures from the bot task still apply; no main deployment is claimed.


## Spawn protection followup

Copilot produced a schema-valid spawn test proposal, but review caught incorrect imports, a callable-tick assumption and a confused tick rate. The usable client fixture was retained and server assertions corrected before integration. An initial ARM-runtime health-regeneration fixture failure did not reproduce in matched x64 baseline/current runs; no regeneration code changed.
