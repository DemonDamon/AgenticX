# SP2: Server 暴露端 — 注册表变 skills 端点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 AgenticX 本地 skill 注册表（含自进化蒸馏产物）暴露为符合 `io.modelcontextprotocol/skills` 扩展的 MCP server，任何支持该扩展的宿主（Claude Code、其他 AgenticX 实例等）可发现并按需读取。

**Architecture:** `agenticx/skills/mcp_server.py` 基于官方 MCP SDK 的 Server/FastMCP 实现。注册表条目 → `skill://` URI 映射与 manifest 从存储字节现算（不信缓存，杜绝清单与内容不一致）；文件内容经 `resources/read` 服务；目录浏览走可选的 `resources/directory/read`。

**Tech Stack:** 官方 MCP SDK（`mcp>=1.0.0,<2`）Server 侧 API；Pydantic v2；pytest。

**前置:** SP1-T1（`agenticx/skills/manifest.py` 已存在）。

---

### Task 1: 注册表 → skill:// URI 映射

**Files:**
- Create: `agenticx/skills/mcp_server.py`
- Test: `tests/test_mcp_skills_server.py`

**内容:**
- [ ] URI 规则：`skill://<skill_name>/SKILL.md`，多文件 skill 的支撑文件 `skill://<skill_name>/<相对路径>`；URI 末段目录名 == frontmatter name（对齐 Agent Skills 规范）
- [ ] `SkillUrnMapper`：注册表 name/version ↔ URI 双向映射；get-by-URI 返回最新版本（注册表 `get_latest` 语义）
- [ ] 单 skill 文件数/字节数超过 512/16MiB 时拒绝暴露并告警（SHOULD 变 MUST 落在自身出口上）

### Task 2: manifest 生成（从存储字节现算）

**Files:**
- Modify: `agenticx/skills/mcp_server.py`
- Test: `tests/test_mcp_skills_server.py`

**内容:**
- [ ] 复用 SP1 `SkillManifest.from_skill_entry()`：条目文件字节 → SHA-256 + size 清单；frontmatter 原样透传（不裁剪字段）
- [ ] 旧版单文件条目（仅 checksum/skill_content）：清单 = [SKILL.md] 一项，digest 由 skill_content 现算——保证旧条目也合规暴露
- [ ] 条目原子性：单个 skill 的 manifest 不跨分页返回

### Task 3: 端点方法实现

**Files:**
- Modify: `agenticx/skills/mcp_server.py`
- Test: `tests/test_mcp_skills_server.py`

**内容:**
- [ ] capabilities 声明：`resources` + `extensions["io.modelcontextprotocol/skills"]{"directoryRead": true}`（目录读取实现后置 true）
- [ ] `skills/list`：全量枚举 + `nextCursor` 分页；每条目带 `resultType/ttlMs/cacheScope`
- [ ] `skills/get`：按 URI 返回单条目；未知 URI → JSON-RPC `-32602`（Invalid params）；**对注册表内每个 skill 必须可响应**（list 可部分、get 必全）
- [ ] `resources/read`：服务 `skill://` URI，返回 `text/markdown` 或对应 mimeType；内部错误 → `-32603`
- [ ] `resources/directory/read`：非递归直接子节点；子目录 mimeType `inode/directory`；URI 无尾斜杠
- [ ] 单测覆盖：分页边界、`-32602`/`-32603` 错误码、目录下钻、mime 标识

### Task 4: CLI 与传输

**Files:**
- Modify: `agenticx/cli/agent_tools.py`（skills 子命令）
- Test: `tests/test_mcp_skills_server.py`（transport 级用例）

**内容:**
- [ ] `agx skills serve`：stdio 与 streamable HTTP 双传输一等公民，同一 server 对象套不同 transport（SDK 原生支持，非两份实现）
  - stdio 为默认（个人 runtime / 宿主子进程场景，零依赖）
  - `--port N` 走 streamable HTTP（团队分发主通道：协议 2026-07-28 起 HTTP 无状态，无 sticky session 要求，可部署在任意网关后）
- [ ] HTTP 传输鉴权位：`--token <T>` 简单 bearer token（预留 OAuth 扩展点；企业级鉴权/审计归 Enterprise Gateway，不在本分支）
- [ ] `--include-gate <level>` 过滤参数：按条目 `gate` 字段只暴露过审等级的 skill（社区分发场景的安全阀）
- [ ] 自进化产物直通：GEPA 入库条目（含 SP3 manifest 后）无需额外动作即可暴露
- [ ] 集成测试：用官方 SDK ClientSession 分别以 stdio 和 HTTP 连自己起的 server，走 list→get→read→directory 全链路（这同时是 SP4 验收的地基）

**完成标志:** 任一支持 skills 扩展的第三方宿主连上后能看到注册表全部（或 gate 过滤后的）skill，manifest 与字节严格一致。
