# KRYX Audio Follow-up

## Current scope

The current sound-effects follow-up for KRYX covers both repositories. Firearms now use nine distinct procedural firearm reports, cached in four variants: short attacks, textured bodies, mechanical tails, and quiet early reflections. Trailing gun-buffer silence is trimmed with an 8 ms pad. Existing same-peak normalization and the master limiter remain in place.

The recorded Kenney CC0 footsteps retain their assets and gain; their playback low-pass cutoff rises from 1900 to 2600 Hz for clearer sole detail. HRTF inverse attenuation is preserved. Distance air absorption is smoothed from 18000 Hz at 4 m to 2400 Hz at 85 m, with cover capping the cutoff at 2200 Hz and applying 0.68 gain. Sources beyond 85 m are culled before allocation and raycast. The existing limit of 12 occlusion queries per 50 ms budget is preserved.

The 32 shared voices now steal the lowest eligible priority first, then the oldest voice within ties. Local gun and hit sounds at priority 3 are protected from remote Foley at priority 0.

New short positioned wall impacts use the existing confirmed-endpoint, tracer-arrival, and map-generation gates, with a 45 ms rate cap. They do not create predicted multiplayer hits, new damage, or wall scans. Exactly 2 s of spawn protection and pause vulnerability are unchanged. No multiplier claim is made.

## Validation and release status

The validation record covers 100 PCM renders at two rates with deterministic, finite output and headroom checks, plus ambient lifecycle, mute, cover cleanup, bullet-endpoint/player-air rejection, and tracer-timing checks. These are engineering validation results; actual tests and build results belong in the integration record.

Browser validation passes real gesture unlock, mute/volume, HRTF sides/distance, 101-shot overload, desktop keyboard/mouse, settings save/reload and mobile Play/context unlock. Paired 26 s WAVs with the same 27-event timeline support user comparison. Headless measurements are not proof of physical-device listening or Safari behavior.

Both feature PRs—17 private and 1 public—remain drafts because of existing unrelated release-gate failures. Nothing is deployed live. Earlier Copilot drafts returned duplicate file entries; the corrected snippets were manually reviewed and integrated.