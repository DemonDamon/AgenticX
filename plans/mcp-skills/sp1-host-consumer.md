# SP1: Host 消费端 — Skills 扩展客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AgenticX 作为 MCP Host，能从声明了 skills 扩展的 server 发现、校验、审批并加载 skill，与本地 skill 统一进一个注册表视图。

**Architecture:** 三层——① `agenticx/skills/manifest.py` 定义协议数据模型（Host/Server 共享基座）；② `MCPClientV2` 增加扩展能力探测与三个方法的低层封装（协议层，不含业务）；③ `RemoteSkillProvider` + `UnifiedSkillIndex` 做拉取、校验、审批、聚合（产品层）。skill 主键 = `server_id + uri`。

**Tech Stack:** 官方 MCP SDK（`mcp>=1.0.0,<2`）`ClientSession.send_request`；Pydantic v2；pytest。

---

### Task 1: SkillManifest 协议数据模型

**Files:**
- Create: `agenticx/skills/manifest.py`
- Test: `tests/test_skill_manifest.py`

**内容:**
- [ ] `SkillFileEntry(uri: str, digest: str, size: int)`——digest 形如 `sha256:<hex>`
- [ ] `SkillManifest(uri: str, frontmatter: dict, files: list[SkillFileEntry] | Literal["dynamic"])`，附 `from_skill_entry()`（解析 server 返回的 JSON）/ `compute_digest(content: bytes) -> str` 工具函数
- [ ] `verify_file(entry: SkillFileEntry, content: bytes) -> SkillIntegrityError | None`：校验 SHA-256 + 字节大小
- [ ] `verify_frontmatter(manifest: SkillManifest, raw_frontmatter: dict)`：逐字段比对
- [ ] 边界常量：`MAX_SKILL_FILES = 512`、`MAX_SKILL_BYTES = 16 * 1024 * 1024`，超限告警不阻断（规范为 SHOULD）
- [ ] 单测：合法/篡改/超限/dynamic 四类用例

### Task 2: MCPClientV2 扩展探测与方法封装

**Files:**
- Modify: `agenticx/tools/remote_v2.py`（`MCPClientV2`）
- Test: `tests/test_mcp_skills_host.py`

**内容:**
- [ ] 连接后从 discover/initialize 结果读取 `capabilities.extensions`，暴露 `supports_skills() -> bool` 与 `supports_directory_read() -> bool`（`directoryRead` 默认 false）
- [ ] `list_skills(cursor)`：封装 `skills/list`，处理分页 `nextCursor` 与 `resultType/ttlMs/cacheScope` 字段，返回 `list[SkillManifest]`
- [ ] `get_skill(uri)`：封装 `skills/get`；未知名录 URI 服务器返回 `-32602` 时透传为 `SkillNotFoundError`
- [ ] `read_resource(uri)`：确认既有 resources 通道可读 `skill://` URI（SDK 应原生支持；不通则补封装）
- [ ] `read_directory(uri)`：仅 `supports_directory_read()` 为真时可调，返回直接子节点列表（目录以 `inode/directory` 标识）
- [ ] 方法未声明扩展时调用 → 本地直接抛 `SkillExtensionNotDeclaredError`，不发请求
- [ ] SDK 无原生方法封装时统一走 `ClientSession.send_request`；先查 SDK 源码确认（避免重复造轮子）
- [ ] 单测用 fake session 断言 JSON-RPC method/params 结构

### Task 3: RemoteSkillProvider — 拉取与读取点校验

**Files:**
- Create: `agenticx/skills/remote_provider.py`
- Test: `tests/test_skill_remote_provider.py`

**内容:**
- [ ] `RemoteSkillProvider(client, server_id)`：`list_skills()` 委托 client；`load_skill(uri)` 持有（retain）manifest 直至调用方释放——对齐规范"acting on a skill 期间保留条目"
- [ ] `read_file(file_uri)`：只允许读 retain 的 manifest 内 URI（越界读抛错）；每次读取做 digest + size 校验，失败 → 拒绝内容并自动 `get_skill(uri)` 刷新条目、要求重新审批
- [ ] `refresh(uri)`：重新拉取 manifest，diff 新旧 digest 集合，产出 `ApprovalRevocation`（见 Task 4）
- [ ] 缓存：按需落盘 `~/.agenticx/skills/cache/<server_id>/<skill_name>/`，缓存文件不可变（写后 chmod 只读）或每次访问复验
- [ ] 单测：digest 不匹配、文件清单外读取、dynamic skill（frontmatter 仍校验）三类拒绝路径

### Task 4: 审批绑定摘要集合

**Files:**
- Create: `agenticx/skills/approval.py`
- Modify: `agenticx/skills/guard.py`（复用 scan 通道）
- Test: `tests/test_skill_approval.py`

**内容:**
- [ ] `SkillApproval(server_id, skill_uri, file_digests: dict[uri, digest], granted_at, origin="mcp")`
- [ ] `is_valid(approval, manifest)`：URI 集合与每个 digest 完全一致才有效；任何增删改文件 → 失效
- [ ] 激活前检查：`scan_skill_deep` 过内容安全门（沿用信任分级与 `should_allow`）；`agent_writes_require_approval=True` 时要求存在有效审批记录，否则拒载
- [ ] 嵌套 skill：SKILL.md 内引用另一 skill 的 URI 不算激活，读取其内容需 fresh consent——在激活入口做一次显式判断
- [ ] 单测：审批后改一个文件 → 作废；同 URI 同 digest → 仍有效

### Task 5: 统一注册表视图与来源标签

**Files:**
- Create: `agenticx/skills/unified_index.py`
- Modify: `agenticx/tools/skill_bundle.py`（加载路径入口）
- Test: `tests/test_skill_unified_index.py`

**内容:**
- [ ] `UnifiedSkillIndex`：聚合本地 `RegistryStorage` 与多个 `RemoteSkillProvider`；查询返回 `SkillView(origin, server_id, uri, name, description, manifest)`，`origin ∈ {local, mcp}`
- [ ] 主键 `skill_id = f"{server_id}::{uri}"`；同 name 不同源并列共存，展示层带来源标签，绝不替换
- [ ] filesystem discovery 排除 `~/.agenticx/skills/cache/`（修改 `skill_bundle.py` 扫描逻辑的忽略清单）
- [ ] `skill_bundle.py` 的 skill→BaseTool 封装支持从 `UnifiedSkillIndex` 取远端 skill（读 SKILL.md 走 RemoteSkillProvider，激活前提：Task 4 审批通过）
- [ ] 单测：本地+远端同名并列；缓存目录不被扫入

### Task 6: CLI 与集成收口

**Files:**
- Modify: `agenticx/cli/agent_tools.py`（或 skills 子命令所在模块）
- Test: `tests/test_mcp_skills_host.py`（集成用例）

**内容:**
- [ ] `agx skills list --remote`：列出远端 skill 及来源/版本/文件数
- [ ] `agx skills show <uri>`：展示 manifest（文件清单 + digest 摘要）
- [ ] `agx skills approve <uri>` / `revoke <uri>`：写审批记录（绑定 digest 集合）
- [ ] 集成测试：fake MCP server（见 SP2 前可用内联 fixture server）走 list→get→read→校验→审批→注入全链路

**完成标志:** 本地无任何 skills-capable server 时行为与现状完全一致（零回归）；有则新增消费能力全部可用。
