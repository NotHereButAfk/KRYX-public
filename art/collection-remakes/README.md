# Reforged Collection

357 remodeled skins from the owner-selected EV.io Explorer catalog snapshot:
154 characters, 167 guns, and 36 swords. Relic entries are excluded. Names have
a Reforged suffix, while Common/Rare/Epic/Legendary classifications retain the
reference catalog values. The original Kryx cosmetics remain available.

These are derivatives of the referenced EV.io meshes, not wholly original
Kryx designs. `catalog.json` records each source page, model URL, original
rarity, and source/export SHA-256. Raw downloads stay in the local working
cache; `scenes/` contains the edited Blender projects.

## Authoring and rebuilding

1. Run `tools/blender/collection/fetch_references.ps1` to cache references.
2. In Blender 4.5 LTS+, run `remodel_collection.py` from that same directory
   with `--background --factory-startup --python-exit-code 1 --python`.
   Optional arguments after `--` select source IDs; `--force` rebuilds them.
3. Run `install_collection.py` with Python. It requires all 357 complete
   exports and installs GLBs, rendered thumbnails, scenes, and the catalog.
4. Run `node tools/optimize_collection.mjs` for Meshopt compression.
5. Run Blender's `frame_weapon_previews.py` to frame store thumbnails.
6. Run `npm run test:skins` and the repository's required release checks.

Character surfaces are refitted and weighted to the existing Kryx skeleton;
the published animation clips, combat hitboxes, and movement statistics are
not replaced. Weapons use one uniform scale and rotation between the trigger and muzzle anchors, preserving straight barrels and the source silhouette. Hand markers remain gameplay-owned.
Blades use their principal blade direction because their reference muzzle
markers are not meaningful blade-tip markers. Invalid forward muzzle markers
are rebuilt from the front of the reference mesh. Blender adds machined armor
chamfers and ceramic/graphite materials. Base-color textures retain their tint, and emission textures mask the glow instead of lighting the entire surface white. `material-maps.json` records required texture channels for the export regression checks.

Only equipped models load at runtime. Store/inventory cards use the rendered
thumbnails. Meshopt keeps geometry downloads smaller without removing skinning.
Legendary finishes use animated material effects; Legendary guns also use the
existing synthesized weapon-family sound system. Every finish remains cosmetic.

## Composite market cards
Ten initial card composites use the matching EV.io card as an edit target and the current Kryx model thumbnail as replacement-subject reference. They retain source backgrounds and compositions; they are not independently original artwork. Source URLs and built-in image-generation prompts are in `art/skin-card-artwork/composites/prompts.json`. Other skins retain model thumbnails until converted. Clicking a card opens the actual model preview.
