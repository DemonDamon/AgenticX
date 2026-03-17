---
name: ""
overview: ""
todos: []
isProject: false
---

# LSP 代码智能增强 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 AgenticX 引入 LSP（Language Server Protocol）支持，让 Meta-Agent 和子智能体获得 IDE 级别的代码理解能力——跳转定义、查找引用、类型悬停、诊断获取——替代低效的 grep/find 式代码分析。

**Architecture:** 新增 `agenticx/tools/lsp_manager.py` 作为 LSP 客户端管理器，通过 stdio 与语言服务器进程通信。LSP 能力以 4 个 agent tool（`lsp_goto_definition`、`lsp_find_references`、`lsp_hover`、`lsp_diagnostics`）暴露到 `STUDIO_TOOLS`。LSP Manager 跟随 session 生命周期启停，根据项目语言自动选择合适的语言服务器。

**Tech Stack:** Python asyncio + `pygls`/原生 JSON-RPC over stdio, pyright (Python LSP), typescript-language-server (TS/JS LSP)

**Reference:** Claude Code v2.0.74+ 的 LSP tool 实现思路（CHANGELOG 分析详见 `research/codedeepresearch/claudecode/`）

---

## Phase 1: LSP Manager 核心（后端）

### Task 1.1: LSP Manager — 进程生命周期管理

**Files:**

- Create: `agenticx/tools/lsp_manager.py`
- Create: `tests/tools/test_lsp_manager.py`

**Step 1: 创建 LSP Manager 类骨架**

```python
# agenticx/tools/lsp_manager.py
"""LSP client manager — manages language server processes and JSON-RPC communication.

Provides IDE-grade code intelligence (go-to-definition, find-references, hover,
diagnostics) as agent tools. Inspired by Claude Code's LSP tool architecture.

Author: Damon Li
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_log = logging.getLogger(__name__)


# file extension → (server_command, server_args, language_id)
_DEFAULT_SERVER_MAP: Dict[str, Tuple[str, List[str], str]] = {
    ".py":  ("pyright-langserver", ["--stdio"], "python"),
    ".pyi": ("pyright-langserver", ["--stdio"], "python"),
    ".ts":  ("typescript-language-server", ["--stdio"], "typescript"),
    ".tsx": ("typescript-language-server", ["--stdio"], "typescriptreact"),
    ".js":  ("typescript-language-server", ["--stdio"], "javascript"),
    ".jsx": ("typescript-language-server", ["--stdio"], "javascriptreact"),
}


class LSPServer:
    """One running language server process with JSON-RPC communication."""

    def __init__(self, language_id: str, command: str, args: List[str], root_uri: str):
        self.language_id = language_id
        self.command = command
        self.args = args
        self.root_uri = root_uri
        self._process: Optional[asyncio.subprocess.Process] = None
        self._request_id = 0
        self._pending: Dict[int, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._initialized = False
        self._lock = asyncio.Lock()

    async def start(self) -> bool:
        """Spawn server process, send initialize + initialized."""
        ...

    async def shutdown(self) -> None:
        """Send shutdown + exit, then kill process."""
        ...

    async def _send_request(self, method: str, params: Any) -> Any:
        """Send JSON-RPC request and await response."""
        ...

    async def _send_notification(self, method: str, params: Any) -> None:
        """Send JSON-RPC notification (no response expected)."""
        ...

    async def _reader_loop(self) -> None:
        """Read JSON-RPC responses from stdout."""
        ...

    # --- LSP protocol methods ---

    async def goto_definition(self, file_uri: str, line: int, character: int) -> List[Dict[str, Any]]:
        """textDocument/definition"""
        ...

    async def find_references(self, file_uri: str, line: int, character: int) -> List[Dict[str, Any]]:
        """textDocument/references"""
        ...

    async def hover(self, file_uri: str, line: int, character: int) -> Optional[str]:
        """textDocument/hover"""
        ...

    async def diagnostics(self, file_uri: str) -> List[Dict[str, Any]]:
        """Return cached diagnostics for a file (pushed via textDocument/publishDiagnostics)."""
        ...

    async def did_open(self, file_uri: str, language_id: str, text: str) -> None:
        """textDocument/didOpen notification."""
        ...


class LSPManager:
    """Manages multiple LSP server instances, one per language."""

    def __init__(self, workspace_root: str, *, startup_timeout: float = 30.0):
        self.workspace_root = workspace_root
        self.startup_timeout = startup_timeout
        self._servers: Dict[str, LSPServer] = {}  # language_id → server
        self._diagnostics_cache: Dict[str, List[Dict[str, Any]]] = {}  # file_uri → diags

    async def ensure_server_for_file(self, file_path: str) -> Optional[LSPServer]:
        """Auto-detect language from extension, start server if needed."""
        ...

    async def shutdown_all(self) -> None:
        """Shutdown all running servers."""
        ...

    def _detect_language(self, file_path: str) -> Optional[Tuple[str, List[str], str]]:
        """Detect server config from file extension."""
        ...

    # --- High-level tool API (called by agent tools) ---

    async def tool_goto_definition(self, file: str, line: int, column: int) -> str:
        """Agent-facing: return JSON result for goto_definition."""
        ...

    async def tool_find_references(self, file: str, line: int, column: int) -> str:
        """Agent-facing: return JSON result for find_references."""
        ...

    async def tool_hover(self, file: str, line: int, column: int) -> str:
        """Agent-facing: return JSON result for hover info."""
        ...

    async def tool_diagnostics(self, file: Optional[str] = None) -> str:
        """Agent-facing: return JSON result for diagnostics."""
        ...
```

**Step 2: 实现 JSON-RPC over stdio 通信**

实现 `LSPServer._send_request`、`_send_notification`、`_reader_loop`：

- Content-Length 头解析
- 请求 ID 管理
- 超时处理（默认 10s per request）
- 诊断推送缓存（`textDocument/publishDiagnostics` notification → `_diagnostics_cache`）

**Step 3: 实现 initialize/shutdown 生命周期**

```python
async def start(self) -> bool:
    cmd = self.command
    if not shutil.which(cmd):
        _log.warning("LSP server binary not found: %s", cmd)
        return False
    self._process = await asyncio.create_subprocess_exec(
        cmd, *self.args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    self._reader_task = asyncio.create_task(self._reader_loop())
    # Send initialize
    result = await self._send_request("initialize", {
        "processId": os.getpid(),
        "rootUri": self.root_uri,
        "capabilities": {
            "textDocument": {
                "definition": {"dynamicRegistration": False},
                "references": {"dynamicRegistration": False},
                "hover": {"dynamicRegistration": False, "contentFormat": ["plaintext", "markdown"]},
                "publishDiagnostics": {"relatedInformation": True},
            }
        },
    })
    await self._send_notification("initialized", {})
    self._initialized = True
    return True
```

**Step 4: 实现 4 个 LSP 协议方法**

- `goto_definition`: `textDocument/definition` → 返回 `[{uri, range}]`
- `find_references`: `textDocument/references` → 返回 `[{uri, range}]`，过滤 gitignored 路径
- `hover`: `textDocument/hover` → 返回 markdown/plaintext 文档
- `diagnostics`: 从 `_diagnostics_cache` 读取（由 `_reader_loop` 中的 `textDocument/publishDiagnostics` 通知更新）

**Step 5: 实现 LSPManager 高层 API**

- `ensure_server_for_file`: 从扩展名匹配 `_DEFAULT_SERVER_MAP`，检查 binary 是否存在，启动 server
- `tool_`* 方法：先 `ensure_server_for_file`，然后 `did_open`（如果尚未打开），最后调用对应协议方法
- 结果格式化为 agent 友好的 JSON 字符串（路径转相对路径、行号 1-based、截断过长内容）

**Step 6: 单元测试**

```python
# tests/tools/test_lsp_manager.py
import pytest
from agenticx.tools.lsp_manager import LSPManager, LSPServer, _DEFAULT_SERVER_MAP

def test_detect_language_python():
    mgr = LSPManager("/tmp/test")
    result = mgr._detect_language("/tmp/test/main.py")
    assert result is not None
    cmd, args, lang_id = result
    assert lang_id == "python"

def test_detect_language_unknown():
    mgr = LSPManager("/tmp/test")
    result = mgr._detect_language("/tmp/test/data.csv")
    assert result is None

@pytest.mark.asyncio
async def test_shutdown_all_empty():
    mgr = LSPManager("/tmp/test")
    await mgr.shutdown_all()  # no-op, should not raise
```

---

## Phase 2: Agent Tool 注册与分发

### Task 2.1: 在 STUDIO_TOOLS 中注册 4 个 LSP 工具

**Files:**

- Modify: `agenticx/cli/agent_tools.py`

在 `STUDIO_TOOLS` 列表末尾添加 4 个工具定义：

```python
{
    "type": "function",
    "function": {
        "name": "lsp_goto_definition",
        "description": "Jump to the definition of a symbol at given file position. Returns definition location(s).",
        "parameters": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Absolute or workspace-relative file path."},
                "line": {"type": "integer", "description": "Line number (1-based)."},
                "column": {"type": "integer", "description": "Column number (1-based)."},
            },
            "required": ["file", "line", "column"],
            "additionalProperties": False,
        },
    },
},
{
    "type": "function",
    "function": {
        "name": "lsp_find_references",
        "description": "Find all references to a symbol at given file position. Returns list of locations.",
        "parameters": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Absolute or workspace-relative file path."},
                "line": {"type": "integer", "description": "Line number (1-based)."},
                "column": {"type": "integer", "description": "Column number (1-based)."},
            },
            "required": ["file", "line", "column"],
            "additionalProperties": False,
        },
    },
},
{
    "type": "function",
    "function": {
        "name": "lsp_hover",
        "description": "Get type info and documentation for a symbol at given file position.",
        "parameters": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Absolute or workspace-relative file path."},
                "line": {"type": "integer", "description": "Line number (1-based)."},
                "column": {"type": "integer", "description": "Column number (1-based)."},
            },
            "required": ["file", "line", "column"],
            "additionalProperties": False,
        },
    },
},
{
    "type": "function",
    "function": {
        "name": "lsp_diagnostics",
        "description": "Get lint/type errors and warnings for a file (or all open files if no file specified).",
        "parameters": {
            "type": "object",
            "properties": {
                "file": {"type": "string", "description": "Optional file path. If omitted, returns diagnostics for all tracked files."},
            },
            "additionalProperties": False,
        },
    },
},
```

### Task 2.2: 在 dispatch_tool_async 中添加 LSP 工具分发

**Files:**

- Modify: `agenticx/cli/agent_tools.py`

在 `dispatch_tool_async` 函数中（`list_files` 之后，`except` 之前）添加：

```python
if name.startswith("lsp_"):
    return await _dispatch_lsp_tool(name, arguments, session)
```

新增分发函数：

```python
async def _dispatch_lsp_tool(
    name: str,
    arguments: Dict[str, Any],
    session: StudioSession,
) -> str:
    """Dispatch LSP tool calls to the session's LSP manager."""
    from agenticx.tools.lsp_manager import LSPManager

    mgr: Optional[LSPManager] = getattr(session, "_lsp_manager", None)
    if mgr is None:
        root = str(_workspace_root())
        mgr = LSPManager(root)
        setattr(session, "_lsp_manager", mgr)

    file_path = str(arguments.get("file", "")).strip()
    line = int(arguments.get("line", 0))
    column = int(arguments.get("column", 0))

    try:
        if name == "lsp_goto_definition":
            return await mgr.tool_goto_definition(file_path, line, column)
        if name == "lsp_find_references":
            return await mgr.tool_find_references(file_path, line, column)
        if name == "lsp_hover":
            return await mgr.tool_hover(file_path, line, column)
        if name == "lsp_diagnostics":
            return await mgr.tool_diagnostics(file_path or None)
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"LSP error: {exc}"}, ensure_ascii=False)
    return json.dumps({"ok": False, "error": f"unknown LSP tool: {name}"}, ensure_ascii=False)
```

---

## Phase 3: Session 生命周期集成

### Task 3.1: Session 关闭时清理 LSP 进程

**Files:**

- Modify: `agenticx/studio/server.py`

在 session delete 和 server shutdown 逻辑中，添加 LSP manager 清理：

```python
# 在 SessionManager.delete() 或 session 清理时
lsp_mgr = getattr(managed.session, "_lsp_manager", None)
if lsp_mgr is not None:
    try:
        await lsp_mgr.shutdown_all()
    except Exception:
        pass
```

### Task 3.2: 配置支持

**Files:**

- Modify: `~/.agenticx/config.yaml` schema (docs only)

支持的配置项（可选，有合理默认值）：

```yaml
lsp:
  enabled: true                    # 全局开关
  startup_timeout: 30              # 服务器启动超时秒数
  servers:                         # 自定义语言服务器覆盖
    python:
      command: "pyright-langserver"
      args: ["--stdio"]
    typescript:
      command: "typescript-language-server"
      args: ["--stdio"]
  auto_detect: true                # 根据项目文件自动启动
```

读取方式：`ConfigManager._get_nested(merged, "lsp.enabled")` 等，遵循已有 `_resolve_max_tool_rounds` 的模式。

---

## Phase 4: Meta-Agent 提示词集成

### Task 4.1: 在 Meta-Agent 系统提示中注入 LSP 能力说明

**Files:**

- Modify: `agenticx/runtime/prompts/meta_agent.py`

在 `build_meta_agent_system_prompt` 中添加 LSP 上下文块：

```python
def _build_lsp_context() -> str:
    """Build context about available LSP code intelligence tools."""
    return (
        "## 代码智能工具（LSP）\n"
        "你可以使用以下工具获得 IDE 级别的代码理解能力：\n"
        "- `lsp_goto_definition(file, line, column)` — 跳转到符号定义位置\n"
        "- `lsp_find_references(file, line, column)` — 查找符号的所有引用\n"
        "- `lsp_hover(file, line, column)` — 获取类型签名和文档\n"
        "- `lsp_diagnostics(file?)` — 获取文件的 lint/类型错误\n\n"
        "**使用场景：**\n"
        "- 需要理解某个函数/类的定义时，用 `lsp_goto_definition` 而非 grep\n"
        "- 重构前评估影响范围时，用 `lsp_find_references`\n"
        "- 需要了解 API 签名/返回类型时，用 `lsp_hover`\n"
        "- 修改代码后检查是否引入错误时，用 `lsp_diagnostics`\n\n"
        "注意：LSP 工具需要对应语言服务器已安装（pyright/typescript-language-server）。\n"
        "首次调用会自动启动语言服务器，可能需要几秒初始化。\n\n"
    )
```

---

## Phase 5: Taskspace 联动（可选增强）

### Task 5.1: 根据活跃 Taskspace 路径自动设定 LSP workspace root

**Files:**

- Modify: `agenticx/cli/agent_tools.py` 中 `_dispatch_lsp_tool`

如果 session 有活跃 taskspace，用其路径作为 LSP root：

```python
taskspaces = getattr(session, "taskspaces", None)
if taskspaces and isinstance(taskspaces, list) and taskspaces:
    root = taskspaces[0].get("path", str(_workspace_root()))
else:
    root = str(_workspace_root())
```

---

## 依赖与前置条件


| 依赖                         | 安装方式                                                   | 是否必须        |
| -------------------------- | ------------------------------------------------------ | ----------- |
| pyright                    | `pip install pyright` 或 `npm install -g pyright`       | Python 项目必须 |
| typescript-language-server | `npm install -g typescript-language-server typescript` | TS/JS 项目必须  |
| pygls                      | 不使用，我们直接实现 JSON-RPC client                             | —           |


工具降级策略：如果语言服务器未安装，`lsp_*` 工具返回友好提示（"pyright 未安装，请运行 `pip install pyright`"），不阻断 agent 工作流。

---

## 风险与缓解


| 风险                                        | 缓解策略                                                  |
| ----------------------------------------- | ----------------------------------------------------- |
| 语言服务器进程泄漏                                 | session shutdown 强制 kill；进程引用计数                       |
| 长会话内存增长（参考 Claude Code 的 diagnostic 内存泄漏） | 定期清理 `_diagnostics_cache`，LRU 限制                      |
| 首次调用延迟（服务器启动）                             | `startup_timeout` 配置；agent 提示中说明初次较慢                  |
| gitignored 文件出现在结果中                       | `find_references` 结果过滤 `.gitignore` 匹配路径              |
| Windows 路径 URI 格式问题                       | 使用 `pathlib.PurePosixPath` / `urllib.parse.quote` 标准化 |


---

## 执行顺序

1. **Phase 1 (Task 1.1)** — LSP Manager 核心实现 + 单测 → commit
2. **Phase 2 (Task 2.1-2.2)** — Agent tool 注册 + 分发 → commit
3. **Phase 3 (Task 3.1-3.2)** — 生命周期 + 配置 → commit
4. **Phase 4 (Task 4.1)** — Meta-Agent 提示词 → commit
5. **Phase 5 (Task 5.1)** — Taskspace 联动（可选）→ commit

