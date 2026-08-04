# Plan A：会话/状态存储抽象层（HA 地基）

Planned-with: kimi-k3
Suggested-Impl-Model: kimi-k3-max（会话核心热路径，回归风险高，需强推理收口）
Status: pending-review
Parent-Plan: `.cursor/plans/pending/2026-08-04-agenticx-ha-roadmap.plan.md`
Covers-Gap: G-001（+ G-005 的 mcp_state 外置部分），证据见 `research/codedeepresearch/agentscope/agentscope_ha_gap_analysis.md`

## 根因与证据链

AgenticX 会话真相源 = 进程内存 `SessionManager._sessions`（`agenticx/studio/session_manager.py:509`）+ 本机文件 `~/.agenticx/sessions/<id>/`（`_messages_path`，`session_manager.py:2112`）+ SQLite（`agenticx/memory/session_store.py`）。无任何存储后端抽象，多副本无法共享会话。对标机制：AgentScope `StorageBase`（`upstream/src/agentscope/app/storage/_base.py:364-441`）+ Redis/SQL 双实现。

本 plan 是所有其它 HA 子规划的地基，**必须第一个实施**。

## In scope

新增：
- `agenticx/studio/storage/__init__.py`
- `agenticx/studio/storage/backend.py`
- `agenticx/studio/storage/local_file.py`
- `agenticx/studio/storage/redis_backend.py`
- `agenticx/studio/storage/factory.py`
- `tests/test_ha_storage_backend.py`

修改（只允许这些文件）：
- `agenticx/studio/session_manager.py`
- `agenticx/runtime/_automation_tasks_io.py`
- `agenticx/runtime/global_mcp_state.py`
- `agenticx/runtime/subagent_runs/store.py`
- `agenticx/cli/config_manager.py`（仅新增配置键读取，不改既有键语义）

## Out of scope（no-scope-creep 边界）

- 不改 `agenticx/memory/session_store.py`（SQLite 摘要/FTS 索引维持本机，HA 下每副本各自建索引是可接受语义，列入「发现的非目标问题」）。
- 不改 KB/Chroma、avatars、groups、feishu_binding 的存储（后续单独立项）。
- 不实现 PG 后端（Protocol 预留，触发条件见主规划 §7）。
- 不改任何 API 路由与请求/响应契约。
- 不动 `agenticx/server/redis_backend.py` 既有代码（只 import 复用）。

## FR 与 AC

### FR-1：`SessionStorageBackend` Protocol

落点：新建 `agenticx/studio/storage/backend.py`。

定义（写全，实施者不得自行增删方法签名）：

```python
class SessionStorageBackend(Protocol):
    async def load_messages(self, session_id: str) -> list[dict]: ...
    async def save_messages(self, session_id: str, messages: list[dict]) -> None: ...
    async def load_agent_messages(self, session_id: str) -> list[dict]: ...
    async def save_agent_messages(self, session_id: str, messages: list[dict]) -> None: ...
    async def load_messages_tail(self, session_id: str) -> dict | None: ...
    async def save_messages_tail(self, session_id: str, tail: dict) -> None: ...
    async def load_agent_state(self, session_id: str) -> dict | None: ...
    async def save_agent_state(self, session_id: str, state: dict) -> None: ...
    async def delete_session(self, session_id: str) -> None: ...
    async def load_automation_tasks(self) -> list[dict]: ...
    async def save_automation_tasks(self, tasks: list[dict]) -> None: ...
    async def load_mcp_state(self) -> dict: ...
    async def save_mcp_state(self, state: dict) -> None: ...
    async def ping(self) -> bool: ...
```

设计意图：`load_*` 返回「不存在」一律用 `None`/空列表/空 dict，不抛异常（对齐现状文件不存在时的容忍语义，见 `_load_messages_snapshot` `session_manager.py:2189` 与 `_automation_tasks_io.py:35-44`）。写操作必须原子（local 用 tmp+`os.replace`，对齐 `_automation_tasks_io.py:47-54` 现有写法；redis 用单命令 SET）。

**AC-1**：`tests/test_ha_storage_backend.py::test_backend_contract` 对两个 backend 跑同一参数化用例集：写入→读取一致、不存在 key 返回空值、覆盖写一致、delete 后读取为空。local 用 `tmp_path`；redis 用 `fakeredis.aioredis.FakeRedis`（`fakeredis` 加到 `pyproject.toml` `[dependency-groups] dev` 节，主依赖不变）。

### FR-2：`LocalFileBackend`（默认，现状行为搬运）

落点：新建 `agenticx/studio/storage/local_file.py`。

意图：把现状文件读写逻辑**原样收敛**进 backend，行为逐字节等价。before/after：

```python
# before（session_manager.py:2112 现状）
def _messages_path(self, session_id: str) -> str:
    return os.path.join(self._sessions_root, session_id, "messages.json")

# after（session_manager 内）
# _messages_path 保留为薄代理，内部委托：
#   return self._storage.paths.messages_path(session_id)  # 仅 local backend 有 paths 属性
# 读写改走 await self._storage.load_messages(session_id)
```

- 根路径来自 `~/.agenticx/sessions`（现状 `session_manager.py:513`），构造 backend 时注入，不在 backend 内重复硬编码 `Path.home()`。
- `messages.json` / `agent_messages.json` / `messages_tail.json` 三个文件语义不变；`agent_state` 在 local 实现中落 `~/.agenticx/sessions/<id>/agent_state.json`（新文件，Plan B 使用；本 plan 只建通路）。
- `automation_tasks` 对应 `~/.agenticx/automation_tasks.json`（现状 `_automation_tasks_io.py:25`）；`mcp_state` 对应 `~/.agenticx/mcp_state.json`（现状 `global_mcp_state.py:26`）。

**AC-2**：仓库现有测试中凡触及 session 持久化/自动化任务/mcp_state 的全部全绿（至少：`pytest tests/ -k "session or automation or mcp_state"`）；手工 smoke：`agx serve` 起服务后发一条多轮消息，`~/.agenticx/sessions/<id>/messages.json` 内容与 main 分支同操作产物 diff 为空。

### FR-3：`RedisBackend`

落点：新建 `agenticx/studio/storage/redis_backend.py`。

- 连接：**必须复用** `agenticx/server/redis_backend.py` 的 `RedisBackend`（已提供连接池、`AGENTICX_REDIS_URL`/`REDIS_URL` env、优雅降级），本类只做 key 编排与 JSON 编解码，禁止新建连接体系。
- key 布局（prefix `agenticx:` 由 RedisBackend 自带，以下为其后部分）：
  - `sess:{sid}:messages` / `sess:{sid}:agent_messages` / `sess:{sid}:tail` / `sess:{sid}:agent_state` → `SET` JSON 字符串
  - `automation:tasks` → `SET` JSON
  - `mcp:state` → `SET` JSON
- 大消息体防护：单 key 写入前 `len(payload) > 8MB` 时 `logger.warning`（不截断、不报错，仅观测）。
- `ping()` 委托 `RedisBackend` 连通性。

**AC-3**：`test_backend_contract` 的 redis 参数化分支通过（fakeredis）；另 `test_redis_backend_key_layout` 断言写入后 fakeredis 内 key 名与上表一致。

### FR-4：工厂与配置

落点：新建 `agenticx/studio/storage/factory.py`；改 `agenticx/cli/config_manager.py`。

- 解析顺序：env `AGX_STORAGE_BACKEND` > `config.yaml` 的 `runtime.storage_backend` > 默认 `local`。
- redis 模式连接串：env `AGX_REDIS_URL` > `runtime.redis_url` > `AGENTICX_REDIS_URL`（复用既有 env 语义）。
- 工厂为进程级懒加载单例 `get_storage_backend()` + `reset_storage_backend_for_testing()`。
- config_manager 仅新增 `runtime.storage_backend` / `runtime.redis_url` 两个键的读取通路，不改既有键。

**AC-4**：`test_factory_resolution`：monkeypatch env 三种取值分别解析到 local/redis/默认；`reset_storage_backend_for_testing` 后可重新解析。

### FR-5：四处改造点接线

1. `agenticx/studio/session_manager.py`：
   - `__init__`（504-515）：新增 `self._storage = get_storage_backend()`；`_sessions_root` 保留但仅作为 local backend 构造参数来源。
   - `_persist_core_snapshots`（1964）与 `_persist_session_state`（1998）：文件直写改为 `await self._storage.save_*`（这两个方法当前为同步——允许在实现中保留同步薄壳：local 模式直接调同步文件 IO；redis 模式用 `asyncio.get_running_loop().create_task` 投递 + flush 路径 `await`。**实施者必须画出调用链确认哪些调用点在 async 上下文**，若某调用点无法拿到 running loop，则该路径仅 local 模式可用并在 redis 模式 log warning——此限制写进代码 docstring）。
   - `_load_messages_snapshot`（2189）/ `_load_messages_tail_snapshot`（2155）：改走 backend。
2. `agenticx/runtime/_automation_tasks_io.py:35-54`：`load_automation_tasks`/`save_automation_tasks` 改走 backend（保留原函数签名，内部委托）。
3. `agenticx/runtime/global_mcp_state.py`（读写函数见 26-83 行区域）：改走 backend（保留原函数签名）。
4. `agenticx/runtime/subagent_runs/store.py:27-46`：`SubAgentRunStore._root` 解析处——redis 模式下 run 记录经 backend 的 `agent_state` 命名空间扩展 key（`sess:{sid}:subagent_runs:{run_id}`）；local 模式保持文件。**若工作量膨胀，允许仅做 local 保持 + redis 模式 TODO 标注并在 plan 回执中说明**。

**AC-5**：`pytest tests/ -k "session_manager or subagent or automation or mcp"` 全绿；redis 模式下 `agx serve` smoke：发消息→`redis-cli GET agenticx:sess:{sid}:messages` 可见 JSON。

### FR-6：PG 预留

Protocol 的 `load_agent_state/save_agent_state` 即未来 `AsyncSQLBackend` 的挂点；在 `backend.py` docstring 注明「SQL 实现触发条件见主规划 §7」，本 plan 不实现。

**AC-6**：n/a（设计约束，评审目测）。

## 发现的非目标问题（记录，不修）

- `session_store.py` 的 FTS 索引每副本各自重建会造成重复 backfill IO（已知，HA 模式可接受，后续可加 `AGX_SESSION_FTS=0` 指引）。
- `_persist_session_state` 同步签名与 async backend 的阻抗不匹配是既有结构问题，FR-5 的薄壳方案是止血，彻底 async 化留待后续重构。

## 验证

```bash
pytest tests/test_ha_storage_backend.py -v
pytest tests/ -k "session_manager or subagent or automation or mcp" -q
agx serve --host 127.0.0.1 --port 17399 &  # smoke：/api/session、/api/sessions 200，发一条消息落盘正确
AGX_STORAGE_BACKEND=redis AGX_REDIS_URL=redis://127.0.0.1:6379/15 agx serve --host 127.0.0.1 --port 17400 &  # redis 模式 smoke
```
