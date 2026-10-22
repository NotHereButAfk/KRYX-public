# KYX weapon models

Original Blender geometry; metre units, +Y up and muzzle -Z after GLB export.
The runtime files are in `public/models/arsenal-v1`. `BlenderArsenal.js`
clones their materials and uses the exported hand/muzzle markers; the same
assets supply first person, third person, pickups and inventory previews.

To rebuild with Blender 4.5 LTS or newer, set `KYX_ARSENAL_OUTPUT` to a local output folder
and run `blender --background --python tools/blender/arsenal/build_arsenal.py`.
Optional IDs after `--` rebuild only those guns. Copy the resulting GLBs to
`public/models/arsenal-v1` after inspecting the renders. Editable `.blend`
files preserve individual components; GLBs batch surfaces by material.

| ID | Role |
| --- | --- |
| m4 | Extended induction Auto Rifle with vented armor |
| magnum | Sheriff-inspired six-round revolver, single heavy shot |
| battlerifle | Three simultaneous bullets per trigger, three ammo consumed |
| energyshotgun | Belt-fed Sweeper, automatic fire, 80-round box |
| plasmarifle | Six-shot energy cannon, traveling blast and 3.2 m splash |
| rpg | Map-pickup Rocket Launcher: open tube, shoulder saddle, offset optic |
| concussion | Map-pickup Grenade Launcher: six-chamber drum and wide barrel |
| uzi | Map-pickup Mini SMG: compact receiver, box magazine, sliding stock |
| levershotgun | Pump shotgun with extended barrel and vented receiver |
| sword | Arc Blade: stepped spine, green cutting edge, wrapped grip; upright guard and downward slash |
| boltsniper | Rail Driver: long accelerator barrel, mounted scope, bolt handle and precision stock; model ready, outside the active loadout |

The five main receivers were slimmed without scaling their grips or changing
barrel lengths. Pickup models retain the existing pickup rules and firing stats.

Shared gameplay definitions live in `src/weapons/weaponDefs.js` and are read
by the authoritative server. The old IDs remain stable for saved inventory.
Check changes with `npm run test:weapon-roles`, `npm run test:viewmodel`,
`npm run test:gunfeel`, `npm run test:audio`, `npm run build`, and the server
authority suite. Balance values are KYX design choices, not measured values
from another game.

The current guns include extended forward assemblies and individually sized service panels. Grips remain unchanged. First-person presentation is 10% larger; the Rocket Launcher saddle follows the published character's right shoulder.

The Forged Vanguard pass gives all nine firearms heavier, beveled receiver
shields, inset orange panels and three recessed power indicators. Structural
beds intersect both receiver and shield; authored grip, sight and muzzle markers
remain unchanged. Editable release files are in `art/forged-arsenal`.
