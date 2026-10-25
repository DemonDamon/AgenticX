# MA-A07 记忆挂载：会话 resources → 工作目录文件 → CAS 回写版本

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W4 · MA-A07）
Depends-on:
- MA-A06 `.cursor/plans/pending/2026-10-25-ma-a06-credential-broker.plan.md`（**尚未实现**：本子规划使用它新增的 `agenticx/managed/extensions.py`（`SessionExtension` / `TurnContribution` / `TurnSetupError`）、`SessionService.register_create_validator("resources", ...)` / `register_extension_factory`、`LocalTurnExecutor` 的回合前后调用与 `actor.append` 脱敏。以实际实现为准，实施前核对）
- MA-E07 `.cursor/plans/pending/2026-10-25-ma-e07-memory-store-control-plane.plan.md`（**尚未实现**：内部接口 `validate` / `snapshot` / `writes`、路径规则、错误码。以实际实现为准，实施前核对）
- MA-E03 `.cursor/plans/2026-10-25-ma-e03-agent-runtime-service.plan.md`（**尚未实现**：`enterprise/apps/agent-runtime/ma_agent_runtime/{config,app}.py`；进程 HOME 隔离使 `foreign_session_denial` 生效）
- MA-A01..A05 已实现；实际契约见 `.cursor/plans/notes/ma-w1-actual-contracts.md`（必读）

> 风险等级：中。栈：框架 `agenticx/managed`（主体）+ agent-runtime 接线（Python）。
>
> **实施前核对**：`rg -n "class SessionExtension|class TurnContribution|class TurnSetupError|def register_create_validator|def register_extension_factory|def _before_turn|def _after_turn" agenticx/managed`——A06 未合入则本子规划不能开工。

---

## 0. 一句话目标

会话创建时接受 `resources: [{type:"memory_store", memory_store_id, access, instructions?}]`（≤8 个），校验后写入会话；每个回合开始把每个记忆库的全部条目落成文件到 `<workdir>/memory/<mount_name>/`；回合结束（以及每次 `file_write` / `file_edit` 命中可写挂载时）把变化的文件按 CAS 写回为新版本——冲突时**不覆盖**，把本会话内容另存为冲突文件并发 `session.error`；只读挂载在权限层拒绝文件写工具、文件系统去写权限、且永不回写；未挂载的会话（包括其他用户）读不到。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §1.2 | Memory Store 以文件挂载进沙箱，每次写入产生版本 | §5.4 落盘与回写 |
| §1.3 | 企业侧做「连接与挂载」，不另起向量库 | 不索引进 `WorkspaceMemoryStore`（§2 D9） |
| §2.3 | 记忆表 CAS 双写例外；冲突用例必写 | E07 收紧为单一物理写入方；本子规划写冲突 e2e（FR-9） |
| §5.2 | Session 有 `resources` 字段（`list[dict]`，形状未冻结） | §4.1 定义形状（**须先登记 master §12**） |
| §7 W4 门 | read_write 挂载后 Agent 写入的笔记在下一个会话可读；管理员看到版本与来源会话；换一个用户的未挂载会话读不到 | AC FR-12（门测试） |
| §9 MA-A07 | 挂载到工作目录 `memory/<store_name>/`；read_only / read_write；会话内写入回写新版本；冲突走 CAS 重试 | §2 D2 把目录名定为 `<名称 slug>-<id 尾 6 位>`（防同名碰撞，与调研 `zhipu/memory-stores.md` L93 一致） |

### 1.2 调研语义

| 来源 | 语义 | 采纳 |
|---|---|---|
| `zhipu/memory-stores.md` L67-93 | `resources[]`：`type=memory_store`、`memory_store_id`、`access`（缺省 read_write）、`instructions` ≤4096；单会话 ≤8；挂载路径 `<slug>-<ID 尾缀>`，以响应 `resources[].mount_path` 为准 | 全部采纳（路径相对工作目录） |
| 同上 L95-97 | Agent 用普通文件工具读写，每次写入同步为条目并产生版本 | 采纳（回合末 + 写工具后同步） |
| 同上 L174-176 | 冲突 409，读取当前版本按正确前置条件重试，不当网络故障无限重试 | 采纳：同内容视为成功；内容不同另存冲突文件 |
| `volcengine/persistent-memory.md` L68、L99 | 只能在建会话时挂载；不可信输入下谨慎给写权限 | 采纳；系统提示提醒不要写入密钥 |

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `agenticx/managed/host/service.py` | 107-112（A06 改造前） | 非空 `resources` 直接 400 | A06 改为可注册校验器；本子规划注册 `"resources"` 校验器 |
| `agenticx/managed/builder.py` | 117-124、150-157 | `workdir = ensure_session_workdir(session_id, root=workdir_root)`；`session.workspace_dir = str(workdir)`；`taskspaces=[{"id":"default",...}]`；bundle 暴露 `workdir` | 挂载根 = `bundle.workdir / "memory"`，位于唯一写根之内（§2 D3） |
| `agenticx/runtime/session_boundary.py` | 13-14、33-53 | `sessions_root() = HOME/.agenticx/sessions`；`foreign_session_denial` 拒绝其他会话目录 | E03 让 `workdir_root == sessions_root()`，跨会话读取被文件工具拒绝 |
| `agenticx/cli/agent_tools.py` | 5269-5278、5317-5439 | 文件工具解析路径：先 `foreign_session_denial`，写操作只允许写根（会话工作目录）内 | 挂载目录在工作目录内 → 可写挂载天然可写；只读挂载需要额外拦截（§2 D4） |
| 同上 | 322-395 | 只读挂载（`mount_mode: "reference"`）机制存在，但只读根必须在写根**之外**，且相对路径写入只认第一个写根 | 不复用 reference taskspace（放工作目录外会导致相对路径写入可写挂载失败），改用权限钩子 + chmod + 不回写（§2 D4） |
| `agenticx/runtime/command_sandbox.py` | 1226-1300 | bubblewrap 只 bind 写根与只读根；会话目录的父级不可见 | 基线文件放 `<会话目录>/memory-baseline/`（工作目录外），沙箱内 bash 看不到 |
| `agenticx/runtime/hooks/__init__.py` | 33-47 | `before_tool_call` 可 `HookOutcome(blocked=True, reason)`；`after_tool_call` 可读结果 | 只读拦截与写后同步都在钩子里 |
| `agenticx/managed/protocol.py` | 395-411 | `SessionRecord.resources: list[dict[str, Any]]` | 规范化后的挂载描述写入该字段并随会话响应返回 |
| `agenticx/memory/workspace_memory.py` | 98-116 | `WorkspaceMemoryStore` 是个人模式 SQLite 索引（`~/.agenticx/workspace`） | 托管记忆不进入它（§2 D9） |
| `file_write` / `file_edit` schema（`agent_tools.py` `STUDIO_TOOLS`） | — | 参数名均为 `path`（`file_edit` 另有 `old_text` / `new_text`） | 钩子按 `arguments["path"]` 判断 |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **只读写 E07 内部接口**：`EnterpriseMemoryStoreClient` 调 `validate` / `snapshot` / `writes`；agent-runtime 不连记忆表 | E07 D1 单一物理写入方 |
| D2 | **挂载目录名** `mount_name = <slug(name)>-<store_id 末 6 位小写>`；同一会话内仍重名则追加 `-2`、`-3`；对外字段 `mount_path = "memory/<mount_name>"`（相对工作目录） | 防同名碰撞；与调研一致；登记 master §12（master 原文写 `memory/<store_name>/`） |
| D3 | **挂载在工作目录之内**：`<workdir>/memory/<mount_name>/`。可写挂载无需任何权限改造 | 相对路径 `memory/x/a.md` 直接落在写根内；沙箱、文件工具都已允许 |
| D4 | **只读的三层保证**：① `MemoryMountHook.before_tool_call` 拒绝 `file_write` / `file_edit` 指向只读挂载内的路径（明确错误文本，模型不再重试）；② 落盘后对只读挂载 `chmod`（文件 0444、目录 0555，尽力而为——同 uid 进程可以改回）；③ **只读挂载永不回写**，下回合开始用库内容重新落盘覆盖本地改动，并在回合末检测到本地改动时发 `session.error{type:"memory_read_only_violation"}`。数据完整性由 ③ 保证，①② 只是让模型尽早知道 | bash 命令无法可靠解析写路径；真正不可篡改的是「不回写」 |
| D5 | **挂载授权**：`read_only` 需调用方 scopes 含 `ma:memory:read` / `ma:memory:write` / `ma:admin` 之一；`read_write` 需 `ma:memory:write` 或 `ma:admin`；否则 403 `forbidden_scope` | 与 A06 的 `ma:vaults:read` 同一思路；不新增 scope |
| D6 | **冲突策略（禁止 last-writer-wins）**：CAS 失败时取响应里的 `current`：<br>① `current.content_sha256 == 本地 sha` → 视为成功（别人写了一样的内容），基线采用 `current`；<br>② 本地是**删除**、远端已改 → 保留远端（不删），发 `memory_write_conflict`；<br>③ 其余（本地新建 / 修改与远端不同）→ 把本地内容以新路径 `<path>.conflict-<会话 id 末 8 位小写>`（已存在则 `-2`…`-9`）**创建**为新记忆，本地同步写出该冲突文件，原路径基线采用 `current`（下回合落盘会变成远端内容），发 `session.error{type:"memory_write_conflict", message:"memory /x was changed by another writer; this session's version was saved as /x.conflict-abcd1234"}`；<br>④ 冲突文件也失败（9 个后缀都占用 / 限额）→ 发 `memory_sync_failed`，本地文件保持不动，下次同步重试 | 保留双方内容、对用户可见、不无限重试；`session.error` 不中断会话 |
| D7 | **同步时机**：回合开始（先回写遗留本地改动，再拉快照落盘）、`file_write` / `file_edit` 命中可写挂载之后、回合结束。同一挂载的同步用 `asyncio.Lock` 串行 | 回合开始的回写兜住进程崩溃后的遗留改动；写工具后即时同步缩短冲突窗口 |
| D8 | **基线文件** `<workdir>.parent / "memory-baseline" / "<mount_name>.json"`（会话目录内、工作目录外）：`{"store_id","mount_name","access","entries":{path:{"memory_id","version","sha256"}}}` | 沙箱与文件工具都碰不到；进程重启后可恢复 diff |
| D9 | **不做语义检索 / 不进 `WorkspaceMemoryStore`**；Agent 用 `file_read` / `list_files` / `bash grep` 访问 | master §1.3；避免托管数据进入个人模式索引 |
| D10 | **失败策略**：快照拉取失败 / 403 / 404 → 本回合不调用模型，`session.error{type:"memory_mount_failed"}` + `retries_exhausted`（A06 的 `TurnSetupError` 机制）；回写的瞬时错误重试 3 次（0.5 / 1 / 2 秒）后发 `memory_sync_failed`、保留本地改动待下次同步 | 不在缺记忆的状态下执行；不丢写入 |
| D11 | **`desktop_worker` 环境 v1 不支持 `resources`**：400 `resources are not supported for desktop_worker environments` | 与 A06 D8 一致 |
| D12 | **拒收的本地条目**：符号链接（防止把工作目录外的文件读进记忆库）、非常规文件、非法路径、非 UTF-8、>100 KiB、超出 2000 条 → 跳过并发 `session.error{type:"memory_entry_rejected"}`（同一会话同一路径同一原因只报一次） | 安全与限额与 E07 一致 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

框架（新建）：
- `agenticx/managed/memory.py`
- `agenticx/managed/memory_mount.py`

agent-runtime（修改，E03 产物）：
- `enterprise/apps/agent-runtime/ma_agent_runtime/config.py`（`Settings` 加 `memory_enabled`）
- `enterprise/apps/agent-runtime/ma_agent_runtime/app.py`（`build_app` 加接线 3 行）
- `enterprise/apps/agent-runtime/README.md`（追加「记忆挂载」一节）

测试（新建）：
- `tests/managed/test_memory_path.py`
- `tests/managed/test_memory_client.py`
- `tests/managed/test_memory_mount.py`
- `tests/managed/test_memory_mount_e2e.py`
- `tests/managed/test_w4_memory_gate.py`
- `enterprise/apps/agent-runtime/tests/test_memory_wiring.py`

文档：
- `docs/managed-agents/threat-model.md`（§2「跨会话访问」末尾追加「MA-A07 落地」一段；§5 末尾追加「记忆沉淀不可信内容」一段）

### 3.2 Out of scope（不得修改）

- `agenticx/managed/**` 中除上述两个新文件外的所有文件（A06 已提供扩展点；若发现扩展点不够用，回到 A06 / master 确认，不得在本子规划里改 actor / service）。
- `agenticx/cli/**`、`agenticx/runtime/**`、`agenticx/studio/**`、`agenticx/memory/**`、`enterprise/apps/admin-console/**`（E07）、`desktop/**`。
- 运行中追加 / 移除挂载、Multi-agent 线程共享挂载语义（MA-A08）、记忆整理（MA-A10）、语义检索、`agx ma serve --dev` 的本地记忆库（dev host 继续拒绝 `resources`）。

---

## 4. 数据形状

### 4.1 建会话请求与会话记录中的 `resources`

请求（`POST /ma/v1/sessions` body 的 `resources`）：

```json
[
  { "type": "memory_store", "memory_store_id": "01JSTOREAAAAAAAAAAAAAAAAAA", "access": "read_write",
    "instructions": "把用户的长期偏好写到 /preferences/ 下" },
  { "type": "memory_store", "memory_store_id": "01JSTOREBBBBBBBBBBBBBBBBBB", "access": "read_only" }
]
```

规范化后写入 `SessionRecord.resources`（并在会话响应中原样返回）：

```json
[
  { "type": "memory_store", "memory_store_id": "01JSTOREAAAAAAAAAAAAAAAAAA", "access": "read_write",
    "instructions": "把用户的长期偏好写到 /preferences/ 下", "name": "项目知识",
    "mount_name": "项目知识-aaaaaa", "mount_path": "memory/项目知识-aaaaaa" },
  { "type": "memory_store", "memory_store_id": "01JSTOREBBBBBBBBBBBBBBBBBB", "access": "read_only",
    "instructions": null, "name": "Team Glossary",
    "mount_name": "team-glossary-bbbbbb", "mount_path": "memory/team-glossary-bbbbbb" }
]
```

请求项允许键：`type`（必填，必须为 `memory_store`）、`memory_store_id`（必填 string 1–64）、`access`（可选，`read_only` / `read_write`，缺省 `read_write`）、`instructions`（可选 null 或 string ≤4096）。其他键 → 400。

### 4.2 客户端数据类（`agenticx/managed/memory.py`）

```python
@dataclass(frozen=True)
class MemoryStoreStatus:
    id: str
    status: Literal["active", "archived", "missing"]
    name: str | None

@dataclass(frozen=True)
class MemoryEntry:
    memory_id: str
    path: str
    content: str
    content_sha256: str
    version: int

@dataclass(frozen=True)
class MemorySnapshot:
    store_id: str
    name: str
    status: str
    entries: tuple[MemoryEntry, ...]

@dataclass(frozen=True)
class MemoryWriteOp:
    op: Literal["create", "update", "delete"]
    path: str                         # always set (local path; used for create and for bookkeeping)
    content: str | None = None        # create / update
    memory_id: str | None = None      # update / delete
    expected_version: int | None = None

@dataclass(frozen=True)
class MemoryHead:
    memory_id: str
    path: str
    version: int
    content_sha256: str

@dataclass(frozen=True)
class MemoryWriteResult:
    ok: bool
    code: str | None = None           # memory_version_conflict / memory_path_conflict / memory_not_found / memory_store_limit / invalid_request
    message: str = ""
    head: MemoryHead | None = None    # ok: the new head (None for delete); conflict: E07 "current"
```

---

## 5. 精确落点

所有新文件头：`#!/usr/bin/env python3` + 英文 docstring + `Author: Damon Li`；英文注释；绝对 import；import 置顶。

### 5.1 `agenticx/managed/memory.py`

```python
from __future__ import annotations

import asyncio
import hashlib
import unicodedata
from dataclasses import dataclass, field
from typing import Literal, Protocol, Sequence

import httpx

MEMORY_PATH_MAX_BYTES = 1024
MEMORY_SEGMENT_MAX_BYTES = 255
MEMORY_CONTENT_MAX_BYTES = 102400
MEMORY_STORE_MAX_ITEMS = 2000
MEMORY_WRITE_BATCH = 50
MAX_MEMORY_RESOURCES = 8


class MemoryPathError(ValueError): ...


class MemoryServiceError(Exception):
    """Control-plane call failed. ``transient`` is True for network errors and 5xx."""

    def __init__(self, message: str, *, status: int = 0, code: str | None = None, transient: bool = False) -> None: ...


def validate_memory_path(raw: str) -> str: ...
def content_sha256(content: str) -> str: ...


class MemoryStoreClient(Protocol):
    async def validate_store_ids(self, tenant_id: str, store_ids: Sequence[str]) -> list[MemoryStoreStatus]: ...
    async def snapshot(self, tenant_id: str, session_id: str, store_id: str) -> MemorySnapshot: ...
    async def write(self, tenant_id: str, session_id: str, store_id: str, ops: Sequence[MemoryWriteOp]) -> list[MemoryWriteResult]: ...
    async def aclose(self) -> None: ...


class EnterpriseMemoryStoreClient:
    def __init__(self, base_url: str, internal_token: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 timeout: float = 15.0) -> None: ...
    def __repr__(self) -> str: ...      # never print the token


class InMemoryMemoryStoreClient:
    """CAS-faithful in-process implementation for tests and local experiments."""

    def __init__(self) -> None: ...
    def add_store(self, store_id: str, name: str, *, status: str = "active") -> None: ...
    def mount(self, tenant_id: str, session_id: str, store_id: str, access: str) -> None: ...
    def put(self, store_id: str, path: str, content: str) -> MemoryHead: ...       # admin-style write (bypasses CAS)
    def get(self, store_id: str, path: str) -> MemoryEntry | None: ...
    def versions(self, store_id: str) -> list[dict]: ...    # [{memory_id, version, operation, path, source_session_id}]
```

- `validate_memory_path(raw)`：与 E07 §5.1 `normalizeMemoryPath` 逐条同义，失败抛 `MemoryPathError("path: <reason>")`，原因文本与 E07 相同；NFC 用 `unicodedata.normalize("NFC", raw)`；字节数用 `len(s.encode("utf-8"))`；控制字符判定 `any(ord(c) < 0x20 or ord(c) == 0x7f for c in p) or "\\" in p`。
- `content_sha256(content)` = `hashlib.sha256(content.encode("utf-8")).hexdigest()`。
- `EnterpriseMemoryStoreClient`：`httpx.AsyncClient(base_url=..., timeout=..., trust_env=False, transport=..., headers={"Authorization": f"Bearer {token}"})`。
  - `validate_store_ids` → `POST /api/internal/ma/memory-stores/validate` `{"tenant_id","memory_store_ids"}` → `[MemoryStoreStatus(id, status, name)]`。
  - `snapshot` → `GET /api/internal/ma/memory-stores/{store_id}/snapshot?tenant_id=&session_id=`（用 `params=`）→ `MemorySnapshot`（`entries` 的 `memory_id` 取响应 `id`）。
  - `write` → 按 `MEMORY_WRITE_BATCH` 分块 `POST /api/internal/ma/memory-stores/{store_id}/writes`，body `ops` 映射：create `{"op","path","content"}`；update `{"op","memory_id","expected_version","content"}`；delete `{"op","memory_id","expected_version"}`；结果按 `index` 还原为与输入同序的 `MemoryWriteResult`（`ok` 时 `head` 由 `memory` 构造，delete 为 None；失败时 `head` 由 `current` 构造）。
  - HTTP 4xx → `MemoryServiceError(message=f"memory service returned {status}", status=status, code=<error.code 若可解析>, transient=False)`；5xx / 网络 / 非 JSON → `transient=True`。消息里不出现 token 与响应体内容（`error.code` 可带）。
- `InMemoryMemoryStoreClient`：内部 `stores: dict[store_id, {"name","status","items": dict[path, MemoryEntry], "log": list}]`、`mounts: dict[(tenant, session), dict[store_id, access]]`、`_next_id` 计数生成 26 位假 id（`f"M{n:025d}"`）。语义与 E07 一致：`snapshot` 未挂载 → `MemoryServiceError(status=403, code="forbidden_scope")`；`write` 非 `read_write` 挂载 → 403；create 路径已存在或 `/a` 与 `/a/b` 前缀冲突 → `ok=False, code="memory_path_conflict", head=<冲突条目>`；update / delete 版本不符 → `memory_version_conflict`，`head` 为当前；memory_id 不存在 → `memory_not_found`；内容 >100 KiB 或条数 >2000 → `memory_store_limit`；成功写 `log`（含 `source_session_id`）。

### 5.2 `agenticx/managed/memory_mount.py` 骨架

```python
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import stat
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from agenticx.managed.errors import FORBIDDEN_SCOPE, INTERNAL, INVALID_REQUEST, MAError
from agenticx.managed.events import session_error_event
from agenticx.managed.extensions import TurnContribution, TurnSetupError
from agenticx.managed.memory import (
    MAX_MEMORY_RESOURCES, MEMORY_CONTENT_MAX_BYTES, MEMORY_STORE_MAX_ITEMS,
    MemoryPathError, MemoryServiceError, MemoryStoreClient, MemoryWriteOp, MemoryWriteResult,
    content_sha256, validate_memory_path,
)
from agenticx.runtime.hooks import AgentHook, HookOutcome

EXTENSION_NAME = "memory"
MEMORY_DIR_NAME = "memory"
BASELINE_DIR_NAME = "memory-baseline"
WRITE_TOOLS = frozenset({"file_write", "file_edit"})
RETRY_DELAYS_SECONDS = (0.5, 1.0, 2.0)
CONFLICT_SUFFIX_MAX = 9
RESOURCE_KEYS = frozenset({"type", "memory_store_id", "access", "instructions"})


def mount_name_for(name: str, store_id: str) -> str: ...
def make_resources_validator(client: MemoryStoreClient): ...     # returns CreateValidator


@dataclass
class MountSpec:
    store_id: str
    name: str
    access: str                 # "read_only" | "read_write"
    instructions: str | None
    mount_name: str


class MemoryMount:
    def __init__(self, *, spec: MountSpec, client: MemoryStoreClient, tenant_id: str, session_id: str,
                 workdir: Path) -> None: ...
    @property
    def root(self) -> Path: ...                       # workdir / "memory" / mount_name
    @property
    def writable(self) -> bool: ...
    async def materialize(self) -> list[dict[str, Any]]: ...
    async def flush(self) -> list[dict[str, Any]]: ...
    def detect_local_changes(self) -> bool: ...       # for read_only violation detection


class MemoryMountHook(AgentHook):
    def __init__(self, actor: Any, mounts: Sequence[MemoryMount], workdir: Path) -> None: ...
    async def before_tool_call(self, tool_name: str, arguments: dict[str, Any], session: Any) -> HookOutcome | None: ...
    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None: ...


class MemoryMountExtension:
    name = EXTENSION_NAME

    def __init__(self, actor: Any, client: MemoryStoreClient) -> None: ...
    async def before_turn(self, bundle: Any) -> TurnContribution: ...
    async def after_turn(self, bundle: Any) -> list[dict[str, Any]]: ...
    async def close(self) -> None: ...


def install_memory_mounts(state: Any, client: MemoryStoreClient) -> None: ...
```

### 5.3 建会话校验（`make_resources_validator`）

```python
def make_resources_validator(client):
    async def validate(principal, req, environment) -> list[dict]:
        items = list(req.resources)
        if environment.type == "desktop_worker":
            raise MAError(INVALID_REQUEST, "resources are not supported for desktop_worker environments")
        if len(items) > MAX_MEMORY_RESOURCES:
            raise MAError(INVALID_REQUEST, "resources must contain at most 8 items")
        parsed = []
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                raise MAError(INVALID_REQUEST, f"resources[{i}]: must be an object")
            for key in sorted(set(item) - RESOURCE_KEYS):
                raise MAError(INVALID_REQUEST, f"resources[{i}].{key}: unknown field")
            if item.get("type") != "memory_store":
                raise MAError(INVALID_REQUEST, f"resources[{i}].type: must be memory_store")
            store_id = item.get("memory_store_id")
            if not isinstance(store_id, str) or not 1 <= len(store_id) <= 64:
                raise MAError(INVALID_REQUEST, f"resources[{i}].memory_store_id: required")
            access = item.get("access", "read_write")
            if access not in ("read_only", "read_write"):
                raise MAError(INVALID_REQUEST, f"resources[{i}].access: must be read_only or read_write")
            instructions = item.get("instructions")
            if instructions is not None and (not isinstance(instructions, str) or len(instructions) > 4096):
                raise MAError(INVALID_REQUEST, f"resources[{i}].instructions: must be a string of at most 4096 characters")
            scopes = principal.scopes
            if "ma:admin" not in scopes:
                if access == "read_write" and "ma:memory:write" not in scopes:
                    raise MAError(FORBIDDEN_SCOPE, "read_write memory mounts require ma:memory:write", details={"scope": "ma:memory:write"})
                if access == "read_only" and not ({"ma:memory:read", "ma:memory:write"} & scopes):
                    raise MAError(FORBIDDEN_SCOPE, "memory mounts require ma:memory:read", details={"scope": "ma:memory:read"})
            parsed.append((store_id, access, instructions))
        ids = [p[0] for p in parsed]
        if len(set(ids)) != len(ids):
            raise MAError(INVALID_REQUEST, "resources must not mount the same memory store twice")
        try:
            statuses = {s.id: s for s in await client.validate_store_ids(principal.tenant_id, ids)}
        except MemoryServiceError:
            raise MAError(INTERNAL, "memory service unavailable")
        out, taken = [], set()
        for store_id, access, instructions in parsed:
            st = statuses.get(store_id)
            if st is None or st.status == "missing":
                raise MAError(INVALID_REQUEST, f"memory store not found: {store_id}")
            if st.status != "active":
                raise MAError(INVALID_REQUEST, f"memory store is archived: {store_id}")
            base = mount_name_for(st.name or "store", store_id)
            name, n = base, 2
            while name in taken:
                name, n = f"{base}-{n}", n + 1
            taken.add(name)
            out.append({"type": "memory_store", "memory_store_id": store_id, "access": access,
                        "instructions": instructions, "name": st.name, "mount_name": name,
                        "mount_path": f"{MEMORY_DIR_NAME}/{name}"})
        return out
    return validate
```

`mount_name_for(name, store_id)`：`s = unicodedata.normalize("NFKC", name).lower()`；`s = re.sub(r"[^\w-]+", "-", s, flags=re.UNICODE).strip("-")[:48]`；空 → `"store"`；返回 `f"{s}-{store_id[-6:].lower()}"`。结果再做一次安全检查：不含 `/`、`\`，不为 `.` / `..`（正则已保证）。

### 5.4 `MemoryMount`

基线：`self._baseline_path = workdir.parent / BASELINE_DIR_NAME / f"{mount_name}.json"`；`self._entries: dict[str, dict]`（path → `{"memory_id","version","sha256"}`）在构造时从文件加载（不存在 / 损坏 → 空，损坏记 WARNING）；`_save_baseline()` 原子写（临时文件 + `os.replace`，`0o600`）。`self._lock = asyncio.Lock()`；`self._reported: set[tuple[str, str]]`（去重 `memory_entry_rejected`）。

#### 5.4.1 `materialize()`（回合开始，先由扩展调用 `flush()`）

```text
async with lock:
  snap = await client.snapshot(tenant, session, store_id)      # MemoryServiceError propagates -> TurnSetupError by caller
  root.mkdir(parents=True, exist_ok=True)
  _make_tree_writable(root)                                     # chmod u+w recursively (needed after read_only chmod)
  desired = {e.path: e for e in snap.entries}
  # 1) remove local entries not in the snapshot
  for rel, kind in _walk(root):                                 # lstat walk, never follows symlinks
      if kind != "file" or rel not in desired: _remove(root, rel, kind)
  _prune_empty_dirs(root)
  # 2) write desired files
  events = []
  for path, e in sorted(desired.items()):
      target = root.joinpath(*path.lstrip("/").split("/"))
      ancestors = [p for p in target.parents if p != root and root in p.parents]   # dirs strictly between root and target
      if any(p.is_file() for p in ancestors):
          events += _reject(path, "path collides with a file")   # file/dir collision (E07 race)
          continue
      if target.is_dir():
          events += _reject(path, "path collides with a directory"); continue
      target.parent.mkdir(parents=True, exist_ok=True)
      if not target.exists() or content_sha256(target.read_text("utf-8", errors="replace")) != e.content_sha256:
          _atomic_write(target, e.content)
  self._entries = {p: {"memory_id": e.memory_id, "version": e.version, "sha256": e.content_sha256} for p, e in desired.items()}
  _save_baseline()
  if not writable: _make_tree_read_only(root)                   # files 0o444, dirs 0o555, root included; OSError -> log debug
  return events
```

`_walk(root)` 返回 `(rel_path_with_leading_slash, kind)`，`kind ∈ {"file","dir","symlink","other"}`，用 `os.scandir` + `entry.is_symlink()` / `is_dir(follow_symlinks=False)` / `is_file(follow_symlinks=False)`；`rel` 用 POSIX 分隔符并做 NFC 归一化。

#### 5.4.2 `flush()`（只对可写挂载；只读挂载直接返回 `[]`）

```text
async with lock:
  events = []
  local = {}                                                    # path -> (content, sha)
  for rel, kind in _walk(root):
      if kind == "symlink": events += _reject(rel, "symbolic links are not synced"); continue
      if kind != "file": continue
      try: path = validate_memory_path(rel)
      except MemoryPathError as exc: events += _reject(rel, str(exc)); continue
      raw = (root / rel.lstrip("/")).read_bytes()
      if len(raw) > MEMORY_CONTENT_MAX_BYTES: events += _reject(path, "file exceeds 100 KiB"); continue
      try: text = raw.decode("utf-8")
      except UnicodeDecodeError: events += _reject(path, "file is not UTF-8 text"); continue
      if "\x00" in text: events += _reject(path, "file contains NUL"); continue
      if len(local) >= MEMORY_STORE_MAX_ITEMS: events += _reject(path, "memory store item limit reached"); continue
      local[path] = (text, content_sha256(text))
  ops = []
  for path, (text, sha) in sorted(local.items()):
      base = entries.get(path)
      if base is None: ops.append(MemoryWriteOp("create", path, content=text))
      elif base["sha256"] != sha: ops.append(MemoryWriteOp("update", path, content=text, memory_id=base["memory_id"], expected_version=base["version"]))
  for path, base in sorted(entries.items()):
      if path not in local: ops.append(MemoryWriteOp("delete", path, memory_id=base["memory_id"], expected_version=base["version"]))
  if not ops: return events
  results = await _write_with_retry(ops)                        # None -> transient failure exhausted
  if results is None:
      return events + [session_error_event("memory_sync_failed", f"memory store {name}: sync failed, will retry", "exhausted")]
  for op, res in zip(ops, results):
      events += await _apply_result(op, res, local)
  _save_baseline()
  return events
```

`_write_with_retry(ops)`：最多 1 + 3 次；`MemoryServiceError(transient=True)` → `await asyncio.sleep(delay)` 后重试；`transient=False`（403 等）→ 返回 None 并额外发一条 `memory_sync_failed`（消息带 `status`）；全部失败返回 None。

`_apply_result(op, res, local)`（D6 逐条实现）：

| 情况 | 动作 |
|---|---|
| `res.ok` 且 op ∈ create/update | `entries[op.path] = {memory_id: res.head.memory_id, version: res.head.version, sha256: res.head.content_sha256}` |
| `res.ok` 且 op = delete | `entries.pop(op.path, None)` |
| `code ∈ {memory_version_conflict, memory_path_conflict}` 且 `res.head` 且 op ≠ delete 且 `res.head.content_sha256 == local[op.path][1]` | 采用 head 为基线，无事件 |
| 同上冲突且 op = delete | `entries[op.path] = head`（远端保留，下回合落盘恢复）；事件 `memory_write_conflict`：`"memory {path} was changed by another writer; the deletion was not applied"` |
| 同上冲突且 op ∈ create/update | `conflict_path = await _save_conflict_copy(op.path, op.content)`；成功 → 基线 `entries[op.path] = head`（head 为 None 时 pop）、`entries[conflict_path] = 新 head`、把内容写到本地 `root/<conflict_path>`；事件 `memory_write_conflict`：`"memory {path} was changed by another writer; this session's version was saved as {conflict_path}"`；失败 → 事件 `memory_sync_failed`：`"memory {path}: conflict copy could not be saved"`，基线不动 |
| `memory_not_found` 且 op = update | 远端已删除：改为 `create` 同路径重试一次（单条 `client.write`），结果再走本表（不再二次降级） |
| `memory_not_found` 且 op = delete | `entries.pop(op.path, None)` |
| `memory_store_limit` / `invalid_request` | `_reject(op.path, res.message or res.code)`，基线不动 |

`_save_conflict_copy(path, content)`：`sid8 = session_id[-8:].lower()`；候选 `f"{path}.conflict-{sid8}"`、`f"{path}.conflict-{sid8}-2"` … `-9`；每个先 `validate_memory_path`（超长则跳过该候选）、再 `client.write([MemoryWriteOp("create", cand, content=content)])`；`ok` → 返回 `(cand, head)`；`memory_path_conflict` → 下一个；其他失败 → 返回 None。

`_reject(path, reason)`：`(path, reason)` 未报过 → 记入并返回 `[session_error_event("memory_entry_rejected", f"memory {name}{path}: {reason}"[:500], "exhausted")]`；否则 `[]`。

所有事件的 `message` 只含路径与原因，**不含文件内容**。

#### 5.4.3 `detect_local_changes()`（只读挂载）

遍历 `_walk(root)`：出现非文件条目、出现基线外路径、缺少基线路径、或任一文件 sha 与基线不同 → True。

### 5.5 `MemoryMountHook`

- `before_tool_call(tool_name, arguments, session)`：`tool_name not in WRITE_TOOLS` → None。`raw = arguments.get("path")`，非 str → None。`p = Path(raw).expanduser()`；非绝对 → `workdir / p`；`resolved = p.resolve(strict=False)`。对每个只读挂载 `m`：`root = m.root.resolve(strict=False)`；`resolved == root or root in resolved.parents` → 返回 `HookOutcome(blocked=True, reason=f"ERROR: path is read-only (memory store mounted read_only): {MEMORY_DIR_NAME}/{m.spec.mount_name}. Do not retry file_write/file_edit/bash_exec on this path.")`。否则 None。
- `after_tool_call(tool_name, result, session)`：`tool_name in WRITE_TOOLS` 且 `not result.startswith(("ERROR:", "CANCELLED:"))`：同样解析路径，找到包含它的**可写**挂载 → `events = await m.flush()`；`events` 非空 → `await actor.append(events)`。始终返回 None（不改结果）。

（钩子由 A06 的 `DynamicHook` 承载，与权限钩子同优先级；执行顺序不影响正确性：权限钩子先跑则 `agent.tool_use` 已宣告、本钩子拦截后结果文本成为 `agent.tool_result`；反之适配器在 runtime `tool_call` 时补宣告。）

### 5.6 `MemoryMountExtension`

- `__init__`：从 `actor.record.resources` 中筛 `type == "memory_store"` 的项构造 `MountSpec`（缺 `mount_name` 的旧数据：`mount_name_for(item.get("name") or "store", store_id)`）；`self._mounts: list[MemoryMount] = []`（首次 `before_turn` 时用 `bundle.workdir` 构造，之后复用）。
- `before_turn(bundle)`：
  ```text
  if not specs: return TurnContribution()
  if not mounts: mounts = [MemoryMount(spec=s, client, tenant, session, workdir=bundle.workdir) for s in specs]
  events = []
  try:
      for m in mounts:
          if m.writable: events += await m.flush()             # recover leftovers (crash / previous turn)
          events += await m.materialize()
  except MemoryServiceError as exc:
      raise TurnSetupError("memory_mount_failed", f"memory store could not be mounted ({exc.status or 'unavailable'})")
  return TurnContribution(hooks=[MemoryMountHook(actor, mounts, bundle.workdir)],
                          system_prompt_suffix=_prompt(specs), events=events)
  ```
- `_prompt(specs)`（英文，追加到系统提示）：

  ```text
  [memory]
  Memory stores are mounted as plain files under the working directory. Use file_read / list_files to read them.
  - memory/<mount_name>/ (read_write): files you create, edit or delete here are saved as new versions after each file_write/file_edit and at the end of the turn. Never store secrets or credentials in memory.
    Instructions: <instructions>
  - memory/<mount_name>/ (read_only): reference material; do not modify it.
  ```
  （无 instructions 时省略该行。）
- `after_turn(bundle)`：可写挂载 `events += await m.flush()`（`MemoryServiceError` 不抛出，转成 `memory_sync_failed` 事件）；只读挂载 `if m.detect_local_changes(): events.append(session_error_event("memory_read_only_violation", f"memory store {name} is mounted read_only; local changes were discarded and will be restored next turn", "exhausted"))`；返回 `events`。
- `close()`：无网络动作（回写已在回合末完成）；清空引用。

`install_memory_mounts(state, client)`：
- `state.service.register_create_validator("resources", make_resources_validator(client))`。
- 工厂 `async def factory(actor): return MemoryMountExtension(actor, client) if actor.environment.type == "cloud" and any(r.get("type") == "memory_store" for r in actor.record.resources) else None`；`factory._ma_extension_name = "memory"`；`state.service.register_extension_factory(factory)`。
- `state.shutdown_hooks.append(client.aclose)`。

### 5.7 agent-runtime 接线（E03 产物，以实际为准）

`config.py` `Settings` 加 `memory_enabled: bool`（`MA_RUNTIME_MEMORY_ENABLED`，默认真，仅 `"0"` 为假）。`app.py` 的 `build_app` 在 A06 的 `install_credential_broker(...)` 之后插入：

```python
if settings.memory_enabled:
    install_memory_mounts(
        app.state.ma,
        EnterpriseMemoryStoreClient(settings.admin_url, settings.internal_token, transport=admin_transport),
    )
```

关闭时 `resources` 回到 400「resources are not supported by this host yet」。

### 5.8 文档

`docs/managed-agents/threat-model.md`：
- §2 末尾追加：「MA-A07 落地：记忆只落到挂载它的会话的工作目录；其他会话（包括其他用户）的文件工具受 `foreign_session_denial` 拒绝、命令沙箱看不到其他会话目录；控制面快照接口另行校验会话确实挂载了该记忆库。」
- §5 末尾追加：「记忆库会沉淀不可信内容：被提示注入诱导写入的文本会在后续会话作为记忆读回。共享知识应以 read_only 挂载；read_only 由不回写保证，权限钩子与文件权限只用于让模型尽早得知。」

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 建会话带 `resources` | 400 not supported | 校验 scope / 数量 / 存在性，返回带 `mount_path` 的规范化列表 |
| 回合开始 | — | `memory/<mount_name>/` 下出现库内全部条目 |
| Agent `file_write memory/x/a.md` | 普通文件 | 写后立即生成新版本（来源会话 = 本会话） |
| 两个会话改同一文件 | — | 后写者得到冲突文件 `a.md.conflict-xxxxxxxx` 与 `session.error`，先写者内容保持 |
| 只读挂载 `file_edit` | — | `ERROR: path is read-only (memory store mounted read_only)` |
| 另一用户未挂载的会话 | — | 看不到任何记忆文件 |

---

## 7. FR / NFR / AC

测试约定同 A06（`asyncio_mode = "auto"`、`AGX_EFFECT_GUARD=0`、`HOME=tmp`、`HostConfig(data_dir=tmp/".agenticx")` 使 `workdir_root == sessions_root()`）；e2e 用 `create_ma_app` + `install_memory_mounts(app.state.ma, InMemoryMemoryStoreClient())`；脚本 LLM 用 `agenticx.managed.testing`。

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 路径规则与 E07 一致 | `test_memory_path.py`：与 E07 FR-2 同一张表（接受 / 拒绝 / NFC 归一化）逐项相同，错误消息相同 |
| FR-2 | 企业客户端 | `test_memory_client.py`：`httpx.MockTransport`：snapshot 映射 entries；write 分块（120 个 op → 3 次请求，结果按输入顺序还原）；403 → `MemoryServiceError(transient=False, status=403, code="forbidden_scope")`；500 → `transient=True`；`repr(client)` 不含 token；请求头 `authorization == "Bearer it"` |
| FR-3 | 内存假实现的 CAS | `test_memory_client.py::test_in_memory_cas`：create 重复 → `memory_path_conflict` 且 head 指向已存在条目；`/a` 存在时 create `/a/b` → `memory_path_conflict`；update 旧版本 → `memory_version_conflict`；未挂载 snapshot → 403；只读挂载 write → 403 |
| FR-4 | 建会话校验 | `test_memory_mount_e2e.py::test_create_session_resources_validation`：合法两项 → 201，响应 `resources[*].mount_path` 形如 `memory/<slug>-<6位>`、缺省 `access == "read_write"`；9 项 → 400；未知键 → 400 `resources[0].foo: unknown field`；同库两次 → 400；不存在 → 400 `memory store not found`；已归档 → 400；只有 `ma:sessions:write` 的 principal 挂 read_write → 403；`desktop_worker` 环境 → 400；未安装客户端的 dev host → 400 `resources are not supported by this host yet` |
| FR-5 | 挂载名 | `test_memory_mount.py::test_mount_name_for`：`("项目知识","01JSTOREAAAAAAAAAAAAAAAAAA")` → `"项目知识-aaaaaa"`；`("Team Glossary!", "...BBBBBB")` → `"team-glossary-bbbbbb"`；`("///", id)` → `"store-xxxxxx"`；同名两库 → 第二个追加 `-2` |
| FR-6 | 落盘 | `test_memory_mount.py::test_materialize_writes_and_prunes`：库含 `/a.md`、`/dir/b.md` → 文件内容一致、基线文件位于 `workdir.parent/memory-baseline/<mount>.json` 且不在 `workdir` 内；本地预置基线外的 `x.md` → 被删除；只读挂载落盘后 `os.stat(file).st_mode & 0o222 == 0`（非 root 用户；root 下 skip 该断言） |
| FR-7 | 回写 | `test_memory_mount.py::test_flush_create_update_delete`：新建 `c.md`、修改 `a.md`、删除 `dir/b.md` → 假客户端收到 3 个 op（create / update 带 `expected_version`、delete）；之后库内容与本地一致，`versions()` 中 3 条记录 `source_session_id` 为会话 id；再次 flush 无 op |
| FR-8 | 拒收条目 | `test_memory_mount.py::test_flush_rejects_symlink_and_big_files`：工作目录外文件的符号链接 → 不产生 op，事件 `memory_entry_rejected`；101 KiB 文件 → 拒收；非 UTF-8 → 拒收；同一原因第二次 flush 不重复报 |
| FR-9 | 冲突策略（D6 四种情况） | `test_memory_mount.py::test_conflicts`：① 远端改为与本地相同 → 无事件、基线版本更新；② 本地删除、远端已改 → 远端仍在、事件 `memory_write_conflict` 含 `deletion was not applied`；③ 本地修改、远端改为不同内容 → 库内出现 `/a.md.conflict-<sid8>` 且内容为本地内容，`/a.md` 仍为远端内容，事件消息含冲突路径，本地出现冲突文件；`.conflict-<sid8>` 已被占用 → 用 `-2`；④ 远端已删除、本地修改 → 以 create 重建，无冲突事件 |
| FR-10 | 瞬时失败重试 | `test_memory_mount.py::test_transient_retry`：假客户端前两次 write 抛 `MemoryServiceError(transient=True)`、第三次成功 → 成功无事件（monkeypatch `RETRY_DELAYS_SECONDS = (0,0,0)`）；四次都失败 → 事件 `memory_sync_failed`、基线不变、下次 flush 重新提交同样的 op |
| FR-11 | 只读拦截 | `test_memory_mount_e2e.py::test_read_only_mount_blocks_writes`：脚本 LLM 调 `file_write({"path":"memory/<ro>/x.md","content":"hack"})` → `agent.tool_result.is_error` 且文本以 `ERROR: path is read-only (memory store mounted read_only)` 开头；库无变化；测试直接（以 `os.chmod` 恢复写权限后）改本地只读文件 → 回合末事件 `memory_read_only_violation`，下一回合开始文件恢复为库内容 |
| FR-12 | **W4 门（记忆部分）** | `test_w4_memory_gate.py::test_w4_memory_gate`：HOME=tmp；`InMemoryMemoryStoreClient` 建库 `S`；tokens 映射 `tok-u1`（user U1，scopes 含 `ma:memory:write`）与 `tok-u2`（user U2）。① U1 会话 A 挂载 `S` read_write，脚本 LLM 调 `file_write({"path":"memory/<m>/preferences/report.md","content":"周报用中文"})` 后回复文本 → 会话 `end_turn`；`client.get(S, "/preferences/report.md").content == "周报用中文"`，`versions(S)` 最后一条 `source_session_id == A`、`operation == "created"`。② U1 新会话 B 挂载 `S` read_only，脚本 LLM 调 `file_read({"path":"memory/<m>/preferences/report.md"})` → `agent.tool_result` 文本含 `周报用中文`。③ U2 会话 C 不挂载，脚本 LLM 调 `file_read` 读 A 的绝对路径 `<HOME>/.agenticx/sessions/<A>/work/memory/<m>/preferences/report.md` → `is_error` 且文本含 `another session work directory`；调 `list_files({"path":"memory"})` → 结果不含 `report.md`；`client` 对 `(tenant, C)` 调 `snapshot(S)` → 403 |
| FR-13 | 并发会话冲突 e2e | `test_memory_mount_e2e.py::test_two_sessions_conflict`：会话 A、B 都挂载 `S` read_write 并各跑完一回合（基线 v1）；A 第二回合改 `/a.md` 为 `A2` → v2；B 第二回合（基线仍 v1）改为 `B2` → B 的事件含 `memory_write_conflict`，库中 `/a.md == "A2"`、`/a.md.conflict-<B 末 8 位>` == `"B2"`；B 第三回合开始本地 `a.md` 内容为 `A2` |
| FR-14 | 挂载失败收尾 | `test_memory_mount_e2e.py::test_mount_failure_ends_turn`：snapshot 抛 `MemoryServiceError(transient=True)` → 会话 `retries_exhausted`、事件 `session.error{type:"memory_mount_failed"}`、LLM 调用 0 次 |
| FR-15 | 崩溃恢复 | `test_memory_mount.py::test_leftover_changes_flushed_on_next_turn_start`：flush 前模拟中断（直接构造新的 `MemoryMount` 读取已保存基线）→ `before_turn` 先回写本地新增文件再落盘，库内出现该文件，本地未被删除 |
| FR-16 | agent-runtime 接线 | `enterprise/apps/agent-runtime/tests/test_memory_wiring.py`：`FakeAdminConsole` 增加 `memory-stores/validate`、`snapshot`、`writes` 三个 handler（内部记录请求）；带 `resources` 建会话 201；发消息后 FakeAdminConsole 收到一次 snapshot（`session_id` 为会话 id）；`MA_RUNTIME_MEMORY_ENABLED=0` → 400 not supported |
| NFR-1 | 托管既有测试不回归 | `pytest tests/managed -q --no-cov` 全绿；A06 的测试全绿 |
| NFR-2 | 不越界 | `git diff --name-only -- agenticx` 只出现 `agenticx/managed/memory.py`、`agenticx/managed/memory_mount.py` |
| NFR-3 | 事件不含记忆内容 | FR-9 / FR-12 中把所有 `session.error` 消息拼接后断言不含文件内容字符串（例如 `周报用中文`、`B2`） |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
export AGX_EFFECT_GUARD=0
python -m pytest -o addopts="" -o asyncio_mode=auto \
  tests/managed/test_memory_path.py tests/managed/test_memory_client.py tests/managed/test_memory_mount.py \
  tests/managed/test_memory_mount_e2e.py tests/managed/test_w4_memory_gate.py -q
python -m pytest tests/managed -q --no-cov
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
git diff --name-only -- agenticx
git status --porcelain
```

W4 门联调（E03 / E06 / E07 / A06 / A07 全部合入后）：`bash enterprise/scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream`；在「记忆库」建库；用 E03 §8 的 curl 流程建会话时加 `"resources":[{"type":"memory_store","memory_store_id":"<id>","access":"read_write"}]`，发消息「把『周报用中文』记到 memory 里的 preferences/report.md」；管理页版本历史出现「智能体 · 会话 <sid>」；再建一个只读挂载会话询问偏好可读出；换另一用户的 PAT（不挂载）建会话让其读该路径应失败。

---

## 9. 回滚

- `MA_RUNTIME_MEMORY_ENABLED=0` → 不注册校验器与扩展，`resources` 回到 400；已有会话的 `resources` 字段保留但不再挂载。
- 控制面 `MA_MEMORY_INTERNAL_ENABLED=0` → 回合以 `memory_mount_failed` 收尾。
- 代码：删除 §3.1 新建文件，`git checkout` 被修改文件。无数据迁移（基线文件在会话目录内，随会话目录清理）。

---

## 10. 不变量、风险与待确认问题

### 10.1 不变量

1. 只读挂载的内容从不写回记忆库（任何路径、任何工具）。
2. 回写从不 last-writer-wins：每个 update / delete 都带基线版本；冲突时两份内容都保留。
3. 记忆文件只出现在挂载它的会话工作目录内；基线文件不在沙箱可见范围。
4. 不带 `resources` 的会话行为与 A06 合入后完全一致；dev host（未安装客户端）行为与改前一致。
5. `session.error` 消息只含路径与原因，不含记忆内容。

### 10.2 风险

1. **bash 的只读保护是尽力而为**：同 uid 进程可 `chmod` 回来并修改本地文件；靠「不回写 + 下回合恢复 + violation 事件」兜底。
2. **大库挂载成本**：上限 2000 条 / 20 MiB，每回合整库快照；记忆库很大时首包延迟上升。后续可按 `content_sha256` 增量拉取。
3. **macOS 大小写不敏感文件系统**（本机开发）：仅大小写不同的两个路径会互相覆盖；Linux 容器无此问题。落盘时检测到同一本地文件被两个条目写入 → 第二个记 `memory_entry_rejected`。
4. **提示注入沉淀**：read_write 挂载会把不可信内容写进库，写入威胁模型 §5。

### 10.3 须先登记到 master §12 / 待确认问题

- **登记项**：① `SessionRecord.resources` 项形状（§4.1，含服务端补充的 `name` / `mount_name` / `mount_path`）；② 挂载目录名为 `<slug>-<id 尾 6 位>`（master §9 原文 `memory/<store_name>/`）；③ 挂载授权需 `ma:memory:read` / `ma:memory:write`；④ 新增 `session.error.type`：`memory_mount_failed` / `memory_sync_failed` / `memory_write_conflict` / `memory_entry_rejected` / `memory_read_only_violation`；⑤ `desktop_worker` 不支持 `resources`。
- **Q1**：冲突文件命名 `<path>.conflict-<会话 id 末 8 位>` 是否可接受（会在库里留下额外条目，需要人工合并）？备选：只发 `session.error` 不另存（会丢失本会话内容）。
- **Q2**：门户（MA-E04）服务 PAT 需要加 `ma:memory:read` / `ma:memory:write` 才能替用户挂载——是否接受？
- **Q3**：评测（MA-E12）要求记忆只读挂载，本子规划已支持；是否需要「会话级强制只读」开关（例如 `source=eval` 时把所有 read_write 降级为 read_only）？默认不做。
