"""Fit palm-up first-person contacts on the shipped Blender weapon surfaces.

These are palm centres, separate from the animated character's wrist markers.
The RPG file is authored at 2.3x; all its contact coordinates use that scale.
Run in Blender background mode to update the GLBs and their editable sources.
"""
from pathlib import Path

VIEWMODEL_SUPPORT = {
    'm4': [.012, -.025, -.29],
    'magnum': [.012, -.0521, -.025],
    'battlerifle': [.012, -.0469, -.24],
    'energyshotgun': [.012, -.0953, -.18],
    'plasmarifle': [.012, -.0261, -.28],
    'rpg': [.0276, .0534, -.43],
    'concussion': [-.0093261655, -.0677, -.3028557],
    'uzi': [.012, .0345, -.085],
    'levershotgun': [.012, -.0166, -.25],
    'boltsniper': [.012, -.0153, -.25],
}

if __name__ == '__main__':
    import bpy
    import sys
    root = Path(__file__).resolve().parents[2]
    selected = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else VIEWMODEL_SUPPORT
    for wid in selected:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path = root / 'public/models/ev-default' / (wid + '.glb')
        bpy.ops.import_scene.gltf(filepath=str(path))
        weapon = bpy.data.objects['weapon_' + wid]
        pose = dict(weapon['authoredHandPose'])
        pose['viewmodelSupport'] = VIEWMODEL_SUPPORT[wid]
        if pose.get('supportVisible', True):
            # The full character's wrist sits behind and left of its cupped
            # palm. Its fingers extend diagonally across the fore-end.
            x, y, z = VIEWMODEL_SUPPORT[wid]
            pose['characterSupport'] = [x - .055, y - .025, z + .045]
        weapon['authoredHandPose'] = pose
        bpy.ops.wm.save_as_mainfile(filepath=str(root / 'art/ev-default-weapons' / (wid + '.blend')), compress=True)
        bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_extras=True, export_animations=False)
        print('FITTED_PALM', wid)
