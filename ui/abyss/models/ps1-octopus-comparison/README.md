# Blue-ringed octopus comparison

Open `http://127.0.0.1:8769/viewer.html` while the local viewer server is running, or run `start-viewer.bat` from Windows.
The server binds only to localhost and serves this asset directory. The model-viewer library loads from unpkg.

| Variant | Triangles | Controls | Rig | GLB bytes | API cost |
| --- | ---: | ---: | --- | ---: | ---: |
| Detailed | 2,206 | 14 | Rigid object hierarchy | 319,884 | $1.55 |
| Detailed Lite | 1,634 | 15 | Rigid object hierarchy | 258,532 | $0.26 |
| Handmade | 1,728 | 25 | Skinned skeleton; three joints per arm | 416,076 | $0.00 |

Detailed and Lite were generated sequentially through RetroDiffusion with identical subject prompts at size 64 and identical Idle/Swim animation prompts. Geometry and animation curves are independently generated, not identical. Costs include one model and two animation jobs each: $1.81 total. No paid revisions.

The Handmade variant is original locally authored geometry, a 128×64 nearest-filtered pixel atlas, eight arms with blended skin weights, underside suckers, and two original animations. One mesh/material primitive. Its stronger skeleton supports continuous arm deformation, but its GLB is larger than the two provider exports. It follows the same design brief rather than using an AI generation prompt.

## Playback

Three models are shown side by side with matched lighting and camera angles. Select Idle or Swim, pause/resume all, or scrub the shared Phase slider. Corresponding clips use normalized phase synchronization; native durations differ. Orbit any viewer to synchronize the other camera angles. Zoom is per viewer. Reset view restores all cameras.

Idle runs at a three-second comparison cycle and Swim at two seconds. The provider's Detailed Swim is two seconds, Lite Swim is 1.2 seconds; the viewer maps both to the same cycle rather than editing their curves.

## Files and provenance

- `detailed/` and `lite/`: local `octopus.glb` files, provider previews, untouched `provider-original.glb`, idempotency/job/status JSON, and export metadata. Local GLBs only normalize clip names to Idle/Swim.
- `handmade/octopus.glb`: original 25-bone skinned model.
- `handmade/octopus.blend`: editable Blender scene `Handmade_Blue_Ringed_Octopus`, Idle enabled in NLA.
- `handmade/palette.png`: pixel atlas embedded in its GLB.
- `comparison.json`: exact subject and animation prompts, costs, asset statistics.

Provider outputs are governed by applicable RetroDiffusion terms. Handmade model, texture and animation are released under CC0-1.0. No provider credential is embedded in any output or browser file. Signed provider URLs in metadata may expire.

## Generators

- `tools/generate-retrodiffusion-octopus-comparison.py`: bounded API workflow with saved idempotency keys; estimates enforce $1.81 total maximum across six logical paid requests. Existing saved jobs are resumed, not newly charged. Never logs the API key.
- `tools/generate-handmade-octopus.py`: dependency-free local generator, no network or secrets; writes Handmade files and adds its comparison entry. Re-run this after running the API generator, which reconstructs the two-provider summary.

## Verification

All three GLBs load in Chrome and expose Idle and Swim. Shared playback advances all three models at exactly matching normalized phases; shared pause works. Browser inspection of the Handmade SkinnedMesh confirmed 25 bones, real vertex deformation for both clips, and exact rest endpoint matching. Blender imported its skin and both animation tracks with 1,728 triangles and one material. Side-by-side screenshot inspected. Both Python generators have zero Ruff diagnostics.

No ocean-menu integration changed.
