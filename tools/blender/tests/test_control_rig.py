from __future__ import annotations

import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

PKG = Path(__file__).resolve().parents[3] / "scripts/blender"
if str(PKG) not in sys.path:
    sys.path.insert(0, str(PKG))

from contract import CONTRACT_PATH, load_contract
from audit_scene import build_report
from core.actions_compat import ActionCompat
from rigging.control_rig import (
    CANONICAL_CONTACT_PLANE_Z,
    CONTROL_BONE_NAMES,
    CONTROL_COLLECTION_NAME,
    DEFORM_COLLECTION_NAME,
    WING_FOLD_RATIOS,
    apply_panel_bisect,
    bake_control_rig_to_deform,
    build_control_rig,
    compute_canonical_contact_plane,
)


class FakeDriverTarget:
    def __init__(self):
        self.id_type = ""
        self.id = None
        self.data_path = ""


class FakeDriverVar:
    def __init__(self):
        self.name = ""
        self.type = ""
        self.targets = [FakeDriverTarget()]


class FakeDriverVars(list):
    def new(self):
        var = FakeDriverVar()
        self.append(var)
        return var


class FakeDriver:
    def __init__(self):
        self.type = ""
        self.expression = ""
        self.variables = FakeDriverVars()


class FakeConstraint:
    def __init__(self, ctype: str):
        self.type = ctype
        self.name = ""
        self.owner_space = "WORLD"
        self.target_space = "WORLD"
        self.use_min_z = False
        self.min_z = 0.0
        self.use_transform_limit = False
        self.target = None
        self.subtarget = ""
        self.pole_target = None
        self.pole_subtarget = ""
        self.chain_count = 0
        self.influence = 1.0
        self.mix_mode = "REPLACE"
        self.use_offset = False
        self.track_axis = "TRACK_Y"
        self.drivers = {}

    def driver_add(self, prop: str):
        drv = SimpleNamespace(driver=FakeDriver())
        self.drivers[prop] = drv
        return drv


class FakeConstraintList(list):
    def new(self, type: str):
        con = FakeConstraint(type)
        self.append(con)
        return con


class FakePoseBone(dict):
    def __init__(self, name: str):
        super().__init__()
        self.name = name
        self.rotation_mode = "QUATERNION"
        self.constraints = FakeConstraintList()


class FakePoseBoneDict(dict):
    pass


class FakeBone:
    def __init__(self, name: str, parent: FakeBone | None = None, head=(0.0, 0.0, 0.0), tail=(0.0, 10.0, 0.0), use_deform: bool = True):
        self.name = name
        self.parent = parent
        self.head = head
        self.tail = tail
        self.roll = 0.0
        self.use_deform = use_deform
        self.use_connect = False
        self.select = False


class FakeEditBones(list):
    def get(self, name: str):
        return next((b for b in self if b.name == name), None)

    def new(self, name: str):
        b = FakeBone(name, use_deform=False)
        self.append(b)
        return b


class FakeBoneCollection:
    def __init__(self, name: str):
        self.name = name
        self.assigned: set[str] = set()

    def assign(self, bone: FakeBone):
        self.assigned.add(bone.name)


class FakeBoneCollections(list):
    def get(self, name: str):
        return next((c for c in self if c.name == name), None)

    def new(self, name: str):
        c = FakeBoneCollection(name)
        self.append(c)
        return c


class FakeArmatureData:
    def __init__(self, contract_bones: list[dict]):
        self.edit_bones = FakeEditBones()
        by_name: dict[str, FakeBone] = {}
        for index, entry in enumerate(contract_bones):
            parent = by_name.get(entry.get("parent"))
            head = (0.0, float(index * 5), 226.0 if "Foot" in entry["name"] else 71.0 if "Toes" in entry["name"] else 400.0)
            tail = (head[0], head[1] + 15.0, head[2])
            b = FakeBone(entry["name"], parent=parent, head=head, tail=tail, use_deform=True)
            self.edit_bones.append(b)
            by_name[b.name] = b
        self.collections = FakeBoneCollections()

    @property
    def bones(self):
        return list(self.edit_bones)


class FakeArmatureObject(dict):
    def __init__(self, contract_bones: list[dict]):
        super().__init__()
        self.name = "WyvernRig"
        self.type = "ARMATURE"
        self.mode = "OBJECT"
        self.hide_viewport = False
        self.hide_render = False
        self.users_collection = []
        self.data = FakeArmatureData(contract_bones)
        self.pose = SimpleNamespace(bones=FakePoseBoneDict({b.name: FakePoseBone(b.name) for b in self.data.bones}))
        self.animation_data = None

    def animation_data_create(self):
        self.animation_data = SimpleNamespace(action=None, use_nla=False)
        return self.animation_data

    def sync_pose_bones(self):
        existing = self.pose.bones
        for b in self.data.bones:
            if b.name not in existing:
                existing[b.name] = FakePoseBone(b.name)
        for name in list(existing):
            if self.data.edit_bones.get(name) is None:
                del existing[name]


class ControlRigTest(unittest.TestCase):
    def setUp(self):
        self.contract = load_contract(CONTRACT_PATH)
        self.armature = FakeArmatureObject(self.contract["bones"])

        vgroups = [
            SimpleNamespace(index=0, name="L_Toes"),
            SimpleNamespace(index=1, name="L_WingHand"),
        ]
        verts = [
            SimpleNamespace(co=(282.0, -558.0, -2.6549), groups=[SimpleNamespace(group=0, weight=0.95)]),
            SimpleNamespace(co=(810.0, -1667.0, 188.5), groups=[SimpleNamespace(group=1, weight=0.85)]),
        ]
        self.mesh = SimpleNamespace(
            name="WyvernBody_Rebuild",
            type="MESH",
            hide_viewport=False,
            hide_render=False,
            users_collection=[],
            vertex_groups=vgroups,
            modifiers=[SimpleNamespace(type="ARMATURE", object=self.armature)],
            data=SimpleNamespace(vertices=verts),
            matrix_world=None,
        )

        def set_mode(mode: str):
            self.armature.mode = mode
            self.armature.sync_pose_bones()

        self.baked_calls = []

        def fake_bake(**kwargs):
            self.baked_calls.append(kwargs)

        actions = []
        for clip_name in self.contract["clips"]:
            fcurves = [
                SimpleNamespace(data_path='pose.bones["Body"].rotation_quaternion', keyframe_points=[1, 2, 3]),
                SimpleNamespace(data_path='pose.bones["CTRL_IK_Foot_L"].location', keyframe_points=[1, 2, 3]),
            ]
            actions.append(SimpleNamespace(name=clip_name, frame_range=(0.0, 24.0), fcurves=fcurves, slots=[]))

        scene = SimpleNamespace(
            name="V2 Runtime Rig",
            frame_current=0,
            objects=[self.armature, self.mesh],
            get=lambda k, d=None: d,
            frame_set=lambda f: None,
        )
        self.bpy = SimpleNamespace(
            app=SimpleNamespace(version_string="5.1.1"),
            data=SimpleNamespace(
                filepath="",
                scenes=[scene],
                objects=scene.objects,
                actions=actions,
            ),
            context=SimpleNamespace(
                scene=scene,
                view_layer=SimpleNamespace(objects=SimpleNamespace(active=self.armature)),
            ),
            ops=SimpleNamespace(
                object=SimpleNamespace(mode_set=set_mode),
                nla=SimpleNamespace(bake=fake_bake),
            ),
        )

    def test_contact_plane_is_derived_from_vertices_not_bone_heads(self):
        plane = compute_canonical_contact_plane(self.bpy, self.armature, [self.mesh])
        self.assertEqual(plane["contact_plane_z"], -2.6549)
        self.assertEqual(plane["foot_surface_min_z"], -2.6549)
        self.assertEqual(plane["knuckle_surface_min_z"], 188.5)
        # Blender world +Z of the sole, not the glTF Body-relative -184.0 and not the
        # `Foot.tail` height of +142.2.
        self.assertEqual(CANONICAL_CONTACT_PLANE_Z, -2.6549)

    def test_build_control_rig_creates_10_controls_and_preserves_audit_scene_abi(self):
        report = build_control_rig(self.bpy, self.armature, contract=self.contract)
        self.assertEqual(report["deform_bone_count"], 92)
        self.assertEqual(report["control_bone_count"], len(CONTROL_BONE_NAMES))
        self.assertEqual(report["wing_fold_driven_bones_per_side"], len(WING_FOLD_RATIOS))
        self.assertIn("CTRL_IK_Foot_L", report["floor_clamped_controls"])
        self.assertIn("CTRL_IK_WingWrist_L", report["floor_clamped_controls"])

        foot_ctrl = self.armature.pose.bones["CTRL_IK_Foot_L"]
        floor_con = next(c for c in foot_ctrl.constraints if c.name == "CTRL_FloorPlane")
        self.assertEqual(floor_con.type, "LIMIT_LOCATION")
        self.assertTrue(floor_con.use_min_z)
        self.assertEqual(floor_con.min_z, CANONICAL_CONTACT_PLANE_Z)

        scene_audit = build_report(self.bpy, self.contract)
        self.assertEqual(scene_audit["errors"], [])
        self.assertEqual(scene_audit["armature"]["actual_count"], 92)
        self.assertEqual(scene_audit["armature"]["control_bone_count"], len(CONTROL_BONE_NAMES))
        self.assertEqual(
            scene_audit["armature"]["bone_collections"],
            [DEFORM_COLLECTION_NAME, CONTROL_COLLECTION_NAME],
        )

    def test_wing_knuckle_ik_has_elbow_pole(self):
        report = build_control_rig(self.bpy, self.armature, contract=self.contract)
        self.assertEqual(report["ground_contact_ik"], 0.0)

        elbow_ik = next(
            c for c in self.armature.pose.bones["L_WingElbow"].constraints
            if c.name == "CTRL_WingKnuckleIK_L"
        )
        self.assertEqual(elbow_ik.subtarget, "CTRL_IK_WingWrist_L")
        self.assertEqual(elbow_ik.pole_target, self.armature)
        self.assertEqual(elbow_ik.pole_subtarget, "CTRL_Pole_Elbow_L")
        self.assertEqual(elbow_ik.chain_count, 2)
        for side in ("L", "R"):
            self.assertIn(f"CTRL_Pole_Elbow_{side}", CONTROL_BONE_NAMES)
        knee_ik = next(
            c for c in self.armature.pose.bones["L_Calf"].constraints
            if c.name == "CTRL_FootIK_L"
        )
        self.assertEqual(knee_ik.pole_subtarget, "CTRL_Pole_Knee_L")

    def test_panel_bisect_is_a_back_solved_pass_not_a_constraint(self):
        build_control_rig(self.bpy, self.armature, contract=self.contract)
        for side in ("L", "R"):
            for panel in range(4):
                for segment in range(2):
                    pb = self.armature.pose.bones[f"{side}_WingPanel{panel}_{segment}"]
                    names = [c.name for c in pb.constraints]
                    self.assertFalse(
                        any(n.startswith("CTRL_PanelBisect_") for n in names),
                        "a COPY_ROTATION pair over-rotates panels; the bisect must be solved, not constrained",
                    )
                    self.assertIn(f"CTRL_WingFold_{side}", names)
        self.assertTrue(callable(apply_panel_bisect))

    def test_tail_chain_is_additive_local_copy_rotation_not_damped_track(self):
        build_control_rig(self.bpy, self.armature, contract=self.contract)
        for seg in range(1, 11):
            pb = self.armature.pose.bones[f"Tail{seg}"]
            con = next(c for c in pb.constraints if c.name == f"CTRL_TailRot_{seg}")
            self.assertEqual(con.type, "COPY_ROTATION")
            self.assertEqual(con.mix_mode, "ADD")
            self.assertEqual(con.target_space, "LOCAL")
            self.assertEqual(con.owner_space, "LOCAL")

    def test_bake_binds_the_armature_slot_before_nla_bake(self):
        build_control_rig(self.bpy, self.armature, contract=self.contract)
        calls: list[tuple[str, str]] = []
        original = ActionCompat.__dict__["setup_slotted_action"]

        def record(action, armature, layer_name="Base"):
            calls.append((action.name, armature.name))
            return original(action, armature, layer_name)

        ActionCompat.setup_slotted_action = staticmethod(record)
        try:
            bake_report = bake_control_rig_to_deform(self.bpy, self.armature, contract=self.contract)
        finally:
            ActionCompat.setup_slotted_action = staticmethod(original)

        self.assertEqual(len(calls), len(self.contract["clips"]))
        self.assertTrue(all(name == "WyvernRig" for _, name in calls))
        self.assertEqual(len(bake_report["baked_actions"]), len(self.contract["clips"]))
        self.assertEqual(len(self.baked_calls), len(self.contract["clips"]))

    def test_bake_control_rig_strips_controls_and_restores_exact_92_bone_deform_contract(self):
        build_control_rig(self.bpy, self.armature, contract=self.contract)
        bake_report = bake_control_rig_to_deform(self.bpy, self.armature, strip_controls=True, contract=self.contract)
        self.assertEqual(len(bake_report["baked_actions"]), 18)
        self.assertGreater(bake_report["cleared_constraints"], 0)
        self.assertEqual(bake_report["removed_control_fcurves"], 18)
        self.assertEqual(bake_report["remaining_deform_bones"], 92)

        remaining_names = [b.name for b in self.armature.data.bones]
        self.assertEqual(remaining_names, [b["name"] for b in self.contract["bones"]])
        for bname in remaining_names:
            self.assertEqual(len(self.armature.pose.bones[bname].constraints), 0)


if __name__ == "__main__":
    unittest.main()
