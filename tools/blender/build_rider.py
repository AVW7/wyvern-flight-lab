"""
Build the V2 wyvern rider: a stylised armoured humanoid, skinned, with its own
clip set, exported as a standalone GLB.

Why a separate asset rather than part of the wyvern GLB
------------------------------------------------------
`tools/blender/runtime_rig_contract.mjs` asserts exact skin count, joint count,
mesh count and a full node TRS signature. Merging a rider into `wyvern-v2-rig.glb`
would break all four, plus `test/wyvern-v2-kinetics.test.js`. A separate GLB
attached at runtime breaks nothing.

Why the rider is authored in wyvern units
-----------------------------------------
`normalizedClone()` in `src/scene/modelProcessor.ts` scales by
`targetScale / largestExtent`. For the wyvern that extent is the wingspan
(6266.8 units), so the rider must NOT be normalised independently — it would get
a completely different factor and end up the wrong size. Instead this script bakes
`UNITS_PER_METRE` into the export so the rider is already in wyvern units, and the
runtime multiplies it by the same scale factor the wyvern instance gets.

Scale derivation (measured, not guessed)
----------------------------------------
`tools/measure-wyvern-saddle.mjs` reports the wyvern body mesh at 2822.4 x 1067.3 x 4162.2
world units. Treating a wyvern of that build as ~10.4 m nose-to-tail gives
4162.2 / 10.4 = 400.2 units per metre. Rounded to 400:

    body length     4162 / 400 = 10.4 m
    shoulder height 1067 / 400 =  2.67 m
    saddle back     y 992 / 400 = 2.48 m above the ground plane

A 1.8 m rider is therefore 720 units tall, and seated hip-to-crown (~0.90 m)
is 360 units — a little under the 374-unit torso width at the saddle, which is
what a rider straddling that back should measure.

Orientation
-----------
Blender is Z-up and this script faces the rider along -Y; with `export_yup=True`
that becomes +Z in glTF, which is the direction the wyvern's head faces
(`Head` world z = 547.3, `Body` world z = -432.1). Verified after export by
`tools/blender/rider_runtime_contract.mjs`.

Run
---
    blender -b --factory-startup --python tools/blender/build_rider.py
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "models" / "wyvern-rider.glb"

UNITS_PER_METRE = 400.0
U = UNITS_PER_METRE
RIDER_HEIGHT_M = 1.8
FPS = 30

# 24 bones. Prefix RDR_ so nothing can be confused with wyvern joints.
# (name, parent, head_xyz_metres, tail_xyz_metres)
BONES = [
    ("RDR_Root",        None,           (0.00,  0.00,  0.00), (0.00,  0.00,  0.12)),
    ("RDR_Pelvis",      "RDR_Root",     (0.00,  0.00,  0.12), (0.00,  0.00,  0.24)),
    ("RDR_Spine1",      "RDR_Pelvis",   (0.00,  0.00,  0.24), (0.00,  0.00,  0.36)),
    ("RDR_Spine2",      "RDR_Spine1",   (0.00,  0.00,  0.36), (0.00,  0.00,  0.46)),
    ("RDR_Spine3",      "RDR_Spine2",   (0.00,  0.00,  0.46), (0.00,  0.00,  0.54)),
    ("RDR_Chest",       "RDR_Spine3",   (0.00,  0.00,  0.54), (0.00,  0.00,  0.62)),
    ("RDR_Neck1",       "RDR_Chest",    (0.00,  0.00,  0.62), (0.00, -0.01,  0.68)),
    ("RDR_Neck2",       "RDR_Neck1",    (0.00, -0.01,  0.68), (0.00, -0.02,  0.74)),
    ("RDR_Head",        "RDR_Neck2",    (0.00, -0.02,  0.74), (0.00, -0.03,  0.92)),
    ("RDR_Cloak",       "RDR_Chest",    (0.00,  0.09,  0.58), (0.00,  0.16,  0.16)),
    # Left arm: shoulder out, elbow down-back, hand forward on the reins.
    ("RDR_ShoulderL",   "RDR_Chest",    (0.06,  0.00,  0.60), (0.17,  0.00,  0.57)),
    ("RDR_ArmL_Upper",  "RDR_ShoulderL",(0.17,  0.00,  0.57), (0.27, -0.10,  0.42)),
    ("RDR_ArmL_Fore",   "RDR_ArmL_Upper",(0.27, -0.10, 0.42), (0.30, -0.30,  0.34)),
    ("RDR_HandL",       "RDR_ArmL_Fore", (0.30, -0.30, 0.34), (0.31, -0.38,  0.32)),
    ("RDR_ShoulderR",   "RDR_Chest",    (-0.06, 0.00,  0.60), (-0.17, 0.00,  0.57)),
    ("RDR_ArmR_Upper",  "RDR_ShoulderR",(-0.17, 0.00,  0.57), (-0.27,-0.10,  0.42)),
    ("RDR_ArmR_Fore",   "RDR_ArmR_Upper",(-0.27,-0.10, 0.42), (-0.30,-0.30,  0.34)),
    ("RDR_HandR",       "RDR_ArmR_Fore",(-0.30, -0.30, 0.34), (-0.31,-0.38,  0.32)),
    # Legs: seated, splayed wide. The wyvern's back is 374 units (0.94 m) across
    # at the saddle and still 250 units wide at the height the shins occupy, so
    # legs hanging at hip width would sit inside the torso. Knees at 0.30 m and
    # ankles at 0.47 m clear the flanks.
    ("RDR_ThighL",      "RDR_Pelvis",   (0.09,  0.00,  0.12), (0.30, -0.30,  0.04)),
    ("RDR_CalfL",       "RDR_ThighL",   (0.30, -0.30,  0.04), (0.47, -0.36, -0.36)),
    ("RDR_FootL",       "RDR_CalfL",    (0.47, -0.36, -0.36), (0.49, -0.46, -0.42)),
    ("RDR_ThighR",      "RDR_Pelvis",   (-0.09, 0.00,  0.12), (-0.30,-0.30,  0.04)),
    ("RDR_CalfR",       "RDR_ThighR",   (-0.30,-0.30,  0.04), (-0.47,-0.36, -0.36)),
    ("RDR_FootR",       "RDR_CalfR",    (-0.47,-0.36, -0.36), (-0.49,-0.46, -0.42)),
]

# Rigid armour plates: (bone, primitive, centre, size/radius). Each primitive is
# weighted 100% to one bone -- deliberate for plate armour, and it means the
# skin is correct by construction rather than by weight painting.
PARTS = [
    ("RDR_Pelvis",   "box",   (0.00,  0.00,  0.18), (0.30, 0.24, 0.18)),
    ("RDR_Pelvis",   "box",   (0.00,  0.00,  0.26), (0.33, 0.27, 0.05)),   # belt
    ("RDR_Spine1",   "box",   (0.00,  0.00,  0.30), (0.32, 0.25, 0.14)),
    ("RDR_Spine2",   "box",   (0.00,  0.00,  0.41), (0.35, 0.26, 0.14)),
    ("RDR_Spine3",   "box",   (0.00,  0.00,  0.50), (0.38, 0.27, 0.12)),
    ("RDR_Chest",    "box",   (0.00, -0.01,  0.58), (0.40, 0.28, 0.12)),
    ("RDR_Chest",    "box",   (0.00, -0.13,  0.57), (0.26, 0.05, 0.16)),   # breastplate
    ("RDR_Neck1",    "cyl",   (0.00, -0.01,  0.65), (0.055, 0.09)),
    ("RDR_Neck2",    "cyl",   (0.00, -0.015, 0.71), (0.052, 0.08)),
    ("RDR_Head",     "ico",   (0.00, -0.03,  0.80), (0.105,)),
    ("RDR_Head",     "box",   (0.00, -0.03,  0.84), (0.20, 0.22, 0.10)),   # helm crown
    ("RDR_Head",     "box",   (0.00, -0.13,  0.79), (0.15, 0.05, 0.06)),   # visor
    ("RDR_Cloak",    "box",   (0.00,  0.14,  0.38), (0.34, 0.05, 0.44)),
    ("RDR_Cloak",    "box",   (0.00,  0.17,  0.10), (0.30, 0.04, 0.20)),
    ("RDR_ShoulderL","ico",   (0.17,  0.00,  0.57), (0.075,)),
    ("RDR_ArmL_Upper","limb",  None, ((0.17, 0.00, 0.57), (0.27, -0.10, 0.42), 0.048)),
    ("RDR_ArmL_Fore","ico",   (0.27, -0.10,  0.42), (0.055,)),            # elbow
    ("RDR_ArmL_Fore","limb",   None, ((0.27, -0.10, 0.42), (0.30, -0.30, 0.34), 0.042)),
    ("RDR_HandL",    "box",   (0.31, -0.35,  0.33), (0.07, 0.11, 0.06)),
    ("RDR_ShoulderR","ico",   (-0.17, 0.00,  0.57), (0.075,)),
    ("RDR_ArmR_Upper","limb",  None, ((-0.17, 0.00, 0.57), (-0.27, -0.10, 0.42), 0.048)),
    ("RDR_ArmR_Fore","ico",   (-0.27,-0.10,  0.42), (0.055,)),
    ("RDR_ArmR_Fore","limb",   None, ((-0.27, -0.10, 0.42), (-0.30, -0.30, 0.34), 0.042)),
    ("RDR_HandR",    "box",   (-0.31,-0.35,  0.33), (0.07, 0.11, 0.06)),
    ("RDR_ThighL",   "limb",   None, ((0.09, 0.00, 0.12), (0.30, -0.30, 0.04), 0.062)),
    ("RDR_CalfL",    "ico",   (0.30, -0.30,  0.04), (0.065,)),            # knee
    ("RDR_CalfL",    "limb",   None, ((0.30, -0.30, 0.04), (0.47, -0.36, -0.36), 0.050)),
    ("RDR_FootL",    "box",   (0.48, -0.41, -0.39), (0.09, 0.16, 0.06)),
    ("RDR_ThighR",   "limb",   None, ((-0.09, 0.00, 0.12), (-0.30, -0.30, 0.04), 0.062)),
    ("RDR_CalfR",    "ico",   (-0.30,-0.30,  0.04), (0.065,)),
    ("RDR_CalfR",    "limb",   None, ((-0.30, -0.30, 0.04), (-0.47, -0.36, -0.36), 0.050)),
    ("RDR_FootR",    "box",   (-0.48,-0.41, -0.39), (0.09, 0.16, 0.06)),
]


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_armature():
    arm_data = bpy.data.armatures.new("RiderArmature")
    arm = bpy.data.objects.new("RiderRig", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")

    created = {}
    for name, parent, head, tail in BONES:
        bone = arm_data.edit_bones.new(name)
        # BONES is authored in metres; the rig is built directly in wyvern units.
        bone.head = Vector(head) * U
        bone.tail = Vector(tail) * U
        bone.roll = 0.0
        if parent:
            bone.parent = created[parent]
            bone.use_connect = False
        created[name] = bone

    bpy.ops.object.mode_set(mode="OBJECT")
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    return arm


def make_materials():
    """Mid-tone armour.

    The default Blender material exports near-white, which made the rider
    invisible against the light theme and, at rider scale, easy to lose against
    the dark wyvern too. Bronze sits between both backgrounds: it reads against
    a near-black body and against a white floor.
    """
    armour = bpy.data.materials.new("RiderArmour")
    armour.use_nodes = True
    principled = armour.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.42, 0.30, 0.16, 1.0)
    principled.inputs["Metallic"].default_value = 0.75
    principled.inputs["Roughness"].default_value = 0.42

    cloak = bpy.data.materials.new("RiderCloak")
    cloak.use_nodes = True
    cloth = cloak.node_tree.nodes.get("Principled BSDF")
    cloth.inputs["Base Color"].default_value = (0.30, 0.09, 0.08, 1.0)
    cloth.inputs["Metallic"].default_value = 0.0
    cloth.inputs["Roughness"].default_value = 0.85
    return armour, cloak


def add_part(bone_name, kind, centre, dims):
    """One rigid armour primitive, tagged with the bone that drives it."""
    # `limb` derives its own centre from the two endpoints, so `centre` is None.
    centre = Vector(centre) * U if centre is not None else None
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=centre)
        obj = bpy.context.object
        obj.scale = Vector(dims) * U
    elif kind == "cyl":
        radius, depth = dims
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=12, radius=radius * U, depth=depth * U, location=centre
        )
        obj = bpy.context.object
    elif kind == "ico":
        (radius,) = dims
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=3, radius=radius * U, location=centre
        )
        obj = bpy.context.object
    elif kind == "limb":
        # A cylinder spanning two joints. `dims` is (start, end, radius) in
        # metres. A plain `cyl` is built along +Z and would leave every limb
        # standing vertically instead of following its bone -- which is what the
        # first version of this script did.
        start, end, radius = dims
        a = Vector(start) * U
        b = Vector(end) * U
        axis = b - a
        length = axis.length
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=12, radius=radius * U, depth=length, location=(a + b) / 2
        )
        obj = bpy.context.object
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(axis.normalized())
    else:
        raise ValueError(kind)

    obj.name = f"{bone_name}_{kind}"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    group = obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    return obj


def build_mesh(armour, cloak):
    parts = []
    for bone, kind, centre, dims in PARTS:
        obj = add_part(bone, kind, centre, dims)
        obj.data.materials.append(cloak if bone == "RDR_Cloak" else armour)
        parts.append(obj)
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.name = "RiderBody"
    mesh.data.name = "RiderBodyMesh"
    return mesh


def bind(mesh, arm):
    modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = arm
    mesh.parent = arm
    return modifier


def key(arm, action, frame, pose):
    """pose: {bone: {'rot': (axis, angle) | euler_xyz, 'loc': Vector}}"""
    arm.animation_data.action = action
    for bone_name, spec in pose.items():
        pose_bone = arm.pose.bones[bone_name]
        if "rot" in spec:
            pose_bone.rotation_quaternion = spec["rot"]
        if "loc" in spec:
            pose_bone.location = Vector(spec["loc"])
        pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        pose_bone.keyframe_insert(data_path="location", frame=frame)


def quat_axis(axis, degrees):
    return Quaternion(Vector(axis), math.radians(degrees))


def make_actions(arm):
    if arm.animation_data is None:
        arm.animation_data_create()

    identity = Quaternion()
    clips = {}

    # --- idle: slow breathing, weight settling, tiny head drift ---------------
    idle = bpy.data.actions.new("rider_idle")
    frames = [1, 15, 30, 45, 60]
    breathe = [0.0, 1.6, 0.0, -1.2, 0.0]
    for frame, amount in zip(frames, breathe):
        key(arm, idle, frame, {
            "RDR_Spine2": {"rot": quat_axis((1, 0, 0), amount)},
            "RDR_Chest": {"rot": quat_axis((1, 0, 0), -amount * 0.8)},
            "RDR_Neck1": {"rot": quat_axis((1, 0, 0), amount * 0.5)},
            "RDR_Head": {"rot": quat_axis((0, 0, 1), math.sin(frame * 0.08) * 2.5)},
            "RDR_Cloak": {"rot": quat_axis((1, 0, 0), -amount * 1.6)},
            "RDR_ArmL_Upper": {"rot": quat_axis((1, 0, 0), -amount * 0.4)},
            "RDR_ArmR_Upper": {"rot": quat_axis((1, 0, 0), -amount * 0.4)},
        })
    idle.use_fake_user = True
    clips["idle"] = (idle, 60)

    # --- leanLeft / leanRight: the rider counter-rolls into a bank ------------
    for name, sign in (("rider_leanLeft", 1.0), ("rider_leanRight", -1.0)):
        action = bpy.data.actions.new(name)
        for frame, amount in ((1, 0.0), (10, 14.0 * sign), (20, 14.0 * sign), (32, 0.0)):
            key(arm, action, frame, {
                "RDR_Pelvis": {"rot": quat_axis((0, 1, 0), amount * 0.25)},
                "RDR_Spine1": {"rot": quat_axis((0, 1, 0), amount * 0.30)},
                "RDR_Spine2": {"rot": quat_axis((0, 1, 0), amount * 0.30)},
                "RDR_Chest": {"rot": quat_axis((0, 1, 0), amount * 0.25)},
                "RDR_Neck1": {"rot": quat_axis((0, 1, 0), -amount * 0.35)},
                "RDR_Head": {"rot": quat_axis((0, 1, 0), -amount * 0.45)},
                "RDR_Cloak": {"rot": quat_axis((0, 1, 0), amount * 0.9)},
            })
        action.use_fake_user = True
        clips["leanLeft" if sign > 0 else "leanRight"] = (action, 32)

    # --- brace: shoulders down, spine forward, for takeoff and strikes --------
    brace = bpy.data.actions.new("rider_brace")
    for frame, amount in ((1, 0.0), (8, 1.0), (22, 1.0), (34, 0.0)):
        key(arm, brace, frame, {
            "RDR_Spine1": {"rot": quat_axis((1, 0, 0), -9.0 * amount)},
            "RDR_Spine2": {"rot": quat_axis((1, 0, 0), -8.0 * amount)},
            "RDR_Chest": {"rot": quat_axis((1, 0, 0), -6.0 * amount)},
            "RDR_Neck1": {"rot": quat_axis((1, 0, 0), 12.0 * amount)},
            "RDR_Head": {"rot": quat_axis((1, 0, 0), 8.0 * amount)},
            "RDR_ArmL_Upper": {"rot": quat_axis((1, 0, 0), 16.0 * amount)},
            "RDR_ArmR_Upper": {"rot": quat_axis((1, 0, 0), 16.0 * amount)},
            "RDR_Cloak": {"rot": quat_axis((1, 0, 0), -22.0 * amount)},
        })
    brace.use_fake_user = True
    clips["brace"] = (brace, 34)

    return clips


def report(mesh, arm, clips):
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print(f"RIDER_BONES {len(arm.data.bones)}")
    print(f"RIDER_VERTS {len(mesh.data.vertices)}")
    print(f"RIDER_TRIS {tris}")
    print(f"RIDER_GROUPS {len(mesh.vertex_groups)}")
    print(f"RIDER_CLIPS {len(clips)} {sorted(clips)}")
    missing = [b.name for b in arm.data.bones if b.name not in mesh.vertex_groups]
    print(f"RIDER_BONES_WITHOUT_GEOMETRY {len(missing)} {missing}")
    # Bound box in rig space; scale must be 1 everywhere because the rig is built
    # directly in wyvern units.
    box = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
    ys = [v.y for v in box]
    zs = [v.z for v in box]
    xs = [v.x for v in box]
    print(f"RIDER_EXTENT_X {max(xs) - min(xs):.1f}")
    print(f"RIDER_EXTENT_Y {max(ys) - min(ys):.1f}")
    print(f"RIDER_EXTENT_Z {max(zs) - min(zs):.1f}")
    print(f"RIDER_SCALE {mesh.scale.x:.4f} {arm.scale.x:.4f}")


def main():
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = FPS

    arm = build_armature()
    armour, cloak = make_materials()
    mesh = build_mesh(armour, cloak)
    bind(mesh, arm)
    clips = make_actions(arm)

    # Leave idle active so ACTIONS export has a sane default.
    arm.animation_data.action = clips["idle"][0]
    for name, (action, end) in clips.items():
        action.frame_range  # touch so Blender caches the range
        action.use_frame_range = True
        action.frame_start = 1
        action.frame_end = end

    report(mesh, arm, clips)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm

    bpy.ops.export_scene.gltf(
        filepath=str(OUT),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=False,
        export_force_sampling=True,
        export_skins=True,
        export_apply=False,
        export_yup=True,
        export_optimize_animation_size=False,
    )
    print(f"RIDER_EXPORTED {OUT} {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
