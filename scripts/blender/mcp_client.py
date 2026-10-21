"""Null-delimited JSON transport for the installed Blender MCP addon."""

import json
import socket
import time

# Matches mcp_to_blender_server.py's _MAX_REQUEST_BYTES; also bounds local responses.
MAX_BYTES = 10 * 1024 * 1024


def execute(code: str, port: int = 9876, timeout: float = 30.0) -> dict:
    if timeout <= 0:
        raise ValueError('Timeout must be positive')
    request = json.dumps({'type': 'execute', 'code': code, 'strict_json': True}).encode() + b'\0'
    if len(request) - 1 > MAX_BYTES:
        raise RuntimeError('MCP request exceeds the addon 10 MiB limit')
    deadline = time.monotonic() + timeout
    data = bytearray()
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout) as conn:
            conn.sendall(request)
            while b'\0' not in data:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('MCP response deadline exceeded')
                conn.settimeout(remaining)
                chunk = conn.recv(4096)
                if not chunk:
                    raise RuntimeError('Blender disconnected before a complete MCP response')
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise RuntimeError('MCP response exceeds 10 MiB limit')
    except TimeoutError as exc:
        raise RuntimeError('MCP timed out; Blender may still be executing. Inspect it before retrying.') from exc
    except OSError as exc:
        raise RuntimeError('Cannot connect to Blender MCP. Open Blender from Finder and start its MCP server.') from exc
    try:
        response = json.loads(data.split(b'\0', 1)[0])
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError('Invalid JSON from Blender MCP') from exc
    if not isinstance(response, dict) or response.get('status') != 'ok':
        message = response.get('message', 'Invalid MCP response') if isinstance(response, dict) else 'Invalid MCP response'
        raise RuntimeError(message)
    result = response.get('result')
    if not isinstance(result, dict):
        raise RuntimeError('Blender MCP result must be an object')
    return result
