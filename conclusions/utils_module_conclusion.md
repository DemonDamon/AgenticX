# Utils 模块结论

## Responsibility
- 提供跨子系统复用的**低层 I/O 与安全工具**：原子文件写入、受限 pickle 反序列化（及可选 HMAC 签名封装）。
- Explicit non-responsibilities: 不包含业务领域逻辑、配置解析、日志/观测或 HTTP 客户端；`__init__.py` 不 re-export 子模块符号。

## Entry points and public interfaces
- `agenticx.utils.atomic_writer.atomic_write_text` / `atomic_write_json`：文本与 JSON 的原子落盘（临时文件 + `os.replace`）。
- `agenticx.utils.safe_pickle`：`RestrictedUnpickler`、`safe_pickle_load` / `safe_pickle_loads`；`signed_pickle_dump(s)` / `signed_pickle_load(s)` / `signed_pickle_load_path`（HMAC 校验后再走受限 unpickle）。

## Core execution path
- **原子写**：`atomic_write_*` → `tempfile.mkstemp` 写入 `.agx.tmp` → 成功则 `os.replace` 覆盖目标；失败清理临时文件并 re-raise。
- **安全反序列化**：`safe_pickle_load*` → `RestrictedUnpickler.find_class` 校验 `(module, name)` 是否在 allowlist → 不在则 `pickle.UnpicklingError`。
- **签名 pickle**：`signed_pickle_load*` → 解析长度前缀 + HMAC → `hmac.compare_digest` → `safe_pickle_loads`。

## Important classes and functions
- `RestrictedUnpickler`：覆盖 `find_class`，默认 allowlist 含 builtins/collections 常见类型、`numpy` 若干类型，以及 `agenticx.storage.vectordb_storages.base.VectorRecord`。
- `atomic_write_text` / `atomic_write_json`：Studio 会话持久化、memory 时间戳修复等场景的 JSON/文本安全写入。
- `signed_pickle_*`：完整性校验 + 受限 load 组合（测试覆盖 round-trip 与篡改检测）。

## Data and configuration
- 无独立配置文件；`allowed_classes` 由调用方可选传入覆盖默认 frozenset。
- 签名 pickle 依赖调用方提供的 `key: bytes` 与可选 `digestmod`（默认 SHA-256）。

## Dependencies
- Upstream: 标准库 `pickle`、`hmac`、`hashlib`、`json`、`tempfile`、`pathlib`；可选 `numpy` 类型仅在反序列化 allowlist 中引用。
- Downstream: `agenticx/studio/storage/local_file.py`、`agenticx/studio/session_manager.py`（atomic_writer）；`agenticx/storage/vectordb_storages/faiss.py`、`agenticx/integrations/mem0/vector_stores/faiss.py`、`agenticx/observability/utils.py`（safe_pickle）；`agenticx/memory/timestamp_pollution_repair.py`、`agenticx/memory/message_timestamp_backfill.py`（atomic_writer）。

## Tests and operations
- `tests/test_smoke_security_hardening.py`：`TestSafePickle` 覆盖 allowlist 通过/拒绝、签名篡改、错误 key。
- `tests/test_smoke_nexu_atomic_writer.py`：`atomic_write_json` 行为及 `os.replace` 失败回滚。
- 运维：FAISS 索引等 pickle 资产应仅通过 `safe_pickle_load` 读取；新增持久化类型需扩展 allowlist 并补测试。
