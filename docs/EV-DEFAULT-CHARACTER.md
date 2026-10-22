# EV default character and animations

The default `vanguard` character is the supplied ev.io operative and Auto Rifle.
The menu, local player, local bots and network avatars use the same native
52-bone rig. Other selectable armor chassis remain available. Network snapshots
do not contain an equipped armor ID, so remote characters use the default rather
than a random chassis derived from their peer ID.

Files:

- `art/ev-default.blend`: editable character, rifle and animation showcase.
- `public/ev-default.glb`: browser character, attached rifle and 13 actions.
- `public/ev-auto-rifle.glb`: normalized 0.89 m rifle for the M4 slot, pickups and first person.
- `src/player/EvCharacter.js`: shared animation selection, blending and aim.

The actions cover armed idle, walk, run, standing fire, walking fire, running
fire, crouch down, crouched idle/fire, crouch walking/fire, stand up, and jump
takeoff/air/landing. Movement clips run in place. Cadence comes from measured
ankle travel, with a bounded stride extension for faster gameplay movement.
Strafing rotates the lower body; backward travel reverses its gait. Gameplay
physics owns jump height; the extra showcase lift is removed at load time.
Reload, melee, swap, throw and hit reactions use an upper-body layer driven by
the existing action clocks. Rifle flashes follow actual firing pulses.

Each character owns its skeleton, mixer and materials. Mesh buffers are shared.
The GLB's +Z facing is normalized to game-local -Z; its standing height is fitted
to the existing 1.816 m presentation stature. Physics and weapon damage are unchanged.

Re-export the character with Blender 5.2:

```sh
blender --background art/ev-default.blend --python tools/export_ev_character.py
npm run test:ev-character
npm run assets
```

Validation loads the real GLBs, exercises every movement/fire state, checks
independent skeletons and materials, muzzle direction, finite rotations, original
rifle markers, loading success/failure order, and first-person clearance across
12 viewport/FOV combinations. It also checks armor palettes and helmet themes,
death/respawn at 30/60/144 Hz, weapon-skin material roles and resource ownership.
`npm run test:ev-game` starts its own temporary Vite server and Chromium browser
to check the menu, local/remote players, bots, first-person rifle and actual
armory/thumbnail cleanup. It fails on browser errors or failed requests.
Install Chromium with `npx playwright install chromium` before the first run.
`npm run certify` includes both the asset checks and this browser integration gate.

Source attribution: character mesh from
[ev.io default skin](https://ev.io/sites/default/files/skins/default_2.evskin),
rifle mesh from [Auto Rifle](https://ev.io/sites/default/files/weapon_models/_Auto_Rifle_Original_1.evobj),
and source motion from [male animation library](https://ev.io/sites/default/files/animations/male_2.evanim).
Original assets belong to their creators. The supplied Blender file adapts
materials and adds the reusable walk, combined fire and transition actions.
