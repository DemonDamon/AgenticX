#!/usr/bin/env python3
"""AgenticX Remote Sandbox Backend.

Connects to a remote microsandbox/Docker server over HTTP, enabling
Docker+K8s tier isolation without requiring Docker on the local machine.

Typical deployment: microsandbox server running in a K8s Pod with a
Service/Ingress exposing port 5555.

Author: Damon Li
"""

import json
import logging
import time
from typing import Dict, List, Optional, Union

from ..base import SandboxBase
from ..template import SandboxTemplate
from ..types import (
    ExecutionResult,
    FileInfo,
    HealthStatus,
    ProcessInfo,
    SandboxBackendError,
    SandboxExecutionError,
    SandboxNotReadyError,
    SandboxStatus,
    SandboxTimeoutError,
)

logger = logging.getLogger(__name__)


class RemoteSandbox(SandboxBase):
    """Remote sandbox that delegates execution to a remote server.

    The remote server can be a microsandbox instance running in K8s,
    a Docker host, or any HTTP-compatible sandbox API.
    """

    def __init__(
        self,
        sandbox_id: Optional[str] = None,
        template: Optional[SandboxTemplate] = None,
        server_url: str = "http://127.0.0.1:5555",
        api_key: Optional[str] = None,
        namespace: str = "default",
        image: str = "microsandbox/python",
        fallback_backend: Optional[str] = "docker",
        connect_timeout: float = 10.0,
        **kwargs,
    ):
        super().__init__(sandbox_id=sandbox_id, template=template, **kwargs)
        self._server_url = server_url.rstrip("/")
        self._api_key = api_key
        self._namespace = namespace
        self._image = image
        self._fallback_backend = fallback_backend
        self._connect_timeout = connect_timeout
        self._session = None

    @property
    def server_url(self) -> str:
        return self._server_url

    @property
    def fallback_backend(self) -> Optional[str]:
        return self._fallback_backend

    async def _get_session(self):
        if self._session is None:
            import aiohttp

            timeout = aiohttp.ClientTimeout(total=self._connect_timeout)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self._api_key:
            h["Authorization"] = f"Bearer {self._api_key}"
        return h

    async def _health_check_remote(self) -> bool:
        try:
            session = await self._get_session()
            async with session.get(
                f"{self._server_url}/api/v1/health",
                headers=self._headers(),
            ) as resp:
                return resp.status == 200
        except Exception as e:
            logger.warning("Remote health check failed: %s", e)
            return False

    async def _create_remote_sandbox(self) -> None:
        session = await self._get_session()
        payload = {
            "name": self.sandbox_id,
            "namespace": self._namespace,
            "image": self._image,
            "memory": self._template.memory_mb if self._template else 512,
            "cpus": self._template.cpu if self._template else 1.0,
        }
        async with session.post(
            f"{self._server_url}/api/v1/sandboxes",
            json=payload,
            headers=self._headers(),
        ) as resp:
            if resp.status not in (200, 201):
                body = await resp.text()
                raise SandboxBackendError(
                    f"Failed to create remote sandbox: {resp.status} {body}",
                    backend="remote",
                )

    async def start(self) -> None:
        if self._status == SandboxStatus.RUNNING:
            return

        self._status = SandboxStatus.CREATING
        logger.info("Connecting to remote sandbox server at %s", self._server_url)

        healthy = await self._health_check_remote()
        if not healthy:
            raise SandboxBackendError(
                f"Remote sandbox server unreachable: {self._server_url}",
                backend="remote",
            )

        await self._create_remote_sandbox()
        self._status = SandboxStatus.RUNNING
        self._created_at = time.time()
        logger.info("Remote sandbox %s started", self.sandbox_id)

    async def stop(self) -> None:
        if self._status == SandboxStatus.STOPPED:
            return

        self._status = SandboxStatus.STOPPING
        try:
            session = await self._get_session()
            async with session.delete(
                f"{self._server_url}/api/v1/sandboxes/{self.sandbox_id}",
                headers=self._headers(),
            ):
                pass
        except Exception as e:
            logger.warning("Error stopping remote sandbox: %s", e)
        finally:
            if self._session is not None:
                await self._session.close()
                self._session = None
            self._status = SandboxStatus.STOPPED

    async def _remote_execute(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
    ) -> ExecutionResult:
        session = await self._get_session()
        payload = {
            "code": code,
            "language": language,
            "timeout": timeout or (self._template.timeout_seconds if self._template else 30),
        }
        start_time = time.time()
        async with session.post(
            f"{self._server_url}/api/v1/sandboxes/{self.sandbox_id}/execute",
            json=payload,
            headers=self._headers(),
        ) as resp:
            duration_ms = (time.time() - start_time) * 1000
            try:
                body = await resp.json(content_type=None)
            except (json.JSONDecodeError, ValueError):
                text = await resp.text()
                return ExecutionResult(
                    stdout="",
                    stderr=text or f"HTTP {resp.status}",
                    exit_code=1,
                    success=False,
                    duration_ms=duration_ms,
                    language=language,
                )
            return ExecutionResult(
                stdout=body.get("stdout", ""),
                stderr=body.get("stderr", ""),
                exit_code=body.get("exit_code", 0 if resp.status == 200 else 1),
                success=body.get("success", resp.status == 200),
                duration_ms=duration_ms,
                language=language,
            )

    async def execute(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
        **kwargs,
    ) -> ExecutionResult:
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError(
                f"Remote sandbox {self.sandbox_id} is not running"
            )

        self._update_activity()
        try:
            result = await self._remote_execute(code, language, timeout)
            self._audit_record("execute", code, result, language=language)
            return result
        except SandboxNotReadyError:
            raise
        except TimeoutError as e:
            raise SandboxTimeoutError(
                f"Remote execution timed out: {e}",
                timeout=timeout or 0,
            ) from e
        except Exception as e:
            raise SandboxBackendError(
                f"Remote execution failed: {e}",
                backend="remote",
            ) from e

    async def check_health(self) -> HealthStatus:
        start = time.time()
        healthy = await self._health_check_remote()
        latency = (time.time() - start) * 1000
        return HealthStatus(
            status="ok" if healthy else "unhealthy",
            message="Remote sandbox healthy"
            if healthy
            else "Remote sandbox unreachable",
            latency_ms=latency,
        )

    async def read_file(self, path: str) -> str:
        result = await self.execute(
            f"with open({repr(path)}) as f: print(f.read(), end='')",
            language="python",
        )
        if not result.success:
            raise FileNotFoundError(f"Remote file not found: {path}")
        return result.stdout

    async def write_file(self, path: str, content: Union[str, bytes]) -> None:
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        import base64

        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        code = (
            f"import base64, os\n"
            f"os.makedirs(os.path.dirname({repr(path)}) or '.', exist_ok=True)\n"
            f"with open({repr(path)}, 'w') as f:\n"
            f"    f.write(base64.b64decode({repr(encoded)}).decode('utf-8'))"
        )
        result = await self.execute(code, language="python")
        if not result.success:
            raise SandboxExecutionError(f"Failed to write remote file: {path}")

    async def list_directory(self, path: str = "/") -> List[FileInfo]:
        code = (
            f"import os, json, stat\n"
            f"files = []\n"
            f"for n in os.listdir({repr(path)}):\n"
            f"    fp = os.path.join({repr(path)}, n)\n"
            f"    st = os.stat(fp)\n"
            f"    files.append({{'path': fp, 'size': st.st_size, "
            f"'is_dir': stat.S_ISDIR(st.st_mode)}})\n"
            f"print(json.dumps(files))"
        )
        result = await self.execute(code, language="python")
        if not result.success:
            raise FileNotFoundError(f"Remote directory not found: {path}")
        items = json.loads(result.stdout.strip())
        return [
            FileInfo(path=i["path"], size=i["size"], is_dir=i["is_dir"])
            for i in items
        ]

    async def delete_file(self, path: str) -> None:
        code = (
            f"import os, shutil\n"
            f"shutil.rmtree({repr(path)}) if os.path.isdir({repr(path)}) "
            f"else os.remove({repr(path)})"
        )
        await self.execute(code, language="python")

    async def run_command(
        self, command: str, timeout: Optional[int] = None
    ) -> ExecutionResult:
        result = await self.execute(command, language="shell", timeout=timeout)
        return result

    async def list_processes(self) -> List[ProcessInfo]:
        return []

    async def kill_process(self, pid: int, signal: int = 15) -> None:
        await self.execute(
            f"import os; os.kill({pid}, {signal})",
            language="python",
        )


def is_remote_available(server_url: str = "http://127.0.0.1:5555") -> bool:
    """Synchronous check if remote sandbox server is reachable."""
    import urllib.error
    import urllib.request

    base = server_url.rstrip("/")
    try:
        req = urllib.request.Request(
            f"{base}/api/v1/health",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError, TimeoutError, ValueError):
        return False
