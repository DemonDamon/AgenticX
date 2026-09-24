# Skills over MCP (SEP-2640) 接入 — Master Plan

> **For agentic workers:** 本目录下每个 sub plan 按依赖顺序执行。推荐使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实施。所有步骤使用 checkbox（`- [ ]`）跟踪。

**分支:** `feat/skills-over-mcp`（基于 main）
**规范依据:** [ext-skills](https://github.com/modelcontextprotocol/ext-skills)（SEP-2640，Final，2026-09-13 合入；基于协议版本 2026-07-28）
**目标:** AgenticX 同时具备 Skills over MCP 的两端能力——
1. **Host 端（消费）**：MCP Hub 可发现并消费远端 server 暴露的 skills，与本地 skill 统一进一个视图，带来源标签、digest 校验、审批绑定；
2. **Server 端（暴露）**：把本地 skill 注册表（含自进化蒸馏产物）通过 skills 扩展暴露，任何支持该扩展的宿主可消费；
3. **治理对齐**：注册表条目从单文件 checksum 升级为多文件 manifest，审批语义对齐协议（绑定摘要集合、同名不静默替换）。

**非目标（本分支不做）：**
- 不实现 skills 的 LLM 上下文注入策略改造（渐进式披露的 token 优化属运行时调优）
- 不动 A2A / AG-UI 协议栈
- 不做企业 Gateway（Go）侧的 skills 分发——属 Enterprise 产品线

## 规范要点 → 工程约束（实现时必须遵守）

| 规范要求 | 工程约束 |
|---|---|
| server 声明 `capabilities.resources` + `extensions["io.modelcontextprotocol/skills"]` | Host 端必须先探测扩展声明，未声明不得调用 skills 方法 |
| `skills/list` 条目含完整 frontmatter + 文件清单（URI + SHA-256 + 字节数）或 `"dynamic"` | manifest 是一等公民，单文件结构不够用 |
| 身份 = **服务器身份 + URI**，name 只是标签 | 统一注册表的主键必须是 `server_id + uri`，不能是 name |
| 每次读文件校验 digest/size/frontmatter；不匹配拒绝并刷新 | 消费路径上每个 `resources/read` 都要过校验，不能只校验一次 |
| 审批绑定完整文件清单 + 摘要集合；增删改文件 → 审批作废 | 审批记录的数据结构是 digest 集合，不是 skill 名 |
| 缓存文件必须排除出 filesystem skill discovery、保留 MCP origin | 远端 skill 缓存目录不得被 `skill_bundle.py` 扫到 |
| 单 skill ≤ 512 文件 / 16 MiB；摘要无签名，非安全边界 | 沿用现有 `guard.py` 扫描作为内容安全层，digest 只做一致性 |
| `resources/read` 只是运输，读到 ≠ 激活 | 激活路径（校验→审批→注入）在 AgenticX 侧收口，不依赖协议 |

## 现状事实（已验证，规划据此设计）

- **MCP 客户端栈**：官方 SDK `mcp>=1.0.0,<2`（pyproject.toml L104）。`agenticx/tools/remote_v2.py:165` `MCPClientV2` 基于 `ClientSession` + stdio/streamablehttp/sse 三种 transport；`agenticx/tools/mcp_hub.py:122` `MCPHub` 聚合多客户端，**目前只路由 tools，没有 resources 读取，更没有 skills 扩展方法**。
- **Skill 加载**：`agenticx/tools/skill_bundle.py` 扫描本地 skills 目录、解析 SKILL.md frontmatter、封装为 `BaseTool`。
- **Skill 注册表**：`agenticx/skills/registry.py:80` `RegistrySkillEntry`（name/version/description/skill_type/gate/author/created_at/**checksum**/skill_content——**单文件**模型）；`:254` `SkillRegistryServer`；publish 按 name+version 去重、原子写入。
- **安全门**：`agenticx/skills/guard.py:77` `scan_skill`（威胁模式分类、信任分级、`should_allow`）；写入审批开关 `agent_writes_require_approval`（`agenticx/learning/config.py:43`，`agenticx/cli/agent_tools.py:8065` 消费）。
- **AGX Bundle**：`agenticx/extensions/bundle.py` `BundleManifest` / `BundleSkillRef`（本地 path 引用），`install_bundle` 带前置安全扫描与 mcp.json 合并。
- **自进化**：GEPA proposer 产 SKILL.md 候选到 `~/.agenticx/skills/.proposals/`，过五项质量门后入库（`agenticx/learning/`）。

## Sub Plans（执行顺序即依赖顺序）

| # | 文件 | 内容 | 前置 |
|---|---|---|---|
| SP1 | [sp1-host-consumer.md](sp1-host-consumer.md) | Host 消费端：SkillManifest schema、MCPClientV2 扩展方法与能力探测、远端 skill 拉取校验、统一注册表（来源标签）、审批绑定摘要集合、加载路径接入 | — |
| SP2 | [sp2-skill-server.md](sp2-skill-server.md) | Server 暴露端：skills 扩展端点（capabilities 声明、skills/list、skills/get、resources/read、directory/read）、注册表 → skill:// URI 映射、CLI | SP1-T1（manifest schema） |
| SP3 | [sp3-governance-manifest.md](sp3-governance-manifest.md) | 治理对齐：RegistrySkillEntry v2 多文件 manifest（向后兼容）、自进化产物 manifest 化、AGX Bundle MCP 源、同名冲突策略 | SP1-T1；SP2-T2 |
| SP4 | [sp4-e2e-validation.md](sp4-e2e-validation.md) | 端到端验收：双实例 server→host 全链路、篡改检测、审批作废、缓存隔离、回归 | SP1–SP3 |

并行建议：SP1 完成到 Task 2 后，SP2 可并行开工（只依赖 SP1 的 manifest schema）；SP3 需等 SP2 的 URI 映射定稿。

## 设计原则

1. **协议层与产品层分离**：skills 协议编解码（manifest、方法封装）放 `agenticx/skills/` 独立模块，MCP Hub / Server / CLI 只是消费方。避免协议逻辑散进工具层。
2. **先探测后调用**：所有 skills 方法调用前必须确认 server 的 extensions 声明；SDK 未封装的方法用 `ClientSession.send_request` 发原生 JSON-RPC，不 fork SDK。
3. **校验发生在读取点**：digest/size/frontmatter 校验放在每次 `resources/read` 返回处，不在 list 时一次性做完——对齐规范的"acting on a skill"期间保留条目语义。
4. **审批即指纹**：审批记录 = `{server_id, skill_uri, {file_uri: digest}}`。文件集任何变化让旧审批失效，映射到现有 `agent_writes_require_approval` 开关。
5. **本地 skill 不降级**：远端接入不改变本地 skill 的发现与加载路径；统一视图是聚合层，不是替换层。

## 验收标准（SP4 端到端）

```bash
# 终端 1：把注册表暴露为 skills 端点
agx skills serve --transport stdio   # 或 --port 8765

# 终端 2：另一个 AgenticX 实例通过 MCP Hub 消费
agx skills list --remote              # 列出远端 skill，带来源标签
agx skills install skill://pdf-processing/SKILL.md   # 校验 → 审批 → 入统一视图
```

- 远端 skill 与本地 skill 在统一注册表中可见且来源清晰，同名不静默替换
- server 端篡改任一文件后，host 端读取被 digest 校验拒绝，且既有审批自动作废
- `RegistrySkillEntry` v2 条目含完整文件 manifest，旧单文件条目可读（向后兼容）
- GEPA 蒸馏入库的 skill 自动生成 manifest，可直接经 SP2 端点分发
- 全部单测通过；`tests/test_skill_manifest.py`、`tests/test_mcp_skills_host.py`、`tests/test_mcp_skills_server.py` 为新增覆盖
