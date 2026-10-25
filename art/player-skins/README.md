# Reforged character rig

`rig-source.glb` is the retained skeleton and animation source used to build
the current Reforged collection. Its original surfaces are not selectable skins.
Keep this source: the collection builder uses its bind pose and bone names to
fit every character to the gameplay rig.

Current editable character scenes and their reference mapping live in
`art/collection-remakes/`. The builder is
`tools/blender/collection/remodel_collection.py`; it exports the cataloged
`remake_*.glb` files in `public/assets/player-skins/`. The runtime catalog is
`server/remadecollection.mjs`.

Default Reforged (`remake_84`) is the player default. Bot Reforged (`remake_229`)
is used for bots. `tools/install_forged_default.mjs` installs the current default
surfaces with the retained skeleton and animation buffers into the base runtime
model. The retired Vanguard, Reactor Bastion, Pestilence Warden and Abyssal
Sentinel scenes, exports and cards have been removed.

Skins bind to the existing character bones and share immutable geometry. Changes
must preserve the animation source, bind pose, bone names and resource ownership.
