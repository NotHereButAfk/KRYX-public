# Forged Operatives

Three original cosmetic designs authored in Blender on the existing published
player skeleton. The default character and its thirteen gameplay actions are
unchanged. These Rare skins are available to the existing weekly Night Market
selection and can be equipped through the character inventory when owned.

- Reactor Bastion: reinforced reactor chest, orange jaw/brow armor, coolant tanks.
- Pestilence Warden: faceted respirator mask, luminous lenses, hat and split coat.
- Abyssal Sentinel: diving helmet, rebreather ports, hydrofoil shoulders and air tanks.

Editable sources are the three `.blend` files beside this document. Rebuild with
Blender in background mode and `tools/blender/build_player_skins.py`. This exports
GLBs into `public/assets/player-skins` and transparent studio thumbnails into
`public/assets/character-skins`. The script imports `public/ev-default.glb` for the
published skeleton and retained base body, replaces the helmet surfaces, and
models the new armor details in Blender. The reference pictures guide the themes;
no meshes or textures were extracted from those pictures or external websites.

The game lazily loads only requested skins and binds their skinned surfaces onto
the existing instance bones. Shared geometry is retained when instances are
released. Skin swaps and delayed loads are covered by `npm run test:skins`.

## Default Vanguard

`default_vanguard.blend` is the new angular default armor. The immutable,
previously published `rig-source.glb` supplies the original body and skeleton
for rebuilding. Run the skin builder with `-- default_vanguard`, then
`node tools/install_forged_default.mjs` to combine the Blender surfaces with
the unchanged published animation buffers. `node tools/build_ev_view_arms.mjs`
regenerates the matching first-person arms. Copy `default_vanguard.png` over
`public/assets/character-skins/default.png` after reviewing the render.
The installer retains the original rig normalization, so helmet and shoulder
silhouette changes do not alter joint spacing, movement or weapon fit.
