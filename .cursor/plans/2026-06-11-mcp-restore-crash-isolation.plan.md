# Plan: MCP 连接崩溃隔离 — 单个 MCP 子进程异常不得拖垮 agx serve

> Plan-Id: 2026-06-11-mcp-restore-crash-isolation
> 创建时间：2026-06-11
> 执行模型：composer-2.5（本 plan 提供精确文件路径、行锚点、函数签名、代码骨架、env 开关与可运行验证命令，可直接照做，无需额外推断）
> 背景事故：用户重启 Near 后桌面端长时间卡在「正在加载会话…」。根因排查（已完成，见下）确认：`agx serve` 启动后被某个 MCP 子进程（实测为 `chrome-devtools`，Node/npx）的 `EPIPE`（`node:events ... Unhandled 'error' event`）连锁拖崩，导致后端进程退出、桌面端拿不到 `/api/session/messages`。

---

## 0. 一句话目标

让**任何单个 MCP 子进程的崩溃/坏管道/挂起都只影响该 MCP 自身**，绝不导致 `agx serve` 主进程退出或事件循环崩溃；并让反复失败的 MCP 在启动恢复时被自动跳过，避免"每次重启都崩"。

## 1. 已确认的根因（执行前必读，均已在事故现场核验）

| 事实 | 证据 / 位置 |
|------|------|
| `agx serve` 启动 lifespan 调用 `GlobalMcpManager.load_or_init()` + `schedule_restore()` | `agenticx/studio/server.py:653 _studio_lifespan`（L657-658） |
| restore 读取 `~/.agenticx/mcp_state.json` 的 `last_connected` 并逐个 `connect_one` | `agenticx/runtime/global_mcp_manager.py:158 restore_from_last_session` |
| 该路径**不受** `mcp.auto_connect` 配置控制（auto_connect 只作用于 per-session 调度） | `server.py:954 _resolve_mcp_auto_connect_setting`（仅被 per-session 用） |
| `mcp_connect_async` 的**连接握手阶段**已有 `asyncio.wait_for` 超时 + try/except | `agenticx/cli/studio_mcp.py:671`（L730/L756） |
| 崩溃发生在**连接成功之后**：Node 子进程后续写坏管道，asyncio subprocess transport 在回调/后台任务抛 `BrokenPipeError/EPIPE`，未被任何 try/except 捕获 → 事件循环 unhandled exception → 进程退出 | 现场日志：`node:events:486 throw er; Unhandled 'error' event ... Error: write EPIPE`，父 python 随后 DEAD |
| 清空 `mcp_state.json.last_connected` 并移除 `chrome-devtools` 后，后端稳定存活、`/api/session/messages` 200 秒回 | 现场用 `setsid` 脱离启动验证通过 |

> 结论：当前的临时缓解是「手工清 `mcp_state.json` + 从 `auto_connect` 删 chrome-devtools」。本 plan 做**代码层根因加固**，使框架自身具备崩溃隔离能力，无需用户手工干预。

## 2. 范围与非目标

### 范围（本 plan 实现）
- **FR-1**：在 `agx serve` 的事件循环上安装**全局 asyncio 异常处理器**，对 MCP/stdio 传输类异常（`BrokenPipeError`、`ConnectionResetError`、含 `EPIPE`/`Broken pipe` 文案的异常）只记录 WARNING 日志、**不让其崩溃事件循环/进程**；其它异常按默认处理器走（保持可观测）。
- **FR-2**：`restore_from_last_session` 增加**失败记账与自动跳过**：连续失败 ≥N 次（默认 2）的 server 写入 `~/.agenticx/mcp_state.json` 的新字段 `quarantined`，下次启动 restore **跳过**它（仍可由用户在设置里手动连接，手动连接成功后清除隔离标记）。
- **FR-3**：每个 server 的 restore 连接用 `asyncio.wait_for` 包一层**启动恢复专用超时**（默认 90s，env 可调），超时按失败计入 FR-2，不阻塞其余 server。
- **FR-4**：全部新增行为可由 `~/.agenticx/config.yaml` 的 `mcp` 节 + 环境变量门控，**默认开启崩溃隔离**（这是纯防御性、无副作用），自动隔离阈值可关。

### 非目标（明确不做）
- ❌ 不改 `mcp_connect_async` 已有的握手超时逻辑（`studio_mcp.py:708-770`），只在其外层加保护。
- ❌ 不动 `auto_connect`（per-session）语义。
- ❌ 不引入新依赖。
- ❌ 不实现 MCP 健康探活 / 自动重连（另立 plan）。
- ❌ 不改桌面端（Electron/React）任何代码——这是纯后端加固。

## 3. 关键基线（已核验的签名，照抄即可）

```python
# agenticx/runtime/global_mcp_state.py — 现有 schema
# {"last_connected": [...], "updated_at": <float>}
# 现有函数（保持不变，新增的与其并列）：
def read_last_connected() -> List[str]
def write_last_connected(names: List[str]) -> None
def add_to_last_connected(name: str) -> None
def remove_from_last_connected(name: str) -> None
def _state_path() -> Path          # ~/.agenticx/mcp_state.json
```

```python
# agenticx/runtime/global_mcp_manager.py — 现有签名（保持不变）
class GlobalMcpManager:
    @classmethod
    def load_or_init(cls) -> "GlobalMcpManager"
    @classmethod
    def singleton(cls) -> "GlobalMcpManager"
    @classmethod
    def reset_for_testing(cls) -> None
    def schedule_restore(self) -> None
    async def restore_from_last_session(self) -> None   # ← 本 plan 主要改这里
    async def connect_one(self, name: str, *, _persist: bool = True) -> tuple[bool, str]  # ← 成功时清隔离标记
_RESTORE_CONCURRENCY = 4   # 模块级常量
```

```python
# agenticx/studio/server.py — lifespan 入口（在此安装异常处理器）
async def _studio_lifespan(app: FastAPI):
    from agenticx.runtime.global_mcp_manager import GlobalMcpManager as _GmcpM
    _gmcp = _GmcpM.load_or_init()
    _gmcp.schedule_restore()
    # ↑ 在 schedule_restore() 之前插入：安装 asyncio 全局异常处理器（FR-1）
```

## 4. 详细设计

### 4.1 FR-1：全局 asyncio 异常处理器（核心防崩）

**新增文件**：`agenticx/runtime/mcp_crash_guard.py`

```python
#!/usr/bin/env python3
"""Install an asyncio exception handler that prevents a single MCP stdio child
crash (EPIPE / BrokenPipe / connection reset) from killing the agx serve loop.

Author: Damon Li
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

logger = logging.getLogger("agenticx.runtime.mcp_crash_guard")

# 文案/类型命中即视为「可吞掉的传输噪声」，仅记录不致命。
_SWALLOW_EXC_TYPES = (BrokenPipeError, ConnectionResetError)
_SWALLOW_TEXT_MARKERS = ("epipe", "broken pipe", "connection reset", "transport closed")


def _is_swallowable(exc: BaseException | None, message: str) -> bool:
    if isinstance(exc, _SWALLOW_EXC_TYPES):
        return True
    blob = f"{message} {exc!r}".lower()
    return any(marker in blob for marker in _SWALLOW_TEXT_MARKERS)


def install_mcp_crash_guard(loop: asyncio.AbstractEventLoop | None = None) -> None:
    """Install (idempotent) a loop exception handler that swallows MCP transport noise.

    Disabled only when AGX_MCP_CRASH_GUARD=0.
    """
    if os.getenv("AGX_MCP_CRASH_GUARD", "1").strip().lower() in {"0", "false", "off", "no"}:
        logger.info("mcp_crash_guard disabled via AGX_MCP_CRASH_GUARD=0")
        return
    try:
        loop = loop or asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("install_mcp_crash_guard: no running loop, skip")
        return
    if getattr(loop, "_agx_mcp_guard_installed", False):
        return

    prev_handler = loop.get_exception_handler()

    def _handler(lp: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        exc = context.get("exception")
        message = str(context.get("message", ""))
        if _is_swallowable(exc, message):
            logger.warning("mcp_crash_guard swallowed MCP transport error: %s (%r)", message, exc)
            return
        if prev_handler is not None:
            prev_handler(lp, context)
        else:
            lp.default_exception_handler(context)

    loop.set_exception_handler(_handler)
    setattr(loop, "_agx_mcp_guard_installed", True)
    logger.info("mcp_crash_guard installed on event loop")
```

**修改** `agenticx/studio/server.py` 的 `_studio_lifespan`（L653 起），在 `_gmcp = _GmcpM.load_or_init()` 之前插入：

```python
    async def _studio_lifespan(app: FastAPI):
        # FR-1: 先装崩溃隔离，确保后续任何 MCP 子进程坏管道都不致命。
        try:
            from agenticx.runtime.mcp_crash_guard import install_mcp_crash_guard
            install_mcp_crash_guard()
        except Exception as exc:
            logger.debug("install_mcp_crash_guard failed (non-fatal): %s", exc)

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager as _GmcpM
        _gmcp = _GmcpM.load_or_init()
        _gmcp.schedule_restore()
        ...  # 其余保持不变
```

> 注意：只动这几行，`_studio_lifespan` 其它内容（gateway/wechat/longrun/code_index/memory graph/supervisor）一律不改。

### 4.2 FR-2 + FR-3：restore 失败记账、自动隔离、超时

**修改** `agenticx/runtime/global_mcp_state.py`，新增（与现有函数并列，不改现有函数）：

```python
def read_quarantined() -> dict[str, int]:
    """Return {server_name: consecutive_failure_count} from mcp_state.json."""
    path = _state_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        q = raw.get("quarantined", {})
        if isinstance(q, dict):
            return {str(k): int(v) for k, v in q.items() if isinstance(k, str)}
    except Exception as exc:
        logger.warning("mcp_state.json quarantine read error (ignored): %s", exc)
    return {}


def _write_full_state(last_connected: List[str], quarantined: dict[str, int]) -> None:
    path = _state_path()
    try:
        path.write_text(
            json.dumps(
                {
                    "last_connected": sorted(set(last_connected)),
                    "quarantined": {k: int(v) for k, v in quarantined.items() if int(v) > 0},
                    "updated_at": time.time(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception as exc:
        logger.warning("mcp_state.json write error (ignored): %s", exc)


def record_restore_failure(name: str) -> int:
    """Increment consecutive failure count; return new count."""
    key = str(name or "").strip()
    if not key:
        return 0
    q = read_quarantined()
    q[key] = q.get(key, 0) + 1
    _write_full_state(read_last_connected(), q)
    return q[key]


def clear_quarantine(name: str) -> None:
    """Reset failure count for a server (call on successful manual/auto connect)."""
    key = str(name or "").strip()
    if not key:
        return
    q = read_quarantined()
    if key in q:
        del q[key]
        _write_full_state(read_last_connected(), q)
```

> 重要：现有 `write_last_connected` 会覆写整个文件，会丢掉 `quarantined` 字段。**必须修改 `write_last_connected`**，使其保留已有 `quarantined`：

```python
def write_last_connected(names: List[str]) -> None:
    """Persist connected server names, preserving the quarantine map."""
    _write_full_state(names, read_quarantined())
```

**修改** `agenticx/runtime/global_mcp_manager.py`：

1. 顶部 import 增补：
```python
from agenticx.runtime.global_mcp_state import (
    add_to_last_connected,
    read_last_connected,
    remove_from_last_connected,
    write_last_connected,
    read_quarantined,
    record_restore_failure,
    clear_quarantine,
)
```

2. 模块级新增常量（在 `_RESTORE_CONCURRENCY = 4` 附近）：
```python
# 连续失败达到该阈值的 server 在启动 restore 时被跳过（隔离）。0 表示从不隔离。
_RESTORE_QUARANTINE_THRESHOLD = int(os.getenv("AGX_MCP_QUARANTINE_THRESHOLD", "2") or "2")
# 单个 server 启动恢复连接的超时（秒）。
_RESTORE_CONNECT_TIMEOUT = float(os.getenv("AGX_MCP_RESTORE_TIMEOUT", "90") or "90")
```

3. 重写 `restore_from_last_session`（保留并发信号量结构，加入跳过隔离 + 超时 + 失败记账）：
```python
    async def restore_from_last_session(self) -> None:
        """Connect servers in mcp_state.json, skipping quarantined ones, with per-server timeout."""
        names = read_last_connected()
        if not names:
            return
        self._reload_configs_if_needed()

        quarantined = read_quarantined()
        threshold = _RESTORE_QUARANTINE_THRESHOLD
        if threshold > 0:
            skip = [n for n in names if quarantined.get(n, 0) >= threshold]
            names = [n for n in names if quarantined.get(n, 0) < threshold]
            if skip:
                logger.warning(
                    "GlobalMcpManager: skipping quarantined MCP server(s) on restore: %s "
                    "(connect manually in Settings to retry)", skip,
                )
        if not names:
            return
        logger.info("GlobalMcpManager: restoring %d MCP server(s): %s", len(names), names)

        semaphore = asyncio.Semaphore(_RESTORE_CONCURRENCY)

        async def _connect_one_safe(name: str) -> None:
            async with semaphore:
                try:
                    ok, err = await asyncio.wait_for(
                        self.connect_one(name, _persist=False),
                        timeout=_RESTORE_CONNECT_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    ok, err = False, f"restore connect timeout ({int(_RESTORE_CONNECT_TIMEOUT)}s)"
                except Exception as exc:  # noqa: BLE001 — restore must never propagate
                    ok, err = False, repr(exc)
                if ok:
                    clear_quarantine(name)
                else:
                    count = record_restore_failure(name)
                    logger.warning(
                        "GlobalMcpManager: restore failed for '%s' (fail#%d): %s", name, count, err
                    )

        await asyncio.gather(*(_connect_one_safe(n) for n in names), return_exceptions=True)
        write_last_connected(sorted(self._connected_servers))
        logger.info("GlobalMcpManager: restore done — connected: %s", sorted(self._connected_servers))
```

4. `connect_one` 成功路径清隔离标记（手动连接成功即"赦免"）：
```python
    async def connect_one(self, name: str, *, _persist: bool = True) -> tuple[bool, str]:
        self._reload_configs_if_needed()
        ok, err = await mcp_connect_async(
            self._hub, self._mcp_configs, self._connected_servers, name
        )
        if ok:
            clear_quarantine(name)        # 新增：成功即清隔离
            if _persist:
                add_to_last_connected(name)
        return ok, err
```

### 4.3 FR-4：门控与默认值

- `AGX_MCP_CRASH_GUARD`（默认 `1`，FR-1 总开关）。
- `AGX_MCP_QUARANTINE_THRESHOLD`（默认 `2`，设 `0` 关闭自动隔离）。
- `AGX_MCP_RESTORE_TIMEOUT`（默认 `90` 秒）。
- 无需新增 config.yaml 字段（env 即可）；如需面板可后续增量，不在本 plan。

## 5. 实施步骤（按顺序，每步可独立验证；遵循 TDD：先写测试骨架）

### Task 1 — global_mcp_state 隔离记账
- [ ] 新增 `read_quarantined` / `_write_full_state` / `record_restore_failure` / `clear_quarantine`
- [ ] 修改 `write_last_connected` 改为经 `_write_full_state` 保留 `quarantined`
- [ ] 测试 `tests/test_mcp_state_quarantine.py`：
  - 记一次失败 → count=1；再记 → count=2；`clear_quarantine` 后消失
  - `write_last_connected` 不会清掉已存在的 `quarantined`
  - 文件损坏/缺失时各函数返回安全默认

### Task 2 — mcp_crash_guard
- [ ] 新增 `agenticx/runtime/mcp_crash_guard.py`（4.1）
- [ ] 测试 `tests/test_mcp_crash_guard.py`：
  - 构造 loop，安装 guard，手动调用 handler 传入 `BrokenPipeError` context → 不抛、被吞、有 WARNING
  - 传入普通 `ValueError` context → 落到 default/prev handler（用 monkeypatch 验证转发）
  - `AGX_MCP_CRASH_GUARD=0` 时不安装（`_agx_mcp_guard_installed` 不置位）
  - 幂等：重复 install 只装一次

### Task 3 — restore 隔离 + 超时
- [ ] 修改 `global_mcp_manager.py`：import、两个常量、重写 `restore_from_last_session`、`connect_one` 清隔离
- [ ] 测试 `tests/test_mcp_restore_quarantine.py`（monkeypatch `mcp_connect_async`）：
  - 某 server 连接失败 → `record_restore_failure` 被调用，count 累加
  - count ≥ 阈值的 server 在下次 restore 被跳过（不调用 connect）
  - 连接超时被计为失败且不影响其它 server（一个超时、一个成功 → 成功的连上）
  - 成功连接清除该 server 隔离标记
  - `_RESTORE_QUARANTINE_THRESHOLD=0` 时从不跳过

### Task 4 — lifespan 接线
- [ ] 修改 `agenticx/studio/server.py:_studio_lifespan`，在 `load_or_init()` 前安装 guard（4.1 代码块），try/except 包裹
- [ ] 测试 `tests/test_smoke_mcp_crash_guard_lifespan.py`：导入 server 模块不报错；用轻量 stub 验证 `install_mcp_crash_guard` 在 lifespan 中被调用（可 monkeypatch 计数），不真正起 uvicorn

### Task 5 — 端到端冒烟 + 回归
- [ ] `tests/test_smoke_mcp_crash_isolation.py`：在一个真实 event loop 上安装 guard，向 loop 注入一个会抛 `BrokenPipeError` 的 `call_soon` 回调（或 future set_exception），断言 loop 仍可继续 `run_until_complete` 后续任务（进程不退出）
- [ ] 跑既有 MCP 相关测试确认不回归：`rg -l "global_mcp|mcp_state|mcp_connect" tests/`，对命中的测试全跑
- [ ] 不依赖外网/真实 MCP 子进程（全部 monkeypatch）

## 6. 验收标准（AC）

- **AC-1**：在 `agx serve` 事件循环上，任一 MCP 子进程产生的 `BrokenPipeError/EPIPE` 经 guard 仅记 WARNING，**事件循环不崩、进程不退出**（Task 5 冒烟可复现并通过）。
- **AC-2**：`mcp_state.json` 中连续失败 ≥ 阈值（默认 2）的 server，下次启动 restore **被跳过**，日志明确提示「skipping quarantined」。
- **AC-3**：单个 server restore 超时（默认 90s）被计为失败，**不阻塞**其它 server 的并发连接。
- **AC-4**：手动/自动**成功**连接某 server 后，其隔离计数被清除（下次正常参与 restore）。
- **AC-5**：`write_last_connected` 不再丢失 `quarantined` 字段。
- **AC-6**：`AGX_MCP_CRASH_GUARD=0` 可完全关闭 guard；`AGX_MCP_QUARANTINE_THRESHOLD=0` 可关闭自动隔离。
- **AC-7**：所有新增测试通过；既有 MCP 相关测试不回归。
- **AC-8**：未改动桌面端代码、未改 `auto_connect` 语义、未改 `mcp_connect_async` 握手逻辑。

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| guard 误吞了非 MCP 的真实致命错误 | 命中条件收窄为类型(`BrokenPipeError/ConnectionResetError`)或明确文案标记；其余异常一律转发给 prev/default handler，保持可观测 |
| 自动隔离把"偶发失败但本可用"的 server 误关 | 阈值默认 2（需连续失败 2 次）；手动连接成功立即赦免；可用 `AGX_MCP_QUARANTINE_THRESHOLD=0` 关闭 |
| `mcp_state.json` 并发写竞争 | 写操作短小且串行（restore 末尾一次 + 失败时各一次）；损坏时各 read 函数已 try/except 返回安全默认 |
| **回滚** | guard 由 `AGX_MCP_CRASH_GUARD=0` 关；隔离由阈值 `0` 关；删除 `mcp_crash_guard.py` 与 lifespan 三行即可完全回到现状 |

## 8. 提交规范

- 按 Task 分组或一次性提交，使用 `/commit --spec=.cursor/plans/2026-06-11-mcp-restore-crash-isolation.plan.md` 注入 trailer。
- 每个 commit 必须含 `Made-with: Damon Li`、`Plan-Id: 2026-06-11-mcp-restore-crash-isolation`、`Plan-File: .cursor/plans/2026-06-11-mcp-restore-crash-isolation.plan.md`。
- 遵守 `no-scope-creep`：只改本 plan 列出的文件路径。

## 9. 涉及文件清单（精确）

**新增**：
- `agenticx/runtime/mcp_crash_guard.py`
- `tests/test_mcp_state_quarantine.py`
- `tests/test_mcp_crash_guard.py`
- `tests/test_mcp_restore_quarantine.py`
- `tests/test_smoke_mcp_crash_guard_lifespan.py`
- `tests/test_smoke_mcp_crash_isolation.py`

**修改**：
- `agenticx/runtime/global_mcp_state.py`（新增 4 函数 + 重写 `write_last_connected`）
- `agenticx/runtime/global_mcp_manager.py`（import、2 常量、重写 `restore_from_last_session`、`connect_one` 清隔离）
- `agenticx/studio/server.py`（`_studio_lifespan` 安装 guard 三行，其余不动）

## 10. 验证命令（composer 执行后逐条跑）

```bash
# 单元 + 冒烟（全部不依赖外网/真实 MCP）
python -m pytest tests/test_mcp_state_quarantine.py \
  tests/test_mcp_crash_guard.py \
  tests/test_mcp_restore_quarantine.py \
  tests/test_smoke_mcp_crash_guard_lifespan.py \
  tests/test_smoke_mcp_crash_isolation.py -q

# 回归：既有 MCP 相关测试
python -m pytest $(rg -l "global_mcp|mcp_state|mcp_connect" tests/ | tr '\n' ' ') -q

# 导入自检
python -c "import agenticx.studio.server; import agenticx.runtime.mcp_crash_guard; print('import ok')"
```

---

*后续（不在本 plan）：MCP 健康探活与自动重连、设置面板暴露隔离名单与一键解除隔离、把崩溃事件上报到桌面端 toast。*
