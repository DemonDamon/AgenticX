# SP3: 治理对齐 — manifest 化与 Bundle MCP 源 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 注册表数据模型从「单文件 checksum」升级为「多文件 manifest」，AGX Bundle 支持引用 MCP 源的 skill，发布/入库路径全部产出 manifest——本地治理语义对齐 SEP-2640。

**Architecture:** `RegistrySkillEntry` 增加 v2 manifest 字段并保持旧字段可读（向后兼容）；发布端（`SkillRegistryServer.publish`、GEPA proposer 入库、bundle 安装器）在写入时生成完整文件清单；读取端遇到旧条目自动降级为单文件 manifest 视图。

**Tech Stack:** Pydantic v2（model 兼容层）；`pathlib`/`hashlib`；pytest。

**前置:** SP1-T1（manifest 模型）；SP2-T1/T2（URI 映射与生成逻辑可复用）。

---

### Task 1: RegistrySkillEntry v2 — 多文件 manifest

**Files:**
- Modify: `agenticx/skills/registry.py`（`RegistrySkillEntry` / `RegistrySkillEntryModel` / `RegistryStorage`）
- Test: `tests/test_skill_registry_manifest.py`

**内容:**
- [ ] `RegistrySkillEntry` 新增 `files: list[SkillFileEntry] | None` 与 `origin: Literal["local", "bundle", "mcp", "learning"]`；保留 `checksum`/`skill_content` 字段不删（旧条目仍可读）
- [ ] `publish()` 入参支持多文件：给定 skill 目录时全量现算清单（每文件 SHA-256 + size），主 digest = SKILL.md 的 digest（与旧 checksum 语义衔接）
- [ ] 读路径兼容：`files is None` 的旧条目 → 视图层包装为单文件 manifest（复用 SP2-T2 逻辑），不回写存储
- [ ] 版本规则不变：name+version 去重；文件清单变化要求 bump version（同一 version 内容不可变）
- [ ] 单测：新旧条目混读、同 version 不同内容拒绝、超限（512/16MiB）拒绝发布

### Task 2: 自进化产物 manifest 化

**Files:**
- Modify: `agenticx/learning/gepa_proposer.py`（入库写入点）
- Test: `tests/test_learning_skill_manifest.py`（或并入现有 learning 测试）

**内容:**
- [ ] GEPA 候选从 `.proposals/` 入库时，连同附属文件（若有）一起生成 manifest；`origin="learning"`
- [ ] 质量门通过 → 审批（`agent_writes_require_approval`）→ 入库三步不动，只在入库写入时附带清单
- [ ] 单测：蒸馏产物入库后 `files` 非空、经 SP2 端点可见

### Task 3: AGX Bundle 增加 MCP 源

**Files:**
- Modify: `agenticx/extensions/bundle.py`（`BundleManifest` / `BundleSkillRef` / `install_bundle`）
- Test: `tests/test_bundle_mcp_source.py`

**内容:**
- [ ] `BundleSkillRef` 扩展：`path`（本地，现状）之外新增 `mcp: {server: str, uri: str}` 引用——bundle 安装时通过 MCP Hub 拉取该 skill 并经 SP1 审批链入库，`origin="mcp"`
- [ ] 安装前置安全扫描扩展到远端条目：先落缓存 → `scan_skill_deep` → 审批 → 入库
- [ ] `agx-bundle.yaml` 校验：path 与 mcp 二选一，都缺失报错
- [ ] 单测：本地/远端混合 bundle 安装；远端不可达时的失败信息

### Task 4: 同名冲突与缓存隔离策略

**Files:**
- Modify: `agenticx/skills/registry.py`（publish 冲突检查）
- Modify: `agenticx/tools/skill_bundle.py`（discovery 忽略清单，若 SP1-T5 未覆盖缓存路径则此处补）
- Test: `tests/test_skill_conflict_policy.py`

**内容:**
- [ ] 发布同名 skill：同 origin 内 name+version 冲突 → 拒绝（现状保持）；不同 origin 同名 → 允许共存，注册表主键含 origin 维度（对齐 SP1 统一索引）
- [ ] 静默替换禁令：任何 update 路径若会改变既有 version 的文件清单 → 拒绝并提示 bump version
- [ ] 缓存目录（`~/.agenticx/skills/cache/`、`.proposals/`）从所有 filesystem discovery 路径排除
- [ ] 单测：三条禁令各有负例

**完成标志:** 注册表里不存在无清单的新条目；旧条目零迁移成本可读；bundle 可同时装本地与 MCP 源 skill。
