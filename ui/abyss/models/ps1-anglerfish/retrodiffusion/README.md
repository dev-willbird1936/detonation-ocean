# RetroDiffusion Detailed Lite anglerfish

Generated through the official RetroDiffusion API using `rd_lowpoly__detailed_lite`, size 64.

- `anglerfish.glb`: unchanged provider original, 586 triangles, 134,984 bytes, automatic rigid-node hierarchy and `idle_swim` clip.
- `anglerfish-custom.glb`: original geometry, texture and clip plus three locally authored animations; 197,032 bytes.
- `anglerfish-custom.blend`: editable Blender scene `RetroDiffusion_Custom_Anglerfish`; Hover_Idle NLA tracks enabled, other clips muted.
- `custom-animation-report.json`: rig inspection and custom clip metadata.
- `preview.png`: provider-rendered preview.
- `viewer.html`: interactive browser viewer; the viewer library requires internet.
- Admission, job, status, asset and export JSON files: generation provenance and resumable task metadata. These contain no API key; provider output URLs may be temporary.

Provider charges: model $0.10 + animation $0.08 = $0.18. No paid revisions or extra clips.
The provider original has only `idle_swim`. The custom GLB adds `Hover_Idle` (3-second loop), `Cruise_Swim` (1.2-second loop), and `Bite_Snap` (0.85-second one-shot). No extra API charges. The viewer now loads the custom GLB and retains a provider-original download.
The original asset remains unchanged. Its CC0 statement does not automatically apply to this provider-generated variant; use under the applicable RetroDiffusion account terms.

Rig assessment: 15 hierarchical part controls and 32 mesh parts, with no glTF skin or Blender armature. Jaw controls include lower teeth; upper teeth remain on the body. Tailfin is a child of tail; bulb is a child of lure stalk. Suitable for rigid PS1-style movement, not smooth deformation or full-body bending. The bite is a modest jaw snap, not a watertight full mouth closure. The custom export reparents the formerly static light to the bulb while preserving its rest position.

Verification: original binary data, geometry, materials and animation preserved; custom keyframes have ordered times, normalized rotations, exact rest endpoints and nonzero motion. Browser inspected actual jaw/tail transforms and confirmed all three custom clips move and return to rest; Bite stops and shows Replay. Idle and bite screenshots inspected. Blender successfully imported all four animation tracks. Ruff reports no diagnostics for both scripts.

Sources:
- https://retrodiffusion.ai/app/guide/api (redirected to sign-in in this session)
- https://github.com/Retro-Diffusion/api-examples/blob/main/LOW_POLY.md (official accessible API contract)

Client: `tools/retrodiffusion-anglerfish.py`. Local animation generator: `tools/animate-retrodiffusion-anglerfish.py` (no network or API key). API key is read privately from the user's secrets directory at runtime, never embedded in the browser or output files.
