"""Non-deforming animator control layer (`10 Controls`) and deform bake-on-export for WyvernRig.

Responsibilities:
1. Compute the canonical ground contact plane (`contact_plane_z` in Blender +Z-up) directly
   from the evaluated/skinned footpad, toe, and wing-knuckle vertices rather than bone heads.
2. Build non-exporting control bones (`use_deform = False`) in bone collection `10 Controls`
   while placing the 92 canonical deform bones in `00 Deform`:
   - Foot & toe IK targets (`CTRL_IK_Foot_L/R`, `CTRL_IK_Toes_L/R`) and knee pole targets
     (`CTRL_Pole_Knee_L/R`) with world-space floor `LIMIT_LOCATION` constraints (`Z >= contact_plane_z`).
   - Wing-knuckle ground-contact IK targets (`CTRL_IK_WingWrist_L/R`, `CTRL_IK_WingHand_L/R`)
     with floor `LIMIT_LOCATION` constraints (`Z >= contact_plane_z`), active on grounded clips
     (`walk`, `idle`, `takeoff`, `land`), with `CTRL_Pole_Elbow_L/R` pinning the shoulder/elbow
     bend plane so enabling `ground_contact_ik` never rolls `WingShoulder`.
   - Master wing-fold controls (`CTRL_Wing_L`, `CTRL_Wing_R`) and custom properties
     `CTRL_WingFold_L` / `CTRL_WingFold_R` driving `WingElbow` -> `WingWrist` -> `WingHand` -> `WingD0..5`.
   - Caudal control chain (`CTRL_Tail_Base`, `CTRL_Tail_Mid`, `CTRL_Tail_Tip`) driving `Tail1..10`
     via progressive local-space additive `COPY_ROTATION` constraints.
4. Solve the inter-digital membrane panels (`apply_panel_bisect`) as a back-solved world-space
   half-angle between adjacent digits. This is a bake-time pass, not a constraint: no Blender
   constraint can express it (see the function docstring for the measured numbers).
3. Bake evaluated visual transforms back onto the 92 canonical deform bones and strip control
   bones/constraints prior to GLB export so `wyvern_v2_rig_contract.json` stays 100% intact.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

from contract import CONTRACT_PATH, iter_action_fcurves, load_contract
from core.actions_compat import ActionCompat

DEFORM_COLLECTION_NAME = "00 Deform"
CONTROL_COLLECTION_NAME = "10 Controls"

# Blender world-space `+Z` of the grounded footpad surface in rest pose, measured from the
# skinned vertices of `WyvernBody_Rebuild` (1,084 foot-group vertices, 2026-10-21):
# `-2.6549`. Neither of the two numbers this constant has carried before is that value:
# `-184.0` is the glTF `Body`-relative foot height (clamps every floor control 181 units
# underground), and `+142.2` is `L/R_Foot.tail.z` — the *bone tail*, 144.9 units above the
# sole, which would float the feet. `compute_canonical_contact_plane` prefers the measured
# vertex minimum; this is only the fallback when no skinned mesh is resolvable.
CANONICAL_CONTACT_PLANE_Z = -2.6549

GROUND_CONTACT_CLIPS = ("idle", "walk", "rest", "takeoff", "land")

FOOT_CONTACT_GROUPS = ("L_Foot", "R_Foot", "L_Toes", "R_Toes")
KNUCKLE_CONTACT_GROUPS = ("L_WingWrist", "R_WingWrist", "L_WingHand", "R_WingHand")

# Knee pole targets sit forward of the calf (`-Y` is the head/forward axis on this rig) so the
# hock bends forward. `pole_angle` is calibrated so the IK solution reproduces the rest pose.
KNEE_POLE_OFFSET = (0.0, -200.0, 0.0)
KNEE_POLE_ANGLES: dict[str, float] = {"L": -70.18, "R": -109.81}

# Elbow pole targets sit on the outward bisector of the rest shoulder/elbow/wrist apex, so the
# bend plane is correct by construction and only the roll convention (`pole_angle`) is calibrated.
# A hand-guessed offset leaves a measured 7.04 deg bend-plane residual; the geometric placement
# removes that degree of freedom.
ELBOW_POLE_DISTANCE = 200.0
ELBOW_POLE_LENGTH = 40.0
ELBOW_POLE_ANGLES: dict[str, float] = {"L": 164.0, "R": 9.5}

PANEL_BONE_NAMES: tuple[str, ...] = tuple(
    f"WingPanel{panel}_{segment}" for panel in range(4) for segment in range(2)
)

WING_FOLD_RATIOS: dict[str, float] = {
    "WingElbow": 0.45,
    "WingWrist": 0.82,
    "WingHand": 0.68,
    **{f"WingD{d}P{p}": 0.55 for d in range(6) for p in range(3)},
    # Membrane panels must fold with the digits or they tear away from them.
    **{f"WingPanel{panel}_{segment}": ratio for panel in range(4) for segment, ratio in enumerate((0.48, 0.58))},
}

CONTROL_BONE_SPECS: tuple[dict[str, Any], ...] = (
    {"name": "CTRL_IK_Foot_L", "source": "L_Foot", "parent": "Root", "offset": (0.0, 0.0, 0.0), "length": 45.0, "floor_clamp": True},
    {"name": "CTRL_IK_Foot_R", "source": "R_Foot", "parent": "Root", "offset": (0.0, 0.0, 0.0), "length": 45.0, "floor_clamp": True},
    {"name": "CTRL_IK_Toes_L", "source": "L_Toes", "parent": "CTRL_IK_Foot_L", "offset": (0.0, 0.0, 0.0), "length": 35.0, "floor_clamp": True},
    {"name": "CTRL_IK_Toes_R", "source": "R_Toes", "parent": "CTRL_IK_Foot_R", "offset": (0.0, 0.0, 0.0), "length": 35.0, "floor_clamp": True},
    {"name": "CTRL_Pole_Knee_L", "source": "L_Calf", "parent": "Root", "offset": KNEE_POLE_OFFSET, "length": 35.0, "floor_clamp": False},
    {"name": "CTRL_Pole_Knee_R", "source": "R_Calf", "parent": "Root", "offset": KNEE_POLE_OFFSET, "length": 35.0, "floor_clamp": False},
    {"name": "CTRL_Pole_Elbow_L", "source": "L_WingElbow", "parent": "Root", "offset": None, "length": ELBOW_POLE_LENGTH, "floor_clamp": False, "pole_from_geometry": True},
    {"name": "CTRL_Pole_Elbow_R", "source": "R_WingElbow", "parent": "Root", "offset": None, "length": ELBOW_POLE_LENGTH, "floor_clamp": False, "pole_from_geometry": True},
    {"name": "CTRL_IK_WingWrist_L", "source": "L_WingWrist", "parent": "Root", "offset": (0.0, 0.0, 0.0), "length": 55.0, "floor_clamp": True},
    {"name": "CTRL_IK_WingWrist_R", "source": "R_WingWrist", "parent": "Root", "offset": (0.0, 0.0, 0.0), "length": 55.0, "floor_clamp": True},
    {"name": "CTRL_IK_WingHand_L", "source": "L_WingHand", "parent": "CTRL_IK_WingWrist_L", "offset": (0.0, 0.0, 0.0), "length": 45.0, "floor_clamp": True},
    {"name": "CTRL_IK_WingHand_R", "source": "R_WingHand", "parent": "CTRL_IK_WingWrist_R", "offset": (0.0, 0.0, 0.0), "length": 45.0, "floor_clamp": True},
    {"name": "CTRL_Wing_L", "source": "L_WingShoulder", "parent": "Spine3", "offset": (0.0, 0.0, 80.0), "length": 60.0, "floor_clamp": False},
    {"name": "CTRL_Wing_R", "source": "R_WingShoulder", "parent": "Spine3", "offset": (0.0, 0.0, 80.0), "length": 60.0, "floor_clamp": False},
    {"name": "CTRL_Tail_Base", "source": "Tail3", "parent": "Body", "offset": (0.0, 0.0, 0.0), "length": 50.0, "floor_clamp": False},
    {"name": "CTRL_Tail_Mid", "source": "Tail6", "parent": "CTRL_Tail_Base", "offset": (0.0, 0.0, 0.0), "length": 50.0, "floor_clamp": False},
    {"name": "CTRL_Tail_Tip", "source": "Tail10", "parent": "CTRL_Tail_Mid", "offset": (0.0, 0.0, 0.0), "length": 50.0, "floor_clamp": False},
)

CONTROL_BONE_NAMES: frozenset[str] = frozenset(spec["name"] for spec in CONTROL_BONE_SPECS)


def _sub(a: Sequence[float], b: Sequence[float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a: Sequence[float], b: Sequence[float]) -> tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a: Sequence[float], factor: float) -> tuple[float, float, float]:
    return (a[0] * factor, a[1] * factor, a[2] * factor)


def _length(a: Sequence[float]) -> float:
    return math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)


def _unit(a: Sequence[float]) -> tuple[float, float, float]:
    norm = _length(a)
    return _scale(a, 1.0 / norm) if norm > 1e-12 else (0.0, 0.0, 0.0)


def compute_canonical_contact_plane(
    bpy: Any,
    armature: Any,
    meshes: Sequence[Any] | None = None,
    fallback_z: float = CANONICAL_CONTACT_PLANE_Z,
) -> dict[str, Any]:
    """Measure the lowest world Z of vertices weighted (> 0.5) to foot, toe, and wing-knuckle groups."""
    scene = bpy.context.scene
    if meshes is None:
        meshes = [
            obj for obj in scene.objects
            if obj.type == "MESH" and any(
                m.type == "ARMATURE" and m.object == armature for m in getattr(obj, "modifiers", [])
            )
        ]

    depsgraph = bpy.context.evaluated_depsgraph_get() if hasattr(bpy.context, "evaluated_depsgraph_get") else None
    foot_min_z: float | None = None
    knuckle_min_z: float | None = None
    foot_count = 0
    knuckle_count = 0

    for obj in meshes:
        group_names = {g.index: g.name for g in getattr(obj, "vertex_groups", [])}
        if not group_names:
            continue
        eval_obj = obj.evaluated_get(depsgraph) if depsgraph and hasattr(obj, "evaluated_get") else obj
        eval_verts = eval_obj.data.vertices
        base_verts = obj.data.vertices
        world_mat = eval_obj.matrix_world

        for idx, base_v in enumerate(base_verts):
            foot_w = 0.0
            knuckle_w = 0.0
            for g in base_v.groups:
                gname = group_names.get(g.group)
                if gname in FOOT_CONTACT_GROUPS:
                    foot_w += g.weight
                elif gname in KNUCKLE_CONTACT_GROUPS:
                    knuckle_w += g.weight
            if foot_w <= 0.5 and knuckle_w <= 0.5:
                continue
            co = eval_verts[idx].co
            if hasattr(world_mat, "__matmul__"):
                world_co = world_mat @ co
                z_val = float(world_co[2] if not hasattr(world_co, "z") else world_co.z)
            else:
                z_val = float(co[2] if not hasattr(co, "z") else co.z)
            if foot_w > 0.5:
                foot_count += 1
                foot_min_z = z_val if foot_min_z is None else min(foot_min_z, z_val)
            if knuckle_w > 0.5:
                knuckle_count += 1
                knuckle_min_z = z_val if knuckle_min_z is None else min(knuckle_min_z, z_val)

    contact_plane_z = float(foot_min_z if foot_min_z is not None else fallback_z)
    return {
        "contact_plane_z": round(contact_plane_z, 4),
        "foot_surface_min_z": round(foot_min_z, 4) if foot_min_z is not None else round(fallback_z, 4),
        "knuckle_surface_min_z": round(knuckle_min_z, 4) if knuckle_min_z is not None else round(contact_plane_z, 4),
        "foot_vertex_count": foot_count,
        "knuckle_vertex_count": knuckle_count,
    }


def _ensure_bone_collection(arm_data: Any, name: str) -> Any | None:
    collections = getattr(arm_data, "collections", None)
    if collections is None:
        return None
    coll = collections.get(name) if hasattr(collections, "get") else next((c for c in collections if c.name == name), None)
    if coll is None:
        coll = collections.new(name)
    return coll


def _add_driver_var(driver: Any, armature: Any, data_path: str, var_name: str = "fold") -> None:
    var = driver.variables.new()
    var.name = var_name
    var.type = "SINGLE_PROP"
    target = var.targets[0]
    target.id_type = "OBJECT"
    target.id = armature
    target.data_path = data_path


def build_control_rig(
    bpy: Any,
    armature: Any,
    contact_plane_z: float | None = None,
    contract: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Author the non-deforming `10 Controls` layer and constraints on `WyvernRig`."""
    if contract is None:
        contract = load_contract(CONTRACT_PATH)
    contract_bone_names = {b["name"] for b in contract["bones"]}

    plane_info = compute_canonical_contact_plane(bpy, armature)
    floor_z = float(contact_plane_z if contact_plane_z is not None else plane_info["contact_plane_z"])

    # Custom rig properties for master wing fold and ground contact IK
    armature["CTRL_WingFold_L"] = float(armature.get("CTRL_WingFold_L", 0.0))
    armature["CTRL_WingFold_R"] = float(armature.get("CTRL_WingFold_R", 0.0))
    armature["ground_contact_ik"] = float(armature.get("ground_contact_ik", 0.0))
    armature["contact_plane_z"] = floor_z

    view_layer = bpy.context.view_layer
    prev_active = view_layer.objects.active
    view_layer.objects.active = armature
    prev_mode = getattr(armature, "mode", "OBJECT")
    if prev_mode != "EDIT":
        bpy.ops.object.mode_set(mode="EDIT")

    edit_bones = armature.data.edit_bones
    for spec in CONTROL_BONE_SPECS:
        cname = spec["name"]
        src = edit_bones.get(spec["source"])
        if src is None:
            continue
        cb = edit_bones.get(cname) or edit_bones.new(cname)
        if spec.get("pole_from_geometry"):
            # Place the pole on the outward bisector of the shoulder/elbow/wrist apex, which lies
            # in the rest bend plane by construction.
            side = cname[-1]
            shoulder = edit_bones.get(f"{side}_WingShoulder")
            outward = _unit(_sub(src.head, shoulder.head) if shoulder is not None else src.head)
            bisector = _add(outward, _unit(_sub(src.head, src.tail)))
            if _length(bisector) < 1e-6:
                bisector = _unit(_sub(src.tail, src.head))
            direction = _unit(bisector)
            head = _add(src.head, _scale(direction, ELBOW_POLE_DISTANCE))
            cb.head = head
            cb.tail = _add(head, _scale(direction, spec["length"]))
            cb.roll = getattr(src, "roll", 0.0)
        elif cname.startswith("CTRL_Tail_"):
            cb.head = (src.head[0], src.head[1], src.head[2])
            cb.tail = (src.tail[0], src.tail[1], src.tail[2])
            cb.roll = getattr(src, "roll", 0.0)
        else:
            ox, oy, oz = spec["offset"]
            cb.head = (src.head[0] + ox, src.head[1] + oy, src.head[2] + oz)
            cb.tail = (src.head[0] + ox, src.head[1] + oy + spec["length"], src.head[2] + oz)
            cb.roll = getattr(src, "roll", 0.0)
        cb.use_deform = False
        cb.use_connect = False
        parent_eb = edit_bones.get(spec["parent"])
        if parent_eb is not None:
            cb.parent = parent_eb

    bpy.ops.object.mode_set(mode="POSE")

    deform_coll = _ensure_bone_collection(armature.data, DEFORM_COLLECTION_NAME)
    control_coll = _ensure_bone_collection(armature.data, CONTROL_COLLECTION_NAME)
    for bone in armature.data.bones:
        if bone.name in contract_bone_names:
            bone.use_deform = True
            if deform_coll is not None:
                deform_coll.assign(bone)
        elif bone.name in CONTROL_BONE_NAMES:
            bone.use_deform = False
            if control_coll is not None:
                control_coll.assign(bone)

    pose_bones = armature.pose.bones

    def _clear_Managed_constraints(pb: Any) -> None:
        for con in list(pb.constraints):
            if con.name.startswith("CTRL_"):
                pb.constraints.remove(con)

    # 1. Floor-plane LIMIT_LOCATION on foot, toe, and wing-knuckle IK controls
    floor_clamped_controls = []
    for spec in CONTROL_BONE_SPECS:
        pb = pose_bones.get(spec["name"])
        if pb is None:
            continue
        pb.rotation_mode = "QUATERNION"
        _clear_Managed_constraints(pb)
        if spec["floor_clamp"]:
            con = pb.constraints.new(type="LIMIT_LOCATION")
            con.name = "CTRL_FloorPlane"
            con.owner_space = "WORLD"
            con.use_min_z = True
            con.min_z = floor_z
            con.use_transform_limit = True
            floor_clamped_controls.append(spec["name"])

    for side in ("L", "R"):
        wing_ctrl = pose_bones.get(f"CTRL_Wing_{side}")
        if wing_ctrl is not None:
            wing_ctrl[f"CTRL_WingFold_{side}"] = float(armature[f"CTRL_WingFold_{side}"])

        # 2. Hind-leg IK (`L/R_Calf` -> `CTRL_IK_Foot_L/R` with pole `CTRL_Pole_Knee_L/R`)
        calf_pb = pose_bones.get(f"{side}_Calf")
        if calf_pb is not None:
            _clear_Managed_constraints(calf_pb)
            ik = calf_pb.constraints.new(type="IK")
            ik.name = f"CTRL_FootIK_{side}"
            ik.target = armature
            ik.subtarget = f"CTRL_IK_Foot_{side}"
            ik.pole_target = armature
            ik.pole_subtarget = f"CTRL_Pole_Knee_{side}"
            ik.chain_count = 2
            ik.pole_angle = math.radians(KNEE_POLE_ANGLES[side])
            ik.influence = 1.0

        for part, target_name in (("Foot", f"CTRL_IK_Foot_{side}"), ("Toes", f"CTRL_IK_Toes_{side}")):
            pb = pose_bones.get(f"{side}_{part}")
            if pb is not None:
                _clear_Managed_constraints(pb)
                cr = pb.constraints.new(type="COPY_ROTATION")
                cr.name = f"CTRL_{part}Rot_{side}"
                cr.target = armature
                cr.subtarget = target_name
                cr.mix_mode = "ADD"
                cr.target_space = "LOCAL"
                cr.owner_space = "LOCAL"
                cr.influence = 1.0

        # 3. Wing-knuckle ground-contact IK (`WingElbow` -> `CTRL_IK_WingWrist_L/R`, `WingHand` -> `CTRL_IK_WingHand_L/R`)
        #    The 2-bone chain is `WingShoulder -> WingElbow`, so `WingElbow.tail` (= `WingWrist.head`)
        #    is what reaches the target. Without a pole the shoulder rolls freely whenever the
        #    target leaves the rest plane, so the bend plane is pinned by `CTRL_Pole_Elbow_L/R`.
        elbow_pb = pose_bones.get(f"{side}_WingElbow")
        if elbow_pb is not None:
            _clear_Managed_constraints(elbow_pb)
            ik = elbow_pb.constraints.new(type="IK")
            ik.name = f"CTRL_WingKnuckleIK_{side}"
            ik.target = armature
            ik.subtarget = f"CTRL_IK_WingWrist_{side}"
            ik.pole_target = armature
            ik.pole_subtarget = f"CTRL_Pole_Elbow_{side}"
            ik.chain_count = 2
            ik.pole_angle = math.radians(ELBOW_POLE_ANGLES[side])
            ik.influence = float(armature["ground_contact_ik"])
            if hasattr(ik, "driver_add"):
                fcurve = ik.driver_add("influence")
                fcurve.driver.type = "SCRIPTED"
                fcurve.driver.expression = "ground_ik"
                _add_driver_var(fcurve.driver, armature, '["ground_contact_ik"]', "ground_ik")

        # 4. Master `CTRL_WingFold_L/R` driving `WingElbow` -> `WingWrist` -> `WingHand` -> `WingD0..5`
        for part, ratio in WING_FOLD_RATIOS.items():
            bname = f"{side}_{part}"
            pb = pose_bones.get(bname)
            if pb is None:
                continue
            if part != "WingElbow":
                _clear_Managed_constraints(pb)
            fold_con = pb.constraints.new(type="COPY_ROTATION")
            fold_con.name = f"CTRL_WingFold_{side}"
            fold_con.target = armature
            fold_con.subtarget = f"CTRL_Wing_{side}"
            fold_con.mix_mode = "ADD"
            fold_con.target_space = "LOCAL"
            fold_con.owner_space = "LOCAL"
            fold_con.influence = float(armature[f"CTRL_WingFold_{side}"]) * ratio
            if hasattr(fold_con, "driver_add"):
                fcurve = fold_con.driver_add("influence")
                fcurve.driver.type = "SCRIPTED"
                fcurve.driver.expression = f"max(0.0, min(1.0, fold)) * {ratio:.4f}"
                _add_driver_var(fcurve.driver, armature, f'["CTRL_WingFold_{side}"]', "fold")

        hand_pb = pose_bones.get(f"{side}_WingHand")
        if hand_pb is not None:
            knuckle_rot = hand_pb.constraints.new(type="COPY_ROTATION")
            knuckle_rot.name = f"CTRL_WingHandContact_{side}"
            knuckle_rot.target = armature
            knuckle_rot.subtarget = f"CTRL_IK_WingHand_{side}"
            knuckle_rot.mix_mode = "ADD"
            knuckle_rot.target_space = "LOCAL"
            knuckle_rot.owner_space = "LOCAL"
            knuckle_rot.influence = float(armature["ground_contact_ik"])

    # 6. Tail1..10 progressive local-space additive `COPY_ROTATION` chain
    tail_targets = (
        (1, 3, "CTRL_Tail_Base", 0.35),
        (4, 7, "CTRL_Tail_Mid", 0.45),
        (8, 10, "CTRL_Tail_Tip", 0.55),
    )
    for start_idx, end_idx, ctrl_name, base_inf in tail_targets:
        for seg in range(start_idx, end_idx + 1):
            pb = pose_bones.get(f"Tail{seg}")
            if pb is None:
                continue
            _clear_Managed_constraints(pb)
            cr = pb.constraints.new(type="COPY_ROTATION")
            cr.name = f"CTRL_TailRot_{seg}"
            cr.target = armature
            cr.subtarget = ctrl_name
            cr.target_space = "LOCAL"
            cr.owner_space = "LOCAL"
            cr.mix_mode = "ADD"
            cr.influence = round(base_inf * ((seg - start_idx + 1) / (end_idx - start_idx + 1)), 4)

    if prev_mode != "POSE":
        bpy.ops.object.mode_set(mode=prev_mode)
    if prev_active is not None:
        view_layer.objects.active = prev_active

    return {
        "armature": armature.name,
        "deform_collection": DEFORM_COLLECTION_NAME,
        "control_collection": CONTROL_COLLECTION_NAME,
        "deform_bone_count": sum(1 for b in armature.data.bones if b.use_deform),
        "control_bone_count": sum(1 for b in armature.data.bones if not b.use_deform),
        "control_bones": sorted(b.name for b in armature.data.bones if not b.use_deform),
        "floor_clamped_controls": sorted(floor_clamped_controls),
        "contact_plane": plane_info,
        "ground_contact_ik": float(armature["ground_contact_ik"]),
        "wing_fold_driven_bones_per_side": len(WING_FOLD_RATIOS),
    }


def apply_panel_bisect(bpy: Any, armature: Any, digits: Sequence[str] | None = None) -> dict[str, Any]:
    """Set all 16 membrane panels to the world-space half-angle between their adjacent digits.

    Mirrors `tools/blender/coordinate_all_v2_clips.mjs`: each adjacent digit's world delta from
    bind is slerped at `0.5`, applied to the panel's bind world matrix, then back-solved through
    the panel's *current* parent. Segment 0 bisects phalanx `P1` of digits `K`/`K+1`, segment 1
    bisects `P2`, matching the GLB solver.

    Why this is not a constraint (all measured on `wyvern-v2-master.blend`, 2026-10-21): for a
    `20°` rotation of `WingD0P0`, rigid parenting moves `WingPanel0_0` by `20.00°`, a chained
    LOCAL-space `COPY_ROTATION` pair (digit K at 1.0, digit K+1 at 0.5, `REPLACE`) moves it by
    `28.20°` — worse than doing nothing, because the panel re-inherits the parent rotation — and
    WORLD space with `use_offset` moves it by `110.86°`, because `use_offset` adds the *owner's*
    rest rotation rather than the owner-to-target offset. Only back-solving through the parent
    reaches the required `10.00°`.

    Returns per-panel errors: `angle(panel_world_delta, slerp(delta_K, delta_K+1, 0.5))`.
    """
    from mathutils import Matrix

    bone_names = digits or [f"{side}_{name}" for side in ("L", "R") for name in PANEL_BONE_NAMES]
    needed = set(bone_names)
    for name in bone_names:
        side = name[0]
        panel, segment = (int(part) for part in name.split("Panel")[1].split("_"))
        needed.add(f"{side}_WingD{panel}P{segment + 1}")
        needed.add(f"{side}_WingD{panel + 1}P{segment + 1}")
    bind_world = {
        name: armature.data.bones[name].matrix_local.copy()
        for name in needed
        if name in armature.data.bones
    }

    def _delta(name: str) -> Any:
        return armature.pose.bones[name].matrix @ bind_world[name].inverted()

    errors: dict[str, float] = {}
    for name in bone_names:
        side = name[0]
        panel, segment = (int(part) for part in name.split("Panel")[1].split("_"))
        phalanx = segment + 1
        adjacent = (f"{side}_WingD{panel}P{phalanx}", f"{side}_WingD{panel + 1}P{phalanx}")
        if any(bone not in bind_world for bone in adjacent):
            continue

        delta_a, delta_b = (_delta(bone) for bone in adjacent)
        q_a, q_b = delta_a.to_quaternion(), delta_b.to_quaternion()
        if q_a.dot(q_b) < 0.0:
            q_b.negate()
        q_avg = q_a.slerp(q_b, 0.5)

        bind_head = bind_world[name].translation.copy()
        head_avg = (delta_a @ bind_head + delta_b @ bind_head) * 0.5
        target = Matrix.Translation(head_avg) @ (q_avg.to_matrix().to_4x4() @ bind_world[name].to_3x3().to_4x4())

        pb = armature.pose.bones[name]
        pb.matrix = target
        bpy.context.view_layer.update()

        measured = pb.matrix.to_quaternion() @ bind_world[name].to_quaternion().inverted()
        errors[name] = round(abs(measured.rotation_difference(q_avg).angle), 6)

    return {
        "panels": len(errors),
        "max_error_rad": max(errors.values()) if errors else 0.0,
        "max_error_deg": round(math.degrees(max(errors.values())) if errors else 0.0, 6),
        "per_panel_error_deg": {k: round(math.degrees(v), 6) for k, v in errors.items()},
    }


def _strip_control_fcurves(action: Any, control_names: Iterable[str]) -> int:
    control_set = set(control_names)
    removed = 0
    containers: list[Any] = []
    if hasattr(action, "fcurves"):
        containers.append(action.fcurves)
    elif hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    containers.append(bag.fcurves)
    for fcurves in containers:
        for curve in list(fcurves):
            for cname in control_set:
                if f'pose.bones["{cname}"]' in curve.data_path:
                    fcurves.remove(curve)
                    removed += 1
                    break
    return removed


def bake_control_rig_to_deform(
    bpy: Any,
    armature: Any,
    actions: Sequence[Any] | None = None,
    strip_controls: bool = True,
    contract: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Bake evaluated visual transforms onto the 92 deform bones and optionally strip `10 Controls`."""
    if contract is None:
        contract = load_contract(CONTRACT_PATH)
    contract_bone_names = [b["name"] for b in contract["bones"]]
    contract_set = set(contract_bone_names)

    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    prev_active = view_layer.objects.active
    view_layer.objects.active = armature

    has_active_constraints = any(
        len(armature.pose.bones[bname].constraints) > 0
        for bname in contract_bone_names
        if bname in armature.pose.bones
    )

    if actions is None:
        actions = [act for act in getattr(bpy.data, "actions", []) if act.name in set(contract["clips"])]

    baked_actions: list[str] = []
    removed_fcurves = 0

    if has_active_constraints and actions:
        prev_action = armature.animation_data.action if armature.animation_data else None
        prev_frame = scene.frame_current
        if armature.animation_data is None:
            armature.animation_data_create()
        armature.animation_data.use_nla = False

        for action in actions:
            armature.animation_data.action = action
            # Blender 4.4+ actions are layered and multi-slot; without binding the
            # `OBWyvernRig` slot first, `bpy.ops.nla.bake()` bakes into whichever slot happens
            # to be active (often none), silently producing an empty bake.
            ActionCompat.setup_slotted_action(action, armature)
            start_f, end_f = int(round(action.frame_range[0])), int(round(action.frame_range[1]))
            if hasattr(bpy.ops, "nla") and hasattr(bpy.ops.nla, "bake"):
                for bone in armature.data.bones:
                    bone.select = bone.name in contract_set
                bpy.ops.nla.bake(
                    frame_start=start_f,
                    frame_end=end_f,
                    step=1,
                    only_selected=True,
                    visual_keying=True,
                    clear_constraints=False,
                    clear_parents=False,
                    use_current_action=True,
                    bake_types={"POSE"},
                )
            baked_actions.append(action.name)

        armature.animation_data.action = prev_action
        scene.frame_set(prev_frame)

    # Clear managed CTRL_ constraints from deform bones so exported deform tracks are pure FK
    cleared_constraints = 0
    for bname in contract_bone_names:
        pb = armature.pose.bones.get(bname)
        if pb is None:
            continue
        for con in list(pb.constraints):
            if con.name.startswith("CTRL_"):
                pb.constraints.remove(con)
                cleared_constraints += 1

    # Strip control bone F-curves from all actions so glTF animations never target non-skin nodes
    extra_bones = [b.name for b in armature.data.bones if b.name not in contract_set]
    for action in getattr(bpy.data, "actions", []):
        removed_fcurves += _strip_control_fcurves(action, extra_bones)

    removed_bones: list[str] = []
    if strip_controls and extra_bones:
        prev_mode = getattr(armature, "mode", "OBJECT")
        if prev_mode != "EDIT":
            bpy.ops.object.mode_set(mode="EDIT")
        edit_bones = armature.data.edit_bones
        for bname in extra_bones:
            eb = edit_bones.get(bname)
            if eb is not None:
                edit_bones.remove(eb)
                removed_bones.append(bname)
        if prev_mode != "EDIT":
            bpy.ops.object.mode_set(mode=prev_mode)

        collections = getattr(armature.data, "collections", None)
        if collections is not None:
            ctrl_coll = collections.get(CONTROL_COLLECTION_NAME) if hasattr(collections, "get") else None
            if ctrl_coll is not None and hasattr(collections, "remove"):
                collections.remove(ctrl_coll)

    if prev_active is not None:
        view_layer.objects.active = prev_active

    return {
        "armature": armature.name,
        "baked_actions": baked_actions,
        "cleared_constraints": cleared_constraints,
        "removed_control_fcurves": removed_fcurves,
        "removed_control_bones": sorted(removed_bones),
        "remaining_deform_bones": len(armature.data.bones),
    }
