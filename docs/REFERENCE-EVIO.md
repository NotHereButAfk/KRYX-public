# ev.io — what we actually know

This project takes inspiration from **ev.io**, a browser arena FPS. Features
here get justified with "that's how ev.io does it" fairly often, so this file
exists to record how much of that is actually knowledge and how much is
guesswork.

**Why it matters.** Access differs by tool and session. Shell HTTPS has been
restricted in some environments, but on 2026-07-27 the Codex in-app browser
reached official ev.io map pages and third-party gameplay galleries/videos.
Those sources are now recorded below. They verify visible art direction, not
movement constants, damage values, exact dimensions, or current live balance.
The game has also been live and patched since ~2021, so undated footage may
show an older build.

The repo owner can play the live game and supplied a gameplay-observation
session. **When current owner observation and older web media disagree, use the
owner's observation.**

---

## Confidence levels

Everything below is tagged:

- **[known]** — widely and consistently documented; safe to rely on
- **[verified]** — directly inspected in a linked source on the date recorded
- **[likely]** — probably true, but not verified against the live game
- **[unverified]** — plausible recollection; do NOT build numbers on this
- **[ours]** — a decision this project made, not something ev.io does

---

## The game in outline

- **[known]** Browser FPS, Unity WebGL, free to play, out around 2021. Runs in
  a tab with no install.
- **[known]** Arena shooter with a Halo lineage — this repo's own tagline
  ("The Halo of Web3") reflects the same framing.
- **[known]** Recharging energy shield layered over health. Both come back
  after a break in damage.
- **[known]** Headshots matter; time-to-kill is fast.
- **[known]** Cosmetics tied to Solana; a shop, ranked play, an in-game
  currency.
- **[likely]** Vertical maps with grav lifts / jump pads, and a short-range
  dash or blink on a key.
- **[likely]** A sniper rifle is a signature weapon.

## Verified visual reference pass — 2026-07-27

Directly inspected sources:

- **[verified]** Official ev.io map pages and their large map images:
  [Jinx](https://ev.io/node/752), [Rook](https://ev.io/node/755),
  [Depot](https://ev.io/node/634), [Vestige](https://ev.io/node/661), and
  [Momentum](https://ev.io/node/682).
- **[verified]** The owner selected
  [Winter-Graveyard](https://ev.io/node/644) as the active-map target. Its
  official large image and `XmasGraveyard_1.evmap` download were inspected
  directly. The page identifies the Snow environment effect and Arctic
  background track.
- **[verified]** The owner subsequently supplied
  [Daytime Rook](https://ev.io/node/755) as the new active-map target. Its
  official `RookLitJPEG_0.jpg` large image and `RookLit_0.evmap` download were
  inspected directly. On 2026-07-28 the owner explicitly rejected a recreation
  and requested that the downloaded map itself be used. The complete 5,689,585
  byte version-3 asset is now shipped in `public/maps/`; its runtime decoder was
  implemented from the public ev.io 1.7.0 client and consumes the file with no
  unread bytes. The page identifies Dust as its environment effect and lists
  CTF, Deathmatch, Instagib and Team Deathmatch.
- **[verified]** The [Browser Craft ev.io page](https://browsercraft.com/game/ev-dot-io)
  exposes six 640x360 gameplay stills and embeds three YouTube gameplay videos
  (`HwdzCEbgxEQ`, `65nU5yZxavw`, `hMx-QmsWV7o`).
- **[verified]** A fourth embedded gameplay clip was inspected from the
  [Play123 ev.io page](https://www.jeux123.fr/jeu/ev-io)
  (`79pVgYAvpd8`).
- **[owner-observed]** The owner supplied live gameplay for Codex to watch.
  The arena used for this project's layout pass was identified as Jinx, then
  cross-checked against the official Jinx image above.

Visible motifs that repeat across those sources:

- **[verified]** Chunky modular walls and towers frame open sky/voids rather
  than forming one continuous indoor box.
- **[verified]** Narrow cyan, red, gold, or orange route accents sit on edges,
  seams, and wall slits; most structural surfaces stay matte.
- **[verified]** Maps mix broad combat courts with compressed side canyons,
  elevated bridges/ramps, and framed long vistas.
- **[verified]** Large focal props—circular platforms, statues/plinths, halo
  gates, or portal rings—make a route recognizable at a glance.
- **[verified]** Oversized environmental signs/logos and asymmetric accent
  zones help orient players.
- **[verified]** Material families include pale/white stone, warm tan or orange
  segmented panels, dark technical bases, and occasional saturated red floor
  channels.

Visible animation and combat-feedback cues:

- **[verified]** Gameplay stills consistently keep status/ability controls at
  the lower left, ammunition at the lower right, and the match timer at the top
  centre. These elements are mostly edge-aligned text, bars, and small key
  chips rather than a stack of large bordered panels.
- **[verified]** The first-person weapon stays low-right with restrained
  movement sway and small, responsive recoil rather than large constant bob.
- **[verified]** Reloading is a readable state: the weapon lowers out of its
  ready pose while a top-center progress bar advances, then returns to aim.
- **[verified]** Hits show floating damage values. Eliminations add a central
  skull/kill confirmation and a separate score value; headshots receive a
  stronger central callout.
- **[verified]** Kill-feed entries remain at the upper left while the central
  confirmation supplies the immediate action/reward beat.
- **[verified]** Respawn footage visibly announces a short invincibility period.
  This is evidence for a gameplay feature, not enough evidence to invent its
  timing or add it without server-authoritative support.

Official character-skin reference pass — 2026-07-29:

- **[verified]** ev.io's public developer API documents
  [`/all-skins`](https://ev.io/all-skins) as the non-comprehensive live item
  catalog and points to individual character nodes such as
  [Kijo](https://ev.io/node/308).
- **[verified]** Official character pages inspected include
  [Paladin](https://ev.io/node/285), [Mirage](https://ev.io/node/295),
  [Anubis](https://ev.io/node/166), [Neon](https://ev.io/node/163),
  [Ursus](https://ev.io/node/265), [Nexus](https://ev.io/node/317), and
  [Oni](https://ev.io/node/162). The pages expose their large/profile
  thumbnails, rarity, animation family, faction and proprietary `.evskin`
  download.
- **[verified]** Across the official thumbnails, recurring character language
  is a dark flexible undersuit under segmented hard armor, two- or three-color
  plate blocking, a narrow visor/eye glow, and one recognizable helmet motif
  such as horns, ears, fins/crown rails or a skull-like face.
- **[ours]** KYX.IO does not download or redistribute those proprietary
  character models. Its eight new character finishes are original palettes and
  small procedural helmet motifs applied to the existing rigged soldier, so
  every locomotion/action animation remains compatible.

Authored Rook pickup evidence:

- **[verified]** The official `RookLit_0.evmap` contains exactly four generic
  marker records (kinds `524288`, `8388608`, `1048576`, `2097152`) at authored
  coordinates `(40,18.75,64)`, `(0.5,18,-0.75)`,
  `(-100,17.5,24.02)`, `(28.5,10.75,-46)`. The loader mirrors X when
  converting to the game's Three.js coordinates, just as it does for geometry
  and player spawns.
- **[ours]** The marker-to-local-gun assignment (Rail Driver, Nova Launcher,
  Fuel Rod, Concussion Rifle) is a deterministic KYX.IO design choice. The
  public asset verifies positions and elevations, not the intended ev.io weapon
  identity for each marker kind.

Owner-directed bot behavior:

- **[owner-observed, clarified 2026-07-29]** Arena bots should actively acquire
  opponents rather than wait to be shot, fight other bots as well as the human
  player, change strafe direction during gunfights, reposition vertically, and
  pursue briefly after losing sight.
- **[ours]** Exact detection radii, spacing bands, jump timing, reaction time,
  burst length, aim scatter and damage remain KYX.IO tuning choices. The visual
  reference does not reveal ev.io's internal AI constants.

These cues were checked frame-by-frame in
[`65nU5yZxavw`](https://www.youtube.com/watch?v=65nU5yZxavw),
[`HwdzCEbgxEQ`](https://www.youtube.com/watch?v=HwdzCEbgxEQ), and
[`hMx-QmsWV7o`](https://www.youtube.com/watch?v=hMx-QmsWV7o) on 2026-07-27.

**[ours, implemented 2026-07-27]** The game now answers those visible cues with
a three-beat rigid-viewmodel reload, timed reload bar, viewmodel landing impulse,
central elimination/headshot score confirmation, shared remote fire recoil,
short visual-only death fall, and teleport-style respawn reform. Mechanics and
server timing remain unchanged.

**[ours, implemented 2026-07-29]** The gameplay HUD now follows that visible
edge hierarchy: slim HP/shield/energy bars and compact grenade/blink keys at
lower-left, small weapon-switch chips at bottom-centre, standalone ammunition
at lower-right, a quiet top-centre timer, and a single-line match summary. This
is a visual adaptation to KYX.IO's existing information and controls, not a
claim of pixel-identical ev.io UI.

**[ours, implemented 2026-07-29]** Arena bots now play an active free-for-all:
nearest-opponent targeting prevents a 7v1 against the user; ranged bots
close/orbit/retreat and fire short imperfect bursts; melee bots rush; all bots
can jump, use lifts/teleporters, recover from collision stalls, and search the
last visible position without shooting through cover. Bot scoreboard kills are
now earned by simulated combat rather than seeded display values.

Implementation boundary: these cues justify this project's visual treatment.
They do **not** verify arbitrary ev.io layouts or gameplay constants. The
downloaded official Rook binary is a direct source for that map's geometry,
collision, player spawns and four generic marker positions.

## What we do NOT know

Do not invent values for any of these. If a change depends on one, ask the
owner — they can check in a minute what an agent cannot check at all.

- Movement constants: acceleration, friction, air control, whether momentum
  carries between jumps
- Whether it has Quake-style strafe-jump acceleration **(previously asserted in
  this project as fact — it was not verified, and should not have been)**
- Dash distance, cooldown, charges
- Weapon damage, fire rates, magazine sizes, TTK
- Map dimensions, layouts, sightline lengths
- Movement speed in m/s, jump height, gravity

## Corrections already made

Recording these so the same mistake isn't repeated:

- **"ev.io is a movement shooter where good players air-strafe to multiples of
  base speed."** Asserted confidently in Jul 2026 and used to justify a proposed
  movement rework. **Unsupported.** The underlying observation about *our*
  controller was fine and stands on its own — `velocity.x = desired.x` with a
  hard 9.6 m/s cap means no momentum and no skill expression in movement — but
  it should never have been dressed up as a fact about ev.io.

- **`src/world/World.js` arena, described in CLAUDE.md as reconstructed from a
  gameplay capture (`codex/evio-arena-recreation`).** **Settled 2026-07-27:**
  the owner supplied gameplay for Codex to observe; the layout was identified
  as Jinx and cross-checked against the official Jinx image. It remains a
  recreation adapted to this game's topology, not a measurement-perfect copy.

- **Active map target.** **Updated 2026-07-28:** Daytime Rook now loads the
  official `RookLit_0.evmap` directly. Do not reactivate the screenshot-led
  `_buildRookArena()` approximation. `EvMapLoader.js` owns the native format,
  materials, scene graph, spawn orientation and collision extraction.
  Winter-Graveyard remains as an inactive historical builder.

---

## For the owner to fill in

If you want agents to match ev.io more closely, these are the answers that
would actually change what gets built. One line each is plenty.

- [ ] Does speed build up as you chain jumps, or is it capped like ours?
- [ ] Roughly how long does a 1v1 last at mid range?
- [ ] Dash: how far, how often, how many charges?
- [ ] Is the shield a separate bar, and roughly how long until it recharges?
- [ ] How big is the viewmodel on screen compared to ours?
- [ ] Anything about it that feels good and obviously isn't in our game yet?

A short screen recording answers most of this faster than writing it out.
Agents can also compare supplied frames against the linked visual sources
above.

---

## The rule

**Don't state ev.io behaviour as fact in code comments, commit messages or docs
unless it's tagged [known]/[verified] here or the owner told you.** Write "our
design choice" instead — visual evidence is not evidence for mechanics.

---

## September 2026 follow-up evidence

## September 7–8, 2026 browser observations

Reference: https://ev.io/ viewed through the user's Edge browser and the
Codex in-app browser. These are visual observations, not recovered source
constants or a complete gameplay certification.

- Observed first-person rifle: lower-right placement, rear cropped by the
  bottom edge, support glove/forearm visible beneath the forward receiver.
  The rifle is viewed along its length rather than as a broad side profile.
- A firing input was followed by 49 rounds remaining. This confirms a shot,
  not the full recoil envelope, fire cadence, or input latency.
- Observed loading labels included Connecting to game server and Building
  map, followed by the map menu with Click to Play.
- Observed menu camera background was blurred; gameplay was not.
- In-app EV.IO gameplay entry produced a pointer-lock error. Its spectator
  mode worked. Native Edge reached a first-person view, but sustained movement
  and held right-click aim were not reliably tested with the available controls.

## Not verified

Exact FOV, camera height, gun transforms, ADS transition, animation curves,
collision dimensions, movement speed and per-weapon grips remain unmeasured.
Do not call KYX a 1:1 match based on these observations or automated tests.

## KYX corrections derived from the comparison

- Retain the support hand for weapons whose shared grip profile requires it.
- Continue the first-person shoulder sleeve outside the camera instead of
  exposing its cut end; leave glove and forearm contact vertices unchanged.
- Move the firearm mount right and reduce its side-facing yaw without changing
  mesh shape or third-person weapon scale. These offsets are KYX design choices.

Full-body art refinement and a sustained side-by-side gameplay comparison are
still outstanding. Passing geometry tests alone does not establish visual quality.


## September 26, 2026 Hand Cannon recording

User-supplied reference: `Recording 2026-09-26 170331.mp4` (28.20 s,
1902 by 1062). Reviewed the complete one-second contact sheet, full-size
frames at 3.5 s and 8.2 s, and 100 ms shot samples from 1.3 to 3.1 s.

- [verified, visual] Gray angular barrel shroud with a long orange side panel;
  bright green shoulder vents and curved green cylinder accents. The rear
  cylinder and the orange swept grip remain distinct from the barrel.
- [verified, visual] One-handed extended firing hold. At 3.5 s, movement uses
  a much higher muzzle-up diagonal carry on the right of the screen.
- [verified, visual] The first shot around 1.8 s lifts and pulls the weapon
  backward, exposing more of its side before it settles into the firing lane.
- [known, owner requirement] Firing the Hand Cannon cancels sprint and lowers
  it into its shooting hold. Other guns retain their existing behavior.

The procedural mesh is manually rebuilt from these visible features; no mesh
or animation data was extracted from the video. KYX's transform, spring,
framing, damage, magazine size and firing cadence are our implementation
choices. The recording does not establish exact source-game constants.


## September 26 Auto Rifle remodel from the September 24 recording

Reference: user-supplied `Recording 2026-09-24 214555.mp4`, particularly the
clear across-body view at 40.6 s and the firing/running transition sequence.

- [verified, visual] Enclosed, straight orange side strip beneath a gray cap;
  near-flush muzzle with a slim front blade. The prior procedural rifle's
  exposed gas tube, barrel and ported flash hider differ from this shape.
- [verified, visual] Broad stepped receiver, dark vertical recess, six narrow
  green side bars, horizontal forward indicator and separate vertical dash.
- [verified, visual] A sloping six-block display merges into a dark-edged rear
  channel. Large beveled armor planes dominate over small rail serrations.
- [ours] The manually rebuilt model preserves the requested long 1.15 m
  overall envelope, shared grip anchors and existing movement/firing behavior.
  Physical dimensions and the partly cropped stock are not video measurements.

The procedural model supplies both gameplay and inventory/store previews.
