# Survival zombie roster

Twenty original equipment/mutation variants built in Blender on the existing shipped zombie rig. The default player and allied-bot model is unchanged. Each variant has distinct mesh details, materials, and an articulated head, jaw, arms, wrists, hips, knees, and ankles.

- `survival-zombies.blend`: editable source and labelled studio scene.
- `roster-preview.png`: overview of all twenty models.
- `roster.json`: design names and IDs.
- `../../public/zombie-roster.glb`: runtime library; one shared download, about 4 MB total, fewer than 64 meshes per body.
- Rebuild with Blender and `tools/blender/build_zombie_roster.py`.

Gameplay identity and scaling are shared in `src/entities/ZombieRoster.js`. Walkers start in wave 1, runners join in wave 2, and gunners join in wave 4. Every wave increases health and damage; speed increases toward a soft cap. Cosmetic IDs are assigned by the server and survive snapshot interpolation. Allies remain soldiers, and enemies use the zombie library.

Validation: `npm run test:zombies`, `npm run test:bots`, and `npm run test:survival-bots`.
