# PS1-inspired anglerfish

Original low-poly animated asset, released under CC0-1.0. No external assets.

## Files

- `anglerfish.glb`: self-contained game asset with mesh, skeleton, pixel atlas and three animation clips.
- `anglerfish.blend`: editable Blender project. Active scene: `PS1_Anglerfish_YUp`. Earlier/default scenes are preserved, not part of the GLB.
- `blender-preview.png`: rendered asset preview.
- `preview.png`: quick geometry preview.
- `palette.png`: 64 × 64 pixel atlas, also embedded in the GLB.

## Budget and rig

932 triangles; seven bones; two material primitives; 178,772-byte GLB.
Flat normals, nearest-neighbor texture filtering, no subdivision or simulation.
Bones: root, jaw, tail_base, tail_tip, fin_left, fin_right, lure.
Rigid weights preserve the angular PS1 style; no automatic-weight dependency.
GLB coordinates: +Y up, -X forward. Blender converts the asset to +Z up.

| Clip | Duration | Playback |
| --- | --- | --- |
| Idle | 2 seconds | Loop |
| Swim | 1 second | Loop, in place |
| Bite | 0.75 seconds | One-shot |

In Blender, select the armature and choose the relevant imported action in the Action Editor. The active scene's action names have `.001` suffixes because an earlier import was preserved. Mute NLA tracks when previewing a single action directly; use only one clip at a time in a game engine.
The lure uses emissive material; bloom or lighting of nearby objects is engine-dependent.
This is PS1-inspired, not an actual PlayStation hardware export. No website integration was changed.

## Regeneration

From the repository root:

```sh
python tools/generate-ps1-anglerfish.py
```

Standard library generates the GLB and atlas; optional Pillow generates the quick preview.
Regeneration replaces only this asset's generated GLB, palette and quick preview; it does not update the Blender project.

## Verification

Generator checks triangle budget, nondegenerate triangles, buffer bounds/alignment, joint range and animation names.
Blender 5.2.2 imported the GLB and verified that Idle, Swim and Bite each deform the skinned mesh. Rendered preview inspected for silhouette and upright orientation.
