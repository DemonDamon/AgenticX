#!/usr/bin/env python3
"""LSP client manager for IDE-grade code intelligence in AgenticX.

This module provides a lightweight JSON-RPC over stdio client for language
servers and exposes four high-level operations:
- go to definition
- find references
- hover
- diagnostics

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, unquote, urlparse

_log = logging.getLogger(__name__)

# file extension -> (server_command, server_args, language_id)
_DEFAULT_SERVER_MAP: Dict[str, Tuple[str, List[str], str]] = {
    ".py": ("pyright-langserver", ["--stdio"], "python"),
    ".pyi": ("pyright-langserver", ["--stdio"], "python"),
    ".ts": ("typescript-language-server", ["--stdio"], "typescript"),
    ".tsx": ("typescript-language-server", ["--stdio"], "typescriptreact"),
    ".js": ("typescript-language-server", ["--stdio"], "javascript"),
    ".jsx": ("typescript-language-server", ["--stdio"], "javascriptreact"),
}

_IGNORED_PATH_PARTS = {"node_modules", "venv", ".venv", "dist", "build", ".git"}


def _path_to_file_uri(path: Path) -> str:
    resolved = path.resolve(strict=False)
    return f"file://{quote(str(resolved).replace(os.sep, '/'), safe='/:._-~')}"


def _file_uri_to_path(uri: str) -> Path:
    parsed = urlparse(uri)
    if parsed.scheme != "file":
        return Path(uri)
    return Path(unquote(parsed.path))


def _normalize_position(line_1_based: int, column_1_based: int) -> Tuple[int, int]:
    return max(0, int(line_1_based) - 1), max(0, int(column_1_based) - 1)


def _safe_json_dumps(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _desktop_unrestricted_fs_enabled() -> bool:
    value = os.getenv("AGX_DESKTOP_UNRESTRICTED_FS", "").strip().lower()
    return value in {"1", "true", "yes", "on"}


class LSPServer:
    """One running language server process with JSON-RPC communication."""

    def __init__(
        self,
        *,
        language_id: str,
        command: str,
        args: List[str],
        root_uri: str,
        startup_timeout: float = 30.0,
    ) -> None:
        self.language_id = language_id
        self.command = command
        self.args = list(args)
        self.root_uri = root_uri
        self.startup_timeout = startup_timeout
        self._process: Optional[asyncio.subprocess.Process] = None
        self._request_id = 0
        self._pending: Dict[int, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._initialized = False
        self._lock = asyncio.Lock()
        self._diagnostics_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._open_file_versions: Dict[str, int] = {}
        self._opened_files: set[str] = set()

    async def start(self) -> bool:
        """Spawn server process, send initialize + initialized."""
        async with self._lock:
            if self._initialized and self._process is not None:
                return True
            if not shutil.which(self.command):
                _log.warning("LSP server binary not found: %s", self.command)
                return False
            try:
                self._process = await asyncio.create_subprocess_exec(
                    self.command,
                    *self.args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except Exception as exc:
                _log.warning("failed to spawn LSP server %s: %s", self.command, exc)
                return False
            self._reader_task = asyncio.create_task(self._reader_loop())
            try:
                await asyncio.wait_for(
                    self._send_request(
                        "initialize",
                        {
                            "processId": os.getpid(),
                            "rootUri": self.root_uri,
                            "capabilities": {
                                "textDocument": {
                                    "definition": {"dynamicRegistration": False},
                                    "references": {"dynamicRegistration": False},
                                    "hover": {
                                        "dynamicRegistration": False,
                                        "contentFormat": ["plaintext", "markdown"],
                                    },
                                    "publishDiagnostics": {"relatedInformation": True},
                                }
                            },
                        },
                    ),
                    timeout=max(1.0, float(self.startup_timeout)),
                )
                await self._send_notification("initialized", {})
                self._initialized = True
                return True
            except Exception as exc:
                _log.warning("LSP initialize failed for %s: %s", self.language_id, exc)
                await self.shutdown()
                return False

    async def shutdown(self) -> None:
        """Send shutdown + exit, then terminate process."""
        async with self._lock:
            process = self._process
            if process is None:
                return
            try:
                if self._initialized:
                    try:
                        await asyncio.wait_for(
                            self._send_request("shutdown", {}),
                            timeout=2.0,
                        )
                    except Exception:
                        pass
                    try:
                        await self._send_notification("exit", {})
                    except Exception:
                        pass
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    process.kill()
            finally:
                for fut in self._pending.values():
                    if not fut.done():
                        fut.cancel()
                self._pending.clear()
                if self._reader_task is not None and not self._reader_task.done():
                    self._reader_task.cancel()
                self._reader_task = None
                self._process = None
                self._initialized = False
                self._open_file_versions.clear()
                self._opened_files.clear()

    async def _send_request(self, method: str, params: Any) -> Any:
        process = self._process
        if process is None or process.stdin is None:
            raise RuntimeError("LSP process not started")
        self._request_id += 1
        req_id = self._request_id
        payload = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req_id] = future
        await self._write_message(payload)
        try:
            return await asyncio.wait_for(future, timeout=10.0)
        finally:
            self._pending.pop(req_id, None)

    async def _send_notification(self, method: str, params: Any) -> None:
        await self._write_message(
            {"jsonrpc": "2.0", "method": method, "params": params},
        )

    async def _write_message(self, payload: Dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise RuntimeError("LSP process not started")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        process.stdin.write(header + body)
        await process.stdin.drain()

    async def _reader_loop(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        stdout = process.stdout
        while True:
            try:
                header = await stdout.readuntil(b"\r\n\r\n")
            except asyncio.IncompleteReadError:
                break
            except Exception:
                break
            content_length = 0
            for line in header.decode("utf-8", errors="replace").split("\r\n"):
                if line.lower().startswith("content-length:"):
                    try:
                        content_length = int(line.split(":", 1)[1].strip())
                    except Exception:
                        content_length = 0
                    break
            if content_length <= 0:
                continue
            try:
                body = await stdout.readexactly(content_length)
                msg = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                continue

            if "id" in msg:
                req_id = msg.get("id")
                if isinstance(req_id, int):
                    fut = self._pending.get(req_id)
                    if fut is not None and not fut.done():
                        if "error" in msg:
                            fut.set_exception(RuntimeError(str(msg.get("error"))))
                        else:
                            fut.set_result(msg.get("result"))
                continue

            method = str(msg.get("method", ""))
            if method == "textDocument/publishDiagnostics":
                params = msg.get("params", {}) if isinstance(msg.get("params"), dict) else {}
                uri = str(params.get("uri", ""))
                diags = params.get("diagnostics", [])
                if uri:
                    self._diagnostics_cache[uri] = diags if isinstance(diags, list) else []

    async def did_open(self, file_uri: str, language_id: str, text: str) -> None:
        version = self._open_file_versions.get(file_uri, 0) + 1
        self._open_file_versions[file_uri] = version
        self._opened_files.add(file_uri)
        await self._send_notification(
            "textDocument/didOpen",
            {
                "textDocument": {
                    "uri": file_uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text,
                }
            },
        )

    async def did_change(self, file_uri: str, text: str) -> None:
        version = self._open_file_versions.get(file_uri, 0) + 1
        self._open_file_versions[file_uri] = version
        await self._send_notification(
            "textDocument/didChange",
            {
                "textDocument": {"uri": file_uri, "version": version},
                "contentChanges": [{"text": text}],
            },
        )

    async def did_close(self, file_uri: str) -> None:
        if file_uri in self._opened_files:
            await self._send_notification(
                "textDocument/didClose",
                {"textDocument": {"uri": file_uri}},
            )
            self._opened_files.discard(file_uri)

    async def goto_definition(self, file_uri: str, line: int, character: int) -> List[Dict[str, Any]]:
        result = await self._send_request(
            "textDocument/definition",
            {
                "textDocument": {"uri": file_uri},
                "position": {"line": line, "character": character},
            },
        )
        if isinstance(result, dict):
            return [result]
        if isinstance(result, list):
            return [item for item in result if isinstance(item, dict)]
        return []

    async def find_references(self, file_uri: str, line: int, character: int) -> List[Dict[str, Any]]:
        result = await self._send_request(
            "textDocument/references",
            {
                "textDocument": {"uri": file_uri},
                "position": {"line": line, "character": character},
                "context": {"includeDeclaration": True},
            },
        )
        if isinstance(result, list):
            return [item for item in result if isinstance(item, dict)]
        return []

    async def hover(self, file_uri: str, line: int, character: int) -> Optional[str]:
        result = await self._send_request(
            "textDocument/hover",
            {
                "textDocument": {"uri": file_uri},
                "position": {"line": line, "character": character},
            },
        )
        if not isinstance(result, dict):
            return None
        contents = result.get("contents")
        if isinstance(contents, str):
            return contents
        if isinstance(contents, dict):
            value = contents.get("value")
            return str(value) if value is not None else None
        if isinstance(contents, list):
            parts: List[str] = []
            for item in contents:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict) and item.get("value") is not None:
                    parts.append(str(item.get("value")))
            return "\n\n".join(parts) if parts else None
        return None

    async def diagnostics(self, file_uri: str) -> List[Dict[str, Any]]:
        return list(self._diagnostics_cache.get(file_uri, []))

    def diagnostics_all(self) -> Dict[str, List[Dict[str, Any]]]:
        return dict(self._diagnostics_cache)


class LSPManager:
    """Manages multiple LSP server instances keyed by language."""

    def __init__(
        self,
        workspace_root: str,
        *,
        startup_timeout: float = 30.0,
        server_map: Optional[Dict[str, Tuple[str, List[str], str]]] = None,
        enabled: bool = True,
    ) -> None:
        self.workspace_root = str(Path(workspace_root).expanduser().resolve(strict=False))
        self.startup_timeout = startup_timeout
        self.enabled = enabled
        self._servers: Dict[str, LSPServer] = {}
        self._server_map = dict(server_map or _DEFAULT_SERVER_MAP)

    def _resolve_file(self, file: str) -> Path:
        raw = Path(str(file or "").strip()).expanduser()
        workspace = Path(self.workspace_root)
        resolved = raw.resolve(strict=False) if raw.is_absolute() else (workspace / raw).resolve(strict=False)
        if _desktop_unrestricted_fs_enabled():
            return resolved
        try:
            resolved.relative_to(workspace)
        except ValueError as exc:
            raise ValueError(f"path escapes workspace: {resolved}") from exc
        return resolved

    def _detect_language(self, file_path: str) -> Optional[Tuple[str, List[str], str]]:
        suffix = Path(file_path).suffix.lower()
        return self._server_map.get(suffix)

    async def ensure_server_for_file(self, file_path: str) -> Optional[LSPServer]:
        if not self.enabled:
            return None
        config = self._detect_language(file_path)
        if config is None:
            return None
        command, args, language_id = config
        server = self._servers.get(language_id)
        if server is not None:
            return server
        root_uri = _path_to_file_uri(Path(self.workspace_root))
        server = LSPServer(
            language_id=language_id,
            command=command,
            args=args,
            root_uri=root_uri,
            startup_timeout=self.startup_timeout,
        )
        ok = await server.start()
        if not ok:
            return None
        self._servers[language_id] = server
        return server

    async def shutdown_all(self) -> None:
        servers = list(self._servers.values())
        self._servers.clear()
        for server in servers:
            try:
                await server.shutdown()
            except Exception:
                pass

    async def _ensure_open(self, server: LSPServer, file_path: Path) -> str:
        file_uri = _path_to_file_uri(file_path)
        text = file_path.read_text(encoding="utf-8", errors="replace")
        if file_uri in server._opened_files:
            await server.did_change(file_uri, text)
        else:
            await server.did_open(file_uri, server.language_id, text)
        return file_uri

    async def _is_git_ignored(self, path: Path) -> bool:
        # Fast guard for common ignored directories.
        if any(part in _IGNORED_PATH_PARTS for part in path.parts):
            return True
        try:
            proc = await asyncio.to_thread(
                subprocess.run,
                ["git", "check-ignore", str(path)],
                cwd=self.workspace_root,
                capture_output=True,
                text=True,
            )
            return proc.returncode == 0
        except Exception:
            return False

    async def tool_goto_definition(self, file: str, line: int, column: int) -> str:
        try:
            file_path = self._resolve_file(file)
        except ValueError as exc:
            return _safe_json_dumps({"ok": False, "error": str(exc)})
        if not file_path.exists() or not file_path.is_file():
            return _safe_json_dumps({"ok": False, "error": f"file not found: {file_path}"})
        server = await self.ensure_server_for_file(str(file_path))
        if server is None:
            return _safe_json_dumps(
                {
                    "ok": False,
                    "error": "LSP server unavailable (not installed or unsupported file type)",
                },
            )
        lsp_line, lsp_col = _normalize_position(line, column)
        file_uri = await self._ensure_open(server, file_path)
        items = await server.goto_definition(file_uri, lsp_line, lsp_col)
        rows: List[Dict[str, Any]] = []
        for item in items:
            uri = str(item.get("uri", ""))
            rng = item.get("range", {}) if isinstance(item.get("range"), dict) else {}
            target_path = _file_uri_to_path(uri)
            rows.append(
                {
                    "path": str(target_path),
                    "start": rng.get("start", {}),
                    "end": rng.get("end", {}),
                },
            )
        return _safe_json_dumps({"ok": True, "count": len(rows), "definitions": rows})

    async def tool_find_references(self, file: str, line: int, column: int) -> str:
        try:
            file_path = self._resolve_file(file)
        except ValueError as exc:
            return _safe_json_dumps({"ok": False, "error": str(exc)})
        if not file_path.exists() or not file_path.is_file():
            return _safe_json_dumps({"ok": False, "error": f"file not found: {file_path}"})
        server = await self.ensure_server_for_file(str(file_path))
        if server is None:
            return _safe_json_dumps(
                {
                    "ok": False,
                    "error": "LSP server unavailable (not installed or unsupported file type)",
                },
            )
        lsp_line, lsp_col = _normalize_position(line, column)
        file_uri = await self._ensure_open(server, file_path)
        items = await server.find_references(file_uri, lsp_line, lsp_col)
        rows: List[Dict[str, Any]] = []
        for item in items:
            uri = str(item.get("uri", ""))
            rng = item.get("range", {}) if isinstance(item.get("range"), dict) else {}
            target_path = _file_uri_to_path(uri).resolve(strict=False)
            if await self._is_git_ignored(target_path):
                continue
            rows.append(
                {
                    "path": str(target_path),
                    "start": rng.get("start", {}),
                    "end": rng.get("end", {}),
                },
            )
        return _safe_json_dumps({"ok": True, "count": len(rows), "references": rows})

    async def tool_hover(self, file: str, line: int, column: int) -> str:
        try:
            file_path = self._resolve_file(file)
        except ValueError as exc:
            return _safe_json_dumps({"ok": False, "error": str(exc)})
        if not file_path.exists() or not file_path.is_file():
            return _safe_json_dumps({"ok": False, "error": f"file not found: {file_path}"})
        server = await self.ensure_server_for_file(str(file_path))
        if server is None:
            return _safe_json_dumps(
                {
                    "ok": False,
                    "error": "LSP server unavailable (not installed or unsupported file type)",
                },
            )
        lsp_line, lsp_col = _normalize_position(line, column)
        file_uri = await self._ensure_open(server, file_path)
        text = await server.hover(file_uri, lsp_line, lsp_col)
        return _safe_json_dumps({"ok": True, "hover": text or ""})

    async def tool_diagnostics(self, file: Optional[str] = None) -> str:
        if file:
            try:
                file_path = self._resolve_file(file)
            except ValueError as exc:
                return _safe_json_dumps({"ok": False, "error": str(exc)})
            if not file_path.exists() or not file_path.is_file():
                return _safe_json_dumps({"ok": False, "error": f"file not found: {file_path}"})
            server = await self.ensure_server_for_file(str(file_path))
            if server is None:
                return _safe_json_dumps(
                    {
                        "ok": False,
                        "error": "LSP server unavailable (not installed or unsupported file type)",
                    },
                )
            file_uri = await self._ensure_open(server, file_path)
            diags = await server.diagnostics(file_uri)
            return _safe_json_dumps(
                {
                    "ok": True,
                    "file": str(file_path),
                    "count": len(diags),
                    "diagnostics": diags,
                },
            )

        all_rows: List[Dict[str, Any]] = []
        for server in self._servers.values():
            for uri, diags in server.diagnostics_all().items():
                all_rows.append(
                    {
                        "file": str(_file_uri_to_path(uri)),
                        "count": len(diags),
                        "diagnostics": diags,
                    },
                )
        return _safe_json_dumps({"ok": True, "files": all_rows, "count": len(all_rows)})
