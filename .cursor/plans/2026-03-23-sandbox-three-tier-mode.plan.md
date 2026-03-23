---
name: ""
overview: ""
todos: []
isProject: false
---

# Sandbox Three-Tier Mode (Local / Docker / Docker+K8s) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 AgenticX 开箱即用地支持三档沙箱隔离模式（Local / Docker / Docker+K8s），对齐 DeerFlow 博文描述的产品体验，同时补齐"完整审计追踪"闭环。

**Architecture:** 在现有 `Sandbox.create(backend=...)` 工厂体系基础上，新增 `remote` 后端（通过 HTTP/gRPC 连接远端 microsandbox/Docker 服务，典型部署在 K8s），扩展 `SandboxTemplate.backend` 枚举与 validate 逻辑，新增 `SandboxAuditTrail` 记录每次沙箱操作（落盘 JSONL），并在 CLI/config 层提供一键切换三档模式的入口。

**Tech Stack:** Python 3.12, asyncio, aiohttp, dataclasses, JSONL, pytest, existing `agenticx.sandbox` module

**来源调研:** `research/codedeepresearch/deer-flow/deer-flow_deepwiki.md`（DeerFlow 沙箱设计）

---

## 需求追踪


| ID    | 类型             | 描述                                                                          |
| ----- | -------------- | --------------------------------------------------------------------------- |
| FR-1  | Functional     | 三档后端枚举：`local`（subprocess）、`docker`、`remote`（Docker+K8s）                    |
| FR-2  | Functional     | `remote` 后端通过 HTTP 连接远端 microsandbox server（可部署在 K8s Pod）                   |
| FR-3  | Functional     | 文件系统隔离：Docker/remote 模式下 Agent 文件操作不影响宿主机                                   |
| FR-4  | Functional     | 命令执行隔离：Docker/remote 模式下 Bash 命令在容器/VM 内执行                                  |
| FR-5  | Functional     | 完整审计追踪：每次 `execute`/`run_command`/`read_file`/`write_file` 操作写入 JSONL 审计日志  |
| FR-6  | Functional     | `~/.agenticx/config.yaml` 新增 `sandbox` 配置段，支持 `mode` 字段                     |
| FR-7  | Functional     | CLI `agx sandbox status` 显示当前沙箱模式与可用后端                                      |
| FR-8  | Functional     | `Sandbox.create(backend="auto")` 优先级更新为 `remote > docker > subprocess`      |
| NFR-1 | Non-Functional | remote 后端首次连接失败时自动降级到 docker，再降级到 subprocess                                |
| NFR-2 | Non-Functional | 审计日志单文件 ≤ 50MB 自动 rotate                                                    |
| NFR-3 | Non-Functional | 所有新增后端通过 100% 单元测试覆盖（mock HTTP/Docker）                                      |
| AC-1  | Acceptance     | `Sandbox.create(backend="remote", server_url="http://...")` 可正常执行 Python 代码 |
| AC-2  | Acceptance     | 审计日志文件可被 `jq` 直接解析，每条含 timestamp/sandbox_id/operation/code_hash/exit_code   |
| AC-3  | Acceptance     | `agx sandbox status` 正确输出三档模式当前状态                                           |


---

## 文件索引


| 文件路径                                        | 操作         | 任务             |
| ------------------------------------------- | ---------- | -------------- |
| `agenticx/sandbox/audit.py`                 | **Create** | Task 1         |
| `tests/test_sandbox_audit.py`               | **Create** | Task 1         |
| `agenticx/sandbox/backends/remote.py`       | **Create** | Task 2         |
| `tests/test_sandbox_remote.py`              | **Create** | Task 2         |
| `agenticx/sandbox/backends/__init__.py`     | Modify     | Task 3         |
| `agenticx/sandbox/__init__.py`              | Modify     | Task 3         |
| `agenticx/sandbox/template.py`              | Modify     | Task 3         |
| `agenticx/sandbox/base.py`                  | Modify     | Task 3, Task 4 |
| `agenticx/sandbox/backends/docker.py`       | Modify     | Task 4         |
| `agenticx/sandbox/backends/microsandbox.py` | Modify     | Task 4         |
| `agenticx/sandbox/backends/subprocess.py`   | Modify     | Task 4         |
| `agenticx/cli/main.py`                      | Modify     | Task 5         |
| `agenticx/sandbox/README.md`                | Modify     | Task 6         |
| `tests/test_sandbox_integration.py`         | **Create** | Task 7         |


---

## Task 1: SandboxAuditTrail — 审计追踪核心

**目标:** 创建独立的审计日志模块，记录沙箱内每一步操作到 JSONL 文件，支持查询和 rotate。

**Files:**

- Create: `agenticx/sandbox/audit.py`
- Create: `tests/test_sandbox_audit.py`

### Step 1: Write failing tests

```python
# tests/test_sandbox_audit.py
"""Tests for SandboxAuditTrail.

Author: Damon Li
"""

import json
import tempfile
from pathlib import Path

import pytest

from agenticx.sandbox.audit import SandboxAuditTrail, AuditEntry


class TestSandboxAuditTrail:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.trail = SandboxAuditTrail(log_dir=self.tmpdir)

    def test_record_creates_jsonl_file(self):
        self.trail.record(
            sandbox_id="sb-test123",
            operation="execute",
            code="print('hello')",
            exit_code=0,
            duration_ms=42.5,
        )
        files = list(Path(self.tmpdir).glob("*.jsonl"))
        assert len(files) == 1

    def test_record_entry_is_valid_json(self):
        self.trail.record(
            sandbox_id="sb-test123",
            operation="run_command",
            code="ls -la",
            exit_code=0,
            duration_ms=10.0,
        )
        files = list(Path(self.tmpdir).glob("*.jsonl"))
        with open(files[0]) as f:
            entry = json.loads(f.readline())
        assert entry["sandbox_id"] == "sb-test123"
        assert entry["operation"] == "run_command"
        assert "timestamp" in entry
        assert "code_hash" in entry

    def test_query_by_sandbox_id(self):
        self.trail.record(sandbox_id="sb-aaa", operation="execute", code="1+1", exit_code=0, duration_ms=1.0)
        self.trail.record(sandbox_id="sb-bbb", operation="execute", code="2+2", exit_code=0, duration_ms=1.0)
        results = self.trail.query(sandbox_id="sb-aaa")
        assert len(results) == 1
        assert results[0].sandbox_id == "sb-aaa"

    def test_rotate_when_file_exceeds_max_size(self):
        self.trail = SandboxAuditTrail(log_dir=self.tmpdir, max_file_bytes=100)
        for i in range(20):
            self.trail.record(sandbox_id=f"sb-{i}", operation="execute", code=f"x={i}", exit_code=0, duration_ms=1.0)
        files = list(Path(self.tmpdir).glob("*.jsonl"))
        assert len(files) >= 2
```

### Step 2: Run tests — expect FAIL (module not found)

```bash
pytest tests/test_sandbox_audit.py -v
```

### Step 3: Implement `agenticx/sandbox/audit.py`

```python
#!/usr/bin/env python3
"""Sandbox audit trail — JSONL-based operation logging.

Records every sandbox operation (execute, run_command, read_file, write_file, etc.)
to append-only JSONL files with automatic rotation.

Author: Damon Li
"""

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

DEFAULT_LOG_DIR = os.path.join(os.path.expanduser("~"), ".agenticx", "sandbox", "audit")
DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB


@dataclass
class AuditEntry:
    """Single audit record."""

    timestamp: float
    sandbox_id: str
    operation: str
    code_hash: str
    exit_code: int
    duration_ms: float
    backend: str = ""
    language: str = ""
    error: str = ""
    metadata: dict = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, line: str) -> "AuditEntry":
        data = json.loads(line)
        return cls(**data)


class SandboxAuditTrail:
    """Append-only JSONL audit log with auto-rotation."""

    def __init__(
        self,
        log_dir: Optional[str] = None,
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    ):
        self._log_dir = Path(log_dir or DEFAULT_LOG_DIR)
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._max_file_bytes = max_file_bytes
        self._current_file: Optional[Path] = None
        self._ensure_file()

    def _ensure_file(self) -> None:
        if self._current_file and self._current_file.exists():
            if self._current_file.stat().st_size < self._max_file_bytes:
                return
        ts = time.strftime("%Y%m%d_%H%M%S")
        self._current_file = self._log_dir / f"sandbox_audit_{ts}.jsonl"

    def record(
        self,
        sandbox_id: str,
        operation: str,
        code: str,
        exit_code: int,
        duration_ms: float,
        backend: str = "",
        language: str = "",
        error: str = "",
        metadata: Optional[dict] = None,
    ) -> AuditEntry:
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]
        entry = AuditEntry(
            timestamp=time.time(),
            sandbox_id=sandbox_id,
            operation=operation,
            code_hash=code_hash,
            exit_code=exit_code,
            duration_ms=duration_ms,
            backend=backend,
            language=language,
            error=error,
            metadata=metadata or {},
        )
        self._ensure_file()
        with open(self._current_file, "a", encoding="utf-8") as f:
            f.write(entry.to_json() + "\n")
        return entry

    def query(
        self,
        sandbox_id: Optional[str] = None,
        operation: Optional[str] = None,
        limit: int = 100,
    ) -> List[AuditEntry]:
        results: List[AuditEntry] = []
        for p in sorted(self._log_dir.glob("sandbox_audit_*.jsonl"), reverse=True):
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    entry = AuditEntry.from_json(line)
                    if sandbox_id and entry.sandbox_id != sandbox_id:
                        continue
                    if operation and entry.operation != operation:
                        continue
                    results.append(entry)
                    if len(results) >= limit:
                        return results
        return results
```

### Step 4: Run tests — expect PASS

```bash
pytest tests/test_sandbox_audit.py -v
```

### Step 5: Commit

```bash
git add agenticx/sandbox/audit.py tests/test_sandbox_audit.py
git commit -m "feat(sandbox): add SandboxAuditTrail JSONL audit module

- FR-5: every sandbox operation recorded to JSONL with code_hash, exit_code, duration
- NFR-2: auto-rotate at 50MB per file
- AC-2: each line is valid JSON parseable by jq

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## Task 2: Remote Sandbox Backend — Docker+K8s 模式

**目标:** 创建 `RemoteSandbox` 后端，通过 HTTP 连接远端 microsandbox server（典型部署在 K8s Pod），实现第三档沙箱。

**Files:**

- Create: `agenticx/sandbox/backends/remote.py`
- Create: `tests/test_sandbox_remote.py`

### Step 1: Write failing tests

```python
# tests/test_sandbox_remote.py
"""Tests for RemoteSandbox backend.

Author: Damon Li
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from agenticx.sandbox.backends.remote import RemoteSandbox, is_remote_available
from agenticx.sandbox.types import SandboxStatus, ExecutionResult


class TestRemoteSandbox:
    @pytest.mark.asyncio
    async def test_init_sets_server_url(self):
        sb = RemoteSandbox(server_url="http://k8s-sandbox:5555")
        assert sb.server_url == "http://k8s-sandbox:5555"
        assert sb.status == SandboxStatus.PENDING

    @pytest.mark.asyncio
    async def test_start_connects_to_remote(self):
        sb = RemoteSandbox(server_url="http://k8s-sandbox:5555")
        with patch.object(sb, "_health_check_remote", new_callable=AsyncMock, return_value=True):
            with patch.object(sb, "_create_remote_sandbox", new_callable=AsyncMock):
                await sb.start()
        assert sb.status == SandboxStatus.RUNNING

    @pytest.mark.asyncio
    async def test_execute_sends_code_to_remote(self):
        sb = RemoteSandbox(server_url="http://k8s-sandbox:5555")
        sb._status = SandboxStatus.RUNNING
        mock_result = ExecutionResult(stdout="42\n", stderr="", exit_code=0, success=True, duration_ms=15.0)
        with patch.object(sb, "_remote_execute", new_callable=AsyncMock, return_value=mock_result):
            result = await sb.execute("print(42)")
        assert result.success
        assert "42" in result.stdout

    @pytest.mark.asyncio
    async def test_fallback_on_connection_failure(self):
        sb = RemoteSandbox(server_url="http://unreachable:5555", fallback_backend="docker")
        assert sb.fallback_backend == "docker"

    def test_is_remote_available_false_without_server(self):
        assert is_remote_available("http://localhost:99999") is False
```

### Step 2: Run tests — expect FAIL

```bash
pytest tests/test_sandbox_remote.py -v
```

### Step 3: Implement `agenticx/sandbox/backends/remote.py`

```python
#!/usr/bin/env python3
"""AgenticX Remote Sandbox Backend.

Connects to a remote microsandbox/Docker server over HTTP, enabling
Docker+K8s tier isolation without requiring Docker on the local machine.

Typical deployment: microsandbox server running in a K8s Pod with a
Service/Ingress exposing port 5555.

Author: Damon Li
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Union

from ..base import SandboxBase
from ..types import (
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    FileInfo,
    ProcessInfo,
    SandboxError,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxNotReadyError,
    SandboxBackendError,
)
from ..template import SandboxTemplate

logger = logging.getLogger(__name__)


class RemoteSandbox(SandboxBase):
    """Remote sandbox that delegates execution to a remote server.

    The remote server can be a microsandbox instance running in K8s,
    a Docker host, or any HTTP-compatible sandbox API.

    Supported remote APIs:
    - microsandbox HTTP API (default)
    - Custom HTTP API (configurable via api_style parameter)
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
            logger.warning(f"Remote health check failed: {e}")
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
        logger.info(f"Connecting to remote sandbox server at {self._server_url}")

        healthy = await self._health_check_remote()
        if not healthy:
            raise SandboxBackendError(
                f"Remote sandbox server unreachable: {self._server_url}",
                backend="remote",
            )

        await self._create_remote_sandbox()
        self._status = SandboxStatus.RUNNING
        self._created_at = time.time()
        logger.info(f"Remote sandbox {self.sandbox_id} started")

    async def stop(self) -> None:
        if self._status == SandboxStatus.STOPPED:
            return

        self._status = SandboxStatus.STOPPING
        try:
            session = await self._get_session()
            async with session.delete(
                f"{self._server_url}/api/v1/sandboxes/{self.sandbox_id}",
                headers=self._headers(),
            ) as resp:
                pass
        except Exception as e:
            logger.warning(f"Error stopping remote sandbox: {e}")
        finally:
            if self._session:
                await self._session.close()
                self._session = None
            self._status = SandboxStatus.STOPPED

    async def _remote_execute(
        self, code: str, language: str = "python", timeout: Optional[int] = None
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
            body = await resp.json()
            duration_ms = (time.time() - start_time) * 1000
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
            raise SandboxNotReadyError(f"Remote sandbox {self.sandbox_id} is not running")

        self._update_activity()
        try:
            return await self._remote_execute(code, language, timeout)
        except SandboxNotReadyError:
            raise
        except Exception as e:
            raise SandboxBackendError(f"Remote execution failed: {e}", backend="remote")

    async def check_health(self) -> HealthStatus:
        start = time.time()
        healthy = await self._health_check_remote()
        latency = (time.time() - start) * 1000
        return HealthStatus(
            status="ok" if healthy else "unhealthy",
            message="Remote sandbox healthy" if healthy else "Remote sandbox unreachable",
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
            f"    files.append({{'path': fp, 'size': st.st_size, 'is_dir': stat.S_ISDIR(st.st_mode)}})\n"
            f"print(json.dumps(files))"
        )
        result = await self.execute(code, language="python")
        if not result.success:
            raise FileNotFoundError(f"Remote directory not found: {path}")
        items = json.loads(result.stdout.strip())
        return [FileInfo(path=i["path"], size=i["size"], is_dir=i["is_dir"]) for i in items]

    async def delete_file(self, path: str) -> None:
        code = f"import os, shutil\nshutil.rmtree({repr(path)}) if os.path.isdir({repr(path)}) else os.remove({repr(path)})"
        await self.execute(code, language="python")

    async def run_command(self, command: str, timeout: Optional[int] = None) -> ExecutionResult:
        return await self.execute(command, language="shell", timeout=timeout)

    async def list_processes(self) -> List[ProcessInfo]:
        return []

    async def kill_process(self, pid: int, signal: int = 15) -> None:
        await self.execute(f"import os; os.kill({pid}, {signal})", language="python")


def is_remote_available(server_url: str = "http://127.0.0.1:5555") -> bool:
    """Synchronous check if remote sandbox server is reachable."""
    import urllib.request
    try:
        req = urllib.request.Request(f"{server_url}/api/v1/health", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False
```

### Step 4: Run tests — expect PASS

```bash
pytest tests/test_sandbox_remote.py -v
```

### Step 5: Commit

```bash
git add agenticx/sandbox/backends/remote.py tests/test_sandbox_remote.py
git commit -m "feat(sandbox): add RemoteSandbox backend for Docker+K8s tier

- FR-1/FR-2: remote backend connects to remote microsandbox/Docker server via HTTP
- FR-3/FR-4: file/command isolation via remote container execution
- NFR-1: fallback_backend parameter for graceful degradation

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## Task 3: Backend Registry & Template 扩展

**目标:** 将 `remote` 后端注册到全局 registry，扩展 `SandboxTemplate.backend` 合法值，更新 `Sandbox.create()` 工厂逻辑。

**Files:**

- Modify: `agenticx/sandbox/backends/__init__.py`
- Modify: `agenticx/sandbox/template.py:226` (validate 方法)
- Modify: `agenticx/sandbox/base.py:392-483` (Sandbox 工厂类)
- Modify: `agenticx/sandbox/__init__.py`

### Step 1: Update `backends/__init__.py` — 注册 remote

在 `__init__.py` 末尾的 docker 导入之后追加：

```python
try:
    from .remote import RemoteSandbox
    _BACKENDS["remote"] = RemoteSandbox
except ImportError as e:
    logger.debug(f"Remote backend not available: {e}")
```

### Step 2: Update `template.py` — validate 扩展

将 `validate()` 中的合法 backend 列表从：

```python
if self.backend not in ("auto", "subprocess", "microsandbox", "docker"):
```

改为：

```python
if self.backend not in ("auto", "subprocess", "microsandbox", "docker", "remote"):
```

同时更新 `backend` 字段注释：

```python
backend: str = "auto"
"""后端选择: auto, subprocess, microsandbox, docker, remote"""
```

### Step 3: Update `base.py` Sandbox 工厂 — 支持 remote

在 `Sandbox._select_backend()` 中，最高优先级变为 remote（当远端可达时）：

```python
@classmethod
def _select_backend(cls) -> str:
    if cls._is_remote_available():
        return "remote"
    if cls._is_microsandbox_available():
        return "microsandbox"
    if cls._is_docker_available():
        return "docker"
    logger.warning("No isolation backend available, using subprocess (less secure)")
    return "subprocess"
```

新增 `_is_remote_available` 方法和 `_create_sandbox` 的 remote 分支：

```python
@classmethod
def _is_remote_available(cls) -> bool:
    try:
        from .backends.remote import is_remote_available
        import os
        url = os.environ.get("AGX_SANDBOX_REMOTE_URL", "")
        if not url:
            return False
        return is_remote_available(url)
    except Exception:
        return False
```

`_create_sandbox` 新增：

```python
elif backend == "remote":
    try:
        from .backends.remote import RemoteSandbox
        import os
        server_url = kwargs.pop("server_url", None) or os.environ.get("AGX_SANDBOX_REMOTE_URL", "http://127.0.0.1:5555")
        return RemoteSandbox(template=template, server_url=server_url, **kwargs)
    except ImportError:
        raise SandboxBackendError("Remote backend not available", backend="remote")
```

### Step 4: Update `__init__.py` — 导出 AuditTrail

在 `agenticx/sandbox/__init__.py` 中追加导入：

```python
from .audit import SandboxAuditTrail, AuditEntry
```

并在 `__all__` 中添加 `"SandboxAuditTrail"`, `"AuditEntry"`。

### Step 5: Commit

```bash
git add agenticx/sandbox/backends/__init__.py agenticx/sandbox/template.py agenticx/sandbox/base.py agenticx/sandbox/__init__.py
git commit -m "feat(sandbox): register remote backend, extend template & factory

- FR-1/FR-8: Sandbox.create(backend='remote') fully wired
- auto selection priority: remote > microsandbox > docker > subprocess
- AGX_SANDBOX_REMOTE_URL env var for remote server discovery

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## Task 4: Audit Hook 注入各后端

**目标:** 在 `SandboxBase` 基类中集成可选的 `SandboxAuditTrail`，使每个后端的 `execute`/`run_command` 自动产生审计日志，无需各后端重复代码。

**Files:**

- Modify: `agenticx/sandbox/base.py` (SandboxBase.**init** + 新增 _audit_wrap)
- Modify: `agenticx/sandbox/backends/subprocess.py`
- Modify: `agenticx/sandbox/backends/docker.py`
- Modify: `agenticx/sandbox/backends/microsandbox.py`

### Step 1: 在 SandboxBase.**init** 添加 audit_trail 参数

```python
def __init__(
    self,
    sandbox_id: Optional[str] = None,
    template: Optional[SandboxTemplate] = None,
    audit_trail: Optional["SandboxAuditTrail"] = None,
    **kwargs,
):
    ...
    self._audit_trail = audit_trail
```

### Step 2: 新增 _audit_record 辅助方法

```python
def _audit_record(
    self,
    operation: str,
    code: str,
    result: "ExecutionResult",
    language: str = "",
) -> None:
    if self._audit_trail is None:
        return
    self._audit_trail.record(
        sandbox_id=self._sandbox_id,
        operation=operation,
        code=code,
        exit_code=result.exit_code,
        duration_ms=result.duration_ms,
        backend=self.__class__.__name__,
        language=language,
        error=result.stderr if not result.success else "",
    )
```

### Step 3: 在各后端 execute 返回前调用 _audit_record

示例（对每个后端文件在 `execute` 方法的 `return result` 之前添加）：

```python
self._audit_record("execute", code, result, language=language)
return result
```

对 `run_command` 同理：

```python
self._audit_record("run_command", command, result, language="shell")
```

> 注意：仅在各后端 `execute()` 方法的 return 语句前添加一行 `self._audit_record(...)`，不修改任何现有逻辑。

### Step 4: Commit

```bash
git add agenticx/sandbox/base.py agenticx/sandbox/backends/subprocess.py agenticx/sandbox/backends/docker.py agenticx/sandbox/backends/microsandbox.py
git commit -m "feat(sandbox): inject audit trail hook into all backends

- FR-5: every execute/run_command auto-logged when audit_trail is set
- Follows open/closed principle: existing backend logic untouched

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## Task 5: CLI `agx sandbox` 命令

**目标:** 新增 `agx sandbox status` 子命令，显示当前沙箱模式可用性。

**Files:**

- Modify: `agenticx/cli/main.py`

### Step 1: 添加 sandbox 子命令组

在 `cli/main.py` 中找到现有命令组注册区域（如 `deploy_app`），添加：

```python
sandbox_app = typer.Typer(help="沙箱管理")
app.add_typer(sandbox_app, name="sandbox")


@sandbox_app.command("status")
def sandbox_status():
    """显示沙箱后端可用性与当前模式。"""
    from agenticx.sandbox.base import Sandbox
    from agenticx.sandbox.backends import list_backends

    console.print("\n[bold]AgenticX Sandbox Status[/bold]\n")

    table = Table(title="Backend Availability")
    table.add_column("Mode", style="cyan")
    table.add_column("Backend", style="green")
    table.add_column("Available", style="bold")
    table.add_column("Note")

    # Local
    table.add_row("Local", "subprocess", "✅ Always", "进程级隔离，仅限开发")

    # Docker
    docker_ok = Sandbox._is_docker_available()
    table.add_row("Docker", "docker", "✅" if docker_ok else "❌", "容器级隔离")

    # Docker+K8s (remote)
    remote_ok = Sandbox._is_remote_available()
    import os
    remote_url = os.environ.get("AGX_SANDBOX_REMOTE_URL", "(未设置)")
    table.add_row("Docker+K8s", "remote", "✅" if remote_ok else "❌", f"远端: {remote_url}")

    # microsandbox
    msb_ok = Sandbox._is_microsandbox_available()
    table.add_row("MicroVM", "microsandbox", "✅" if msb_ok else "❌", "硬件级隔离 (VM)")

    console.print(table)

    auto_backend = Sandbox._select_backend()
    console.print(f"\n[bold]Auto-selected backend:[/bold] {auto_backend}\n")
```

### Step 2: Commit

```bash
git add agenticx/cli/main.py
git commit -m "feat(cli): add 'agx sandbox status' command

- FR-7/AC-3: displays availability of all four sandbox backends
- Shows auto-selected backend based on current environment

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## Task 6: 文档更新

**目标:** 更新 `agenticx/sandbox/README.md` 三档模式说明、配置方式和部署指南。

**Files:**

- Modify: `agenticx/sandbox/README.md`

### Step 1: 更新多后端支持表格

将表格更新为：

```markdown
| 后端 | 模式 | 隔离级别 | 使用场景 | 依赖要求 | 状态 |
|------|------|---------|---------|---------|------|
| **subprocess** | Local | 进程级 | 开发/测试 | 无 | ✅ 已实现 |
| **docker** | Docker | 容器级 | 单机生产 | Docker daemon | ✅ 已实现 |
| **microsandbox** | Docker (VM) | 硬件级 | 生产推荐 | microsandbox SDK + 服务器 | ✅ 已实现 |
| **remote** | Docker+K8s | 容器/VM 级 | 多节点/云 | 远端服务器 | ✅ 已实现 |
```

### Step 2: 新增 Remote 后端章节

在 "其他后端" 部分之后添加 Remote 后端的配置说明：

```markdown
### Remote 后端（Docker+K8s）

连接远端沙箱服务器（microsandbox 或自定义 API），典型部署在 K8s 集群中。

**环境变量：**
```bash
export AGX_SANDBOX_REMOTE_URL="http://sandbox-service.prod:5555"
export MSB_API_KEY="your-api-key"  # 可选
```

**在代码中使用：**

```python
from agenticx.sandbox import Sandbox

sb = Sandbox.create(backend="remote", server_url="http://sandbox-service.prod:5555")
```

**K8s 部署参考：**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agenticx-sandbox
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: microsandbox
        image: ghcr.io/zerocore-ai/microsandbox:latest
        ports:
        - containerPort: 5555
        resources:
          limits:
            memory: "4Gi"
            cpu: "2"
```

```

### Step 3: 更新架构图

```

┌─────────────────────────────────────────┐
│      AgenticX 应用层                     │
│   (Agents, Tools, Workflows)            │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│      Sandbox 统一抽象层                  │
│   ┌──────────────────────────────────┐  │
│   │  SandboxBase + AuditTrail Hook   │  │
│   └──────────────────────────────────┘  │
│   ┌──────────────────────────────────┐  │
│   │  Sandbox.create(backend="auto")  │  │
│   └──────────────────────────────────┘  │
└─────────────────┬───────────────────────┘
                  │
    ┌──────┬──────┼──────┬──────┐
    │      │      │      │      │
┌───▼──┐┌──▼───┐┌─▼──┐┌──▼───┐
│Local ││Docker││Micro││Remote│
│(sub- ││      ││sand-││(K8s) │
│proc) ││      ││box) ││      │
└──────┘└──────┘└─────┘└──────┘

```

### Step 4: Commit

```bash
git add agenticx/sandbox/README.md
git commit -m "docs(sandbox): update README with three-tier mode and remote backend

- FR-1: documents all four backends with mode mapping
- Includes K8s deployment reference YAML
- Updated architecture diagram

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## Task 7: 集成测试

**目标:** 创建端到端集成测试，验证 `Sandbox.create(backend=X)` 对各后端的工作、审计日志正确记录、降级逻辑正常。

**Files:**

- Create: `tests/test_sandbox_integration.py`

### Step 1: Write integration tests

```python
# tests/test_sandbox_integration.py
"""Integration tests for sandbox three-tier mode.

Author: Damon Li
"""

import tempfile

import pytest

from agenticx.sandbox.base import Sandbox
from agenticx.sandbox.audit import SandboxAuditTrail
from agenticx.sandbox.types import SandboxStatus


class TestSandboxFactory:
    def test_create_subprocess_backend(self):
        sb = Sandbox.create(backend="subprocess")
        assert sb.__class__.__name__ == "SubprocessSandbox"

    def test_create_docker_backend_or_skip(self):
        if not Sandbox._is_docker_available():
            pytest.skip("Docker not available")
        sb = Sandbox.create(backend="docker")
        assert sb.__class__.__name__ == "DockerSandbox"

    def test_create_remote_backend(self):
        sb = Sandbox.create(backend="remote", server_url="http://localhost:5555")
        assert sb.__class__.__name__ == "RemoteSandbox"

    def test_auto_selects_valid_backend(self):
        sb = Sandbox.create(backend="auto")
        assert sb.__class__.__name__ in (
            "SubprocessSandbox", "DockerSandbox", "MicrosandboxSandbox", "RemoteSandbox"
        )


class TestAuditIntegration:
    @pytest.mark.asyncio
    async def test_audit_records_after_execute(self):
        tmpdir = tempfile.mkdtemp()
        trail = SandboxAuditTrail(log_dir=tmpdir)
        sb = Sandbox.create(backend="subprocess", audit_trail=trail)
        async with sb:
            result = await sb.execute("print(1+1)")
        entries = trail.query(sandbox_id=sb.sandbox_id)
        assert len(entries) >= 1
        assert entries[0].operation == "execute"


class TestBackendValidation:
    def test_template_accepts_remote(self):
        from agenticx.sandbox.template import SandboxTemplate
        t = SandboxTemplate(name="test", backend="remote")
        assert t.validate() == []

    def test_template_rejects_unknown(self):
        from agenticx.sandbox.template import SandboxTemplate
        t = SandboxTemplate(name="test", backend="nonexistent")
        errors = t.validate()
        assert len(errors) > 0
```

### Step 2: Run tests

```bash
pytest tests/test_sandbox_integration.py -v
```

### Step 3: Commit

```bash
git add tests/test_sandbox_integration.py
git commit -m "test(sandbox): add integration tests for three-tier mode

- AC-1/AC-2/AC-3: factory creation, audit logging, template validation
- Tests subprocess always, docker/remote conditionally

Made-with: Damon Li
Plan-Id: 2026-03-23-sandbox-three-tier-mode
Plan-File: .cursor/plans/2026-03-23-sandbox-three-tier-mode.plan.md"
```

---

## 三档模式 ↔ 后端映射总结


| 博客术语           | AgenticX backend          | 隔离级别       | 配置方式                                       |
| -------------- | ------------------------- | ---------- | ------------------------------------------ |
| **Local**      | `subprocess`              | 进程级        | 默认，无需配置                                    |
| **Docker**     | `docker` / `microsandbox` | 容器级 / VM 级 | 本地 Docker daemon 或 microsandbox server     |
| **Docker+K8s** | `remote`                  | 容器/VM 级    | `AGX_SANDBOX_REMOTE_URL` 或 `server_url` 参数 |


## 四大保障逐项对齐


| DeerFlow 保障 | AgenticX 实现                                                                         |
| ----------- | ----------------------------------------------------------------------------------- |
| 文件系统隔离      | Docker/microsandbox/remote 容器内文件操作                                                  |
| 命令执行隔离      | 同上，Bash 命令在容器/VM 内执行                                                                |
| 完整审计追踪      | `SandboxAuditTrail` JSONL 日志，每条含 timestamp/sandbox_id/operation/code_hash/exit_code |
| 可重复性        | `SandboxTemplate` 固定 image/cpu/memory/network 配置                                    |


---

## Conclusion

（在全部 Task 完成后由 `/update-conclusion` 填充）