import builtins
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


class BlenderLaunchPolicyTest(unittest.TestCase):
    def assert_refuses_without_bpy(self, script_name: str):
        script = Path(__file__).resolve().parents[1] / script_name
        original_import = builtins.__import__

        def without_blender(name, *args, **kwargs):
            if name == 'bpy':
                raise ImportError('Blender is not running')
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=without_blender), patch('subprocess.run') as launch:
            with self.assertRaises(SystemExit) as failure:
                runpy.run_path(str(script), run_name='__main__')
            self.assertNotEqual(failure.exception.code, 0)
            self.assertIn('MCP', str(failure.exception.code))
            launch.assert_not_called()

    def test_ground_fold_refuses_to_launch_without_bpy(self):
        self.assert_refuses_without_bpy('author_v2_ground_wing_fold.py')

    def test_bank_panel_coordination_refuses_to_launch_without_bpy(self):
        self.assert_refuses_without_bpy('coordinate_v2_bank_panels_mcp.py')

    def test_locomotion_panel_coordination_refuses_to_launch_without_bpy(self):
        self.assert_refuses_without_bpy('coordinate_v2_locomotion_panels_mcp.py')

    def test_control_rig_authoring_refuses_to_launch_without_bpy(self):
        self.assert_refuses_without_bpy('author_v2_control_rig_mcp.py')


if __name__ == '__main__':
    unittest.main()
