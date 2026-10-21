from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts/blender'))
import cli


class HeadlessCLITest(unittest.TestCase):
    def test_explicit_headless_uses_factory_settings_and_propagates_exit(self):
        argv = ['cli.py', '--headless', 'status']
        with patch.object(sys, 'argv', argv), patch('subprocess.run') as launch:
            launch.return_value.returncode = 7
            self.assertEqual(cli.main(), 7)
        command = launch.call_args.args[0]
        for flag in ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code']:
            self.assertIn(flag, command)
        forwarded = command[command.index('--') + 1:]
        self.assertEqual(forwarded, ['status'])
        self.assertNotIn('--headless', forwarded)
        self.assertEqual(launch.call_args.kwargs.get('shell', False), False)

    def test_blend_requires_headless(self):
        with patch.object(sys, 'argv', ['cli.py', '--blend', 'candidate.blend', 'status']), patch('subprocess.run') as launch:
            with self.assertRaises(SystemExit):
                cli.main()
            launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
