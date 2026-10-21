# Blender rig workflow contract

This workflow covers the Gothic V2 source asset `public/models/wyvern-gothic.glb`. The machine-readable contract is [`scripts/blender/wyvern_v2_rig_contract.json`](../scripts/blender/wyvern_v2_rig_contract.json). It pins the inspected asset SHA-256, exported joint names and parents, exact clip names, mesh layout, coordinate frame, and supported skin count. Regenerate or review that contract whenever the source GLB changes; a hash mismatch is a review boundary, not a reason to silently accept a new asset.

The current source contract describes one skin, 92 joints, 18 clips, a mesh node named `WyvernMesh`, and the measured axes `-Y` forward, `+Z` up, `+X` left. Axis notes come from the live-geometry observations in [`build-gothic-wing-blender.py`](../scripts/build-gothic-wing-blender.py), not from a generic Blender or rigging convention.

## Scene and skeleton organization

Keep the exported skeleton's exact names and bone-parent hierarchy. The export names are animation-binding identifiers. The GLB scene node `WyvernRig` is a container above the skin; the top exported bone `Root` has no bone parent in Blender. Keep that distinction in audits and manifests rather than creating a fake `WyvernRig` bone.

The main chains are:

```text
WyvernRig (GLB scene node)
└── Root
    └── RootMotion
        └── Body
            ├── Spine1 → Spine2 → Spine3 → Neck1 → Neck2 → Head → Jaw
            ├── Tail1 → … → Tail10
            ├── L_WingRoot → L_WingShoulder → L_WingElbow → L_WingWrist → L_WingHand
            ├── R_WingRoot → R_WingShoulder → R_WingElbow → R_WingWrist → R_WingHand
            ├── L_LegRoot → L_Thigh → L_Calf → L_Foot → L_Toes
            └── R_LegRoot → R_Thigh → R_Calf → R_Foot → R_Toes
```

Each wing digit uses `L/R_WingD{digit}P{phalanx}`. Membrane controls are named `L/R_WingPanel{panel}_{segment}`. Keep these strings stable across Blender, the GLB, and runtime animation tracks. Group bones with Blender Bone Collections such as `DEFORM | Body`, `DEFORM | Wings`, `DEFORM | Tail`, `DEFORM | Head`, and `REVIEW | Helpers`; Bone Collections do not require changing the exported parent hierarchy. If a separate animator control rig is introduced, bake it to this export rig and audit the resulting skeleton signature.

For review scene objects, use role collections without renaming bound source objects:

```text
AUDIT | 00 Rig
AUDIT | 10 Geometry
AUDIT | 20 Cameras
AUDIT | 30 Lights
AUDIT | 90 Helpers
```

Use a clear scene name such as `V2 Gothic Rig Audit`. Keep source, baseline, candidate, and export-review scenes distinct. Do not remove empty scenes or rename legacy objects in bulk; first check references and save a separate review copy.

## Naming rules

| Thing | Rule | Example |
|---|---|---|
| Export bone | Preserve canonical string exactly | `L_WingD2P2` |
| Bone parent | Preserve contract exactly | `L_WingD2P2` parent `L_WingD2P1` |
| Canonical exported action | Exact runtime clip string | `cruise` |
| Unexported action study | Explicit candidate, subject, and version | `CANDIDATE__cruise__neck__v01` |
| Review collection | `AUDIT | number role` | `AUDIT | 20 Cameras` |
| New helper object | `HELPER__purpose__v##` | `HELPER__jaw_target__v01` |
| Evidence file | asset id, clip/frame, view, dimensions | `wyvern-v2__cruise__f089__profile__1920x1080.png` |
| Blender source copy | asset id, source hash prefix, purpose, revision | `wyvern-v2__f334e785__neck-study__v02.blend` |

Avoid Blender-generated `.001` names for new actions and new helpers. Existing names with suffixes remain unchanged until their callers and animation slots have been migrated. An action with a candidate name must carry an explicit exported clip mapping; do not infer that mapping by stripping suffixes.

## Scripts and safe operation

Blender-specific tooling lives in `scripts/blender/`; reusable data contract and Action API compatibility helpers live in `contract.py`. Keep geometry-independent measurement functions importable without `bpy`, keep scene mutations behind explicit functions, and have commands require the input and output paths they use. Do not save over the input `.blend` or GLB. A scene organizer must preserve bone names, parents, rest transforms, actions, and animation slots.

Audit the source GLB's JSON contract without loading or rewriting compressed geometry:

```sh
python3 scripts/blender/audit_glb.py public/models/wyvern-gothic.glb \
  --json-out /tmp/wyvern-v2-glb-audit.json
```

Audit a saved Blender file and check its claimed source identity:

```sh
blender --background /path/to/review.blend \
  --python scripts/blender/audit_scene.py -- \
  --source-glb public/models/wyvern-gothic.glb \
  --json-out /tmp/wyvern-v2-scene-audit.json
```

Organize a validated review scene into role collections while writing a new `.blend` copy:

```sh
blender --background /path/to/review.blend \
  --python scripts/blender/organize_review_scene.py -- \
  --out /path/to/review-organized.blend
```

Pass `--dry-run` to print the proposed collection assignments. The organizer refuses to overwrite the source or an existing output and refuses a rig whose names or bone parents do not match the contract. It reports shared-scene objects it skipped. Review collections are organizational labels; do not assume a GLB exporter treats them as exclusion rules. Export selection still needs an explicit audit.

Reports distinguish scene structure, mesh skinning, clip-name presence, Action slots, hidden state, and source hashes. A report that passes structural checks does not mean that animation, deformations, transitions, materials, or gameplay have been visually approved.

## LLM-assisted Blender review

An LLM can reason only from the scene data and rendered evidence supplied to it. A screenshot does not reveal occluded surfaces, exact local axes, vertex weights, a hidden object, or temporal continuity. A contact sheet can miss a brief interpolation spike. Visual models can also misread perspective, mirrored views, tiny bone overlays, and subtle mouth or membrane intersections. Do not ask a model to infer an exact axis, pivot, or weight defect from one still.

For each review, provide:

1. The source asset SHA-256, `.blend` path, Blender version, scene, armature, action, frame, and active slot.
2. Before and candidate renders from the same fixed cameras and scale, plus whole-body and relevant close-up views. Include the axis gizmo or bone overlay when the question is about rig direction.
3. A short frame sequence or viewport capture when timing, a loop seam, or transition quality is the question. Keep numeric continuity and contact measurements alongside it.
4. The exact defect and expected change. Ask the model to separate visible observations, measured facts, and unresolved causes.
5. A request for a small candidate change and an explicit list of untouched datablocks. Keep the source file read-only and save the candidate under a new name.

Use Blender and script outputs for exact names, matrices, parents, key values, and weights. Use rendered images for silhouette, visible clipping, expression, and readability. Use actual playback for timing and continuity. When those sources disagree or the angle hides the feature, record the result as **unresolved** and capture better evidence.

### Review prompt template

```text
Asset SHA-256: <hash>
Blender file / version / scene: <path> / <version> / <scene>
Armature / action / frame / slot: <armature> / <action> / <frame> / <slot>
Question: <one visible or measured defect>
Expected result: <specific change>
Evidence: <same-camera baseline, candidate, frame sequence, and JSON audit paths>

Separate your response into:
- Observed in the supplied evidence
- Confirmed by numeric or Blender data
- Unresolved because of occlusion, missing playback, or missing data
- Smallest safe candidate edit
- Datablocks that must remain untouched
Do not infer local axes, hidden geometry, or motion continuity from a single still.
```
