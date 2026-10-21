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
     (`walk`, `idle`, `takeoff`, `land`).
   - Master wing-fold controls (`CTRL_Wing_L`, `CTRL_Wing_R`) and custom properties
     `CTRL_WingFold_L` / `CTRL_WingFold_R` driving `WingElbow` -> `WingWrist` -> `WingHand` -> `WingD0..5`.
   - Caudal control chain (`CTRL_Tail_Base`, `CTRL_Tail_Mid`, `CTRL_Tail_Tip`) driving `Tail1..10`
     via progressive `DAMPED_TRACK` / `COPY_ROTATION` constraints.
3. Bake evaluated visual transforms back onto the 92 canonical deform bones and strip control
   bones/constraints prior to GLB export so `wyvern_v2_rig_contract.json` stays 100% intact.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from contract import CONTRACT_PATH, iter_action_fcurves, load_contract

DEFORM_COLLECTION_NAME = "00 Deform"
CONTROL_COLLECTION_NAME = "10 Controls"
CANONICAL_CONTACT_PLANE_Z = -184.0

GROUND_CONTACT_CLIPS = ("idle", "walk", "rest", "takeoff", "land")

FOOT_CONTACT_GROUPS = ("L_Foot", "R_Foot", "L_Toes", "R_Toes")
KNUCKLE_CONTACT_GROUPS = ("L_WingWrist", "R_WingWrist", "L_WingHand", "R_WingHand")

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
    {"name": "CTRL_Pole_Knee_L", "source": "L_Calf", "parent": "Root", "offset": (0.0, -180.0, 40.0), "length": 35.0, "floor_clamp": False},
    {"name": "CTRL_Pole_Knee_R", "source": "R_Calf", "parent": "Root", "offset": (0.0, -180.0, 40.0), "length": 35.0, "floor_clamp": False},
    {"name": "CTRL_IK_WingWrist_L", "source": "L_WingWrist", "parent": "Root", "offset": (0.0, 0.0, 0.0), "length": 55.0, "floor_clamp": True},
    {"name": "CTRL_IK_WingWrist_R", "source": "R_WingWrist", "parent": "Root", "offset": (0.0, 0.0, 0.0), "length": 55.0, "floor_clamp": True},
    {"name": "CTRL_IK_WingHand_L", "source": "L_WingHand", "parent": "CTRL_IK_WingWrist_L", "offset": (0.0, 0.0, 0.0), "length": 45.0, "floor_clamp": True},
    {"name": "CTRL_IK_WingHand_R", "source": "R_WingHand", "parent": "CTRL_IK_WingWrist_R", "offset": (0.0, 0.0, 0.0), "length": 45.0, "floor_clamp": True},
    {"name": "CTRL_Wing_L", "source": "L_WingShoulder", "parent": "Spine3", "offset": (0.0, 0.0, 80.0), "length": 60.0, "floor_clamp": False},
    {"name": "CTRL_Wing_R", "source": "R_WingShoulder", "parent": "Spine3", "offset": (0.0, 0.0, 80.0), "length": 60.0, "floor_clamp": False},
    {"name": "CTRL_Tail_Base", "source": "Tail3", "parent": "Body", "offset": (0.0, 0.0, 50.0), "length": 50.0, "floor_clamp": False},
    {"name": "CTRL_Tail_Mid", "source": "Tail6", "parent": "CTRL_Tail_Base", "offset": (0.0, 0.0, 50.0), "length": 50.0, "floor_clamp": False},
    {"name": "CTRL_Tail_Tip", "source": "Tail10", "parent": "CTRL_Tail_Mid", "offset": (0.0, 0.0, 50.0), "length": 50.0, "floor_clamp": False},
)

CONTROL_BONE_NAMES: frozenset[str] = frozenset(spec["name"] for spec in CONTROL_BONE_SPECS)


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
    armature["ground_contact_ik"] = float(armature.get("ground_contact_ik", 1.0))
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
        elbow_pb = pose_bones.get(f"{side}_WingElbow")
        if elbow_pb is not None:
            _clear_Managed_constraints(elbow_pb)
            ik = elbow_pb.constraints.new(type="IK")
            ik.name = f"CTRL_WingKnuckleIK_{side}"
            ik.target = armature
            ik.subtarget = f"CTRL_IK_WingWrist_{side}"
            ik.chain_count = 2
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

    # 5. Tail1..10 progressive DAMPED_TRACK / COPY_ROTATION chain
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
            dt = pb.constraints.new(type="DAMPED_TRACK")
            dt.name = f"CTRL_TailTrack_{seg}"
            dt.target = armature
            dt.subtarget = ctrl_name
            dt.track_axis = "TRACK_Y"
            dt.influence = round(base_inf * ((seg - start_idx + 1) / (end_idx - start_idx + 1)), 4)

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
        "wing_fold_driven_bones_per_side": len(WING_FOLD_RATIOS),
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
