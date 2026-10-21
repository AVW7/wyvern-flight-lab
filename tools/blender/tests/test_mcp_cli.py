import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PKG = Path(__file__).resolve().parents[3] / 'scripts/blender'
sys.path.insert(0, str(PKG))


class FakeSocket:
    def __init__(self, chunks):
        self.chunks = iter(chunks)
        self.payload = None
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def settimeout(self, value): pass
    def sendall(self, value): self.payload = value
    def recv(self, size): return next(self.chunks, b'')


class MCPClientTest(unittest.TestCase):
    def client(self):
        import mcp_client
        return mcp_client

    def test_fragmented_response_and_protocol(self):
        client = self.client()
        sock = FakeSocket([b'{"status":"ok",', b'"result":{"value":7}}\0'])
        with patch.object(client.socket, 'create_connection', return_value=sock):
            self.assertEqual(client.execute('result = {"value": 7}'), {'value': 7})
        self.assertTrue(sock.payload.endswith(b'\0'))
        self.assertEqual(json.loads(sock.payload[:-1])['strict_json'], True)

    def test_truncated_response_is_failure(self):
        client = self.client()
        with patch.object(client.socket, 'create_connection', return_value=FakeSocket([b'{"status":"ok"}'])):
            with self.assertRaisesRegex(RuntimeError, 'complete'):
                client.execute('pass')

    def test_remote_exception_is_failure(self):
        client = self.client()
        sock = FakeSocket([b'{"status":"error","message":"broken script"}\0'])
        with patch.object(client.socket, 'create_connection', return_value=sock):
            with self.assertRaisesRegex(RuntimeError, 'broken script'):
                client.execute('pass')

    def test_missing_server_has_no_process_fallback(self):
        client = self.client()
        with patch.object(client.socket, 'create_connection', side_effect=ConnectionRefusedError), patch('subprocess.run') as launch:
            with self.assertRaisesRegex(RuntimeError, 'Finder'):
                client.execute('pass')
            launch.assert_not_called()

    def test_timeout_does_not_retry(self):
        client = self.client()
        with patch.object(client.socket, 'create_connection', side_effect=TimeoutError) as connect:
            with self.assertRaisesRegex(RuntimeError, 'may still be executing'):
                client.execute('pass')
            connect.assert_called_once()

    def test_invalid_json_fails(self):
        client = self.client()
        with patch.object(client.socket, 'create_connection', return_value=FakeSocket([b'invalid\0'])):
            with self.assertRaisesRegex(RuntimeError, 'Invalid JSON'):
                client.execute('pass')

    def test_script_exit_and_argv_restoration(self):
        import cli
        client = self.client()
        original_argv = sys.argv

        def local_execute(code, **kwargs):
            namespace = {}
            exec(code, namespace)
            return namespace['result']

        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / 'script with spaces.py'
            script.write_text('print("ran")\nraise SystemExit(7)\n')
            args = cli.build_parser().parse_args(['exec-script', str(script)])
            output = io.StringIO()
            with patch.dict(sys.modules, {'bpy': SimpleNamespace()}), patch.object(client, 'execute', side_effect=local_execute), contextlib.redirect_stdout(output):
                self.assertEqual(cli.run_remote(args), 7)
            self.assertIn('ran', output.getvalue())
            self.assertIs(sys.argv, original_argv)

    def test_audit_glb_supports_both_source_and_runtime_v2_contracts(self):
        import cli
        root = Path(__file__).resolve().parents[3]
        source_glb = root / 'assets/blender/wyvern-gothic.glb'
        runtime_glb = root / 'public/models/wyvern-v2-rig.glb'
        with contextlib.redirect_stdout(io.StringIO()):
            source_args = cli.build_parser().parse_args(['audit-glb', str(source_glb)])
            self.assertEqual(cli.cmd_audit_glb(source_args), 0)
            runtime_args = cli.build_parser().parse_args(['audit-glb', str(runtime_glb)])
            self.assertEqual(cli.cmd_audit_glb(runtime_args), 0)



if __name__ == '__main__':
    unittest.main()
