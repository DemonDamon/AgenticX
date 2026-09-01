# Utils 模块结论

> 结论更新时间：2026-09-01（覆盖基线 `f3ba65001c29` 之后的变更：新增 `agx_home.py`、`async_bridge.py`、`workspace_dir.py`）

## Responsibility
- 提供跨子系统复用的**低层 I/O 与安全工具**：原子文件写入、受限 pickle 反序列化（及可选 HMAC 签名封装）。
- 提供**路径与事件循环的基础设施入口**：`~/.agenticx` 路径的惰性解析（`agx_home`）、同步代码调用协程的统一桥（`async_bridge`）、工作区根目录解析（`workspace_dir`）。
- Explicit non-responsibilities: 不包含业务领域逻辑、配置解析、日志/观测或 HTTP 客户端；`__init__.py` 不 re-export 子模块符号。

## Entry points and public interfaces
- `agenticx.utils.atomic_writer.atomic_write_text` / `atomic_write_json`：文本与 JSON 的原子落盘（临时文件 + `os.replace`）。
- `agenticx.utils.safe_pickle`：`RestrictedUnpickler`、`safe_pickle_load` / `safe_pickle_loads`；`signed_pickle_dump(s)` / `signed_pickle_load(s)` / `signed_pickle_load_path`（HMAC 校验后再走受限 unpickle）。
- `agenticx.utils.agx_home.agx_home()` / `lazy_home_path(module_name, attr, *parts)`：`~/.agenticx` 及子路径的**调用时**解析，替代模块级 `Path.home()` 常量。
- `agenticx.utils.async_bridge.run_sync(coro)`：同步上下文跑完协程并返回结果（`__all__ = ["run_sync"]`）。
- `agenticx.utils.workspace_dir.resolve_workspace_dir(explicit=None)` 与常量 `WORKSPACE_DIR_ENV = "AGENTICX_WORKSPACE_DIR"`：工作区根解析，优先级 explicit > 环境变量 > `Path.cwd()`。

## Core execution path
- **原子写**：`atomic_write_*` → `tempfile.mkstemp` 写入 `.agx.tmp` → 成功则 `os.replace` 覆盖目标；失败清理临时文件并 re-raise。
- **安全反序列化**：`safe_pickle_load*` → `RestrictedUnpickler.find_class` 校验 `(module, name)` 是否在 allowlist → 不在则 `pickle.UnpicklingError`。
- **签名 pickle**：`signed_pickle_load*` → 解析长度前缀 + HMAC → `hmac.compare_digest` → `safe_pickle_loads`。
- **惰性 home 路径**：`lazy_home_path` → 先查 `sys.modules[module_name].__dict__[attr]`（给既有测试的 `monkeypatch.setattr` 覆盖留口）→ 未覆盖则 `agx_home().joinpath(*parts)`，按调用时的 `$HOME` 求值。
- **同步桥**：`run_sync` → `asyncio.get_running_loop()` 探测；无运行中循环走 `asyncio.run`；已在循环里则提交到 `ThreadPoolExecutor(max_workers=1, thread_name_prefix="agx-run-sync")` 用新循环跑完取结果。
- **工作区解析**：`resolve_workspace_dir` → 显式参数非空则 `expanduser().resolve(strict=False)`；否则读 `$AGENTICX_WORKSPACE_DIR`（strip 后非空才生效）；兜底 `Path.cwd()`。

## Important classes and functions
- `RestrictedUnpickler`：覆盖 `find_class`，默认 allowlist 含 builtins/collections 常见类型、`numpy` 若干类型，以及 `agenticx.storage.vectordb_storages.base.VectorRecord`。
- `atomic_write_text` / `atomic_write_json`：Studio 会话持久化、memory 时间戳修复等场景的 JSON/文本安全写入。
- `signed_pickle_*`：完整性校验 + 受限 load 组合（测试覆盖 round-trip 与篡改检测）。
- `agx_home` / `lazy_home_path`：修复「模块级 `Path.home()` 常量在 import 时定死、测试 `$HOME` 重定向拦不住」的问题——实测一轮全量测试曾向真实 `~/.agenticx` 写入 171 个条目。调用方模块内部须改调私有函数（如 `_avatars_root()`），PEP 562 `__getattr__` 只拦外部属性访问、拦不住模块自身的全局名查找。
- `run_sync`：修掉 `asyncio.get_event_loop().run_until_complete(...)` 在 `asyncio.run()` 之后永久抛 `RuntimeError` 的坏法（Python 3.12 起无运行循环时 `get_event_loop()` 本身即抛），同时覆盖「当前线程已有循环在跑」的场景。
- `resolve_workspace_dir`：不改默认语义（仍为 cwd），只是把 `Path.cwd()` 收成可覆盖入口，测试/容器可用 `AGENTICX_WORKSPACE_DIR` 指向别处而不必 chdir。注意与 `agenticx/workspace/loader.py` 中同名的 `resolve_workspace_dir`（读 `config.yaml` 的 `workspace_dir`）是两套语义，多数 Studio/runtime 调用方走的是后者。

## Data and configuration
- 无独立配置文件；`allowed_classes` 由调用方可选传入覆盖默认 frozenset。
- 签名 pickle 依赖调用方提供的 `key: bytes` 与可选 `digestmod`（默认 SHA-256）。
- `workspace_dir` 读取环境变量 `AGENTICX_WORKSPACE_DIR`；`agx_home` 无配置，按调用时 `$HOME` 解析。

## Dependencies
- Upstream: 标准库 `pickle`、`hmac`、`hashlib`、`json`、`tempfile`、`pathlib`、`asyncio`、`concurrent.futures`、`sys`、`os`；可选 `numpy` 类型仅在反序列化 allowlist 中引用。
- Downstream: `agenticx/studio/storage/local_file.py`、`agenticx/studio/session_manager.py`（atomic_writer）；`agenticx/storage/vectordb_storages/faiss.py`、`agenticx/integrations/mem0/vector_stores/faiss.py`、`agenticx/observability/utils.py`（safe_pickle）；`agenticx/memory/timestamp_pollution_repair.py`、`agenticx/memory/message_timestamp_backfill.py`（atomic_writer）。
- Downstream（agx_home）: `agenticx/avatar/registry.py`、`agenticx/avatar/group_chat.py`、`agenticx/brain/registry.py`、`agenticx/cli/agent_tools.py`、`agenticx/delivery/config.py`、`agenticx/delivery/store.py`、`agenticx/memory/workspace_memory.py`、`agenticx/studio/chat_attachments.py`、`agenticx/workspace/loader.py`。
- Downstream（async_bridge）: `agenticx/core/agent_executor.py`、`agenticx/evaluation/llm_judge.py`、`agenticx/flow/base.py`、`agenticx/integrations/agentkit/knowledge_bridge.py`、`agenticx/sandbox/base.py`、`agenticx/tools/sandbox_tools.py`。
- Downstream（workspace_dir）: `agenticx/core/agent_executor.py`、`agenticx/hooks/bundled/session_memory/handler.py`。

## Tests and operations
- `tests/test_smoke_security_hardening.py`：`TestSafePickle` 覆盖 allowlist 通过/拒绝、签名篡改、错误 key。
- `tests/test_smoke_nexu_atomic_writer.py`：`atomic_write_json` 行为及 `os.replace` 失败回滚。
- `tests/test_async_bridge.py`：`run_sync` 回归——钉住 `asyncio.run` 后 `get_event_loop()` 抛错的失败前提，覆盖主线程/全新线程/已有循环三种场景。
- `tests/conftest.py`：session 级 fixture 重定向 `$HOME`/`USERPROFILE` 与 `AGENTICX_WORKSPACE_DIR` 到 tmp 沙箱，并对真实 `~/.agenticx` 做递归条目数指纹比对（session 开始/结束各一次）；发现增长即 fail 并提示改用 `agenticx/utils/agx_home.py` 的调用时解析。
- 运维：FAISS 索引等 pickle 资产应仅通过 `safe_pickle_load` 读取；新增持久化类型需扩展 allowlist 并补测试。新增 `~/.agenticx` 子路径时禁止再写模块级 `Path.home()` 常量，一律走 `agx_home` / `lazy_home_path`。
