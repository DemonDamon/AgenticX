# AgenticX 项目概览

> **用途**：新 session 的第一入口。先读本文件获取全局视图，按需再查阅具体模块的 conclusion。
>
> **原则**：只覆盖到一级目录 / 一级子模块，不下钻到文件级。需要文件级细节时，查阅对应 `conclusions/<module>_conclusion.md`。

---

## 项目基本信息

| 属性 | 值 |
|------|-----|
| 名称 | AgenticX |
| 版本 | 0.3.0 |
| 定位 | 统一、可扩展、生产就绪的多智能体应用开发框架 |
| 语言 | Python 3.10+ |
| 许可 | Apache-2.0 / AGPL-3.0 |
| PyPI | `pip install agenticx` |
| 作者 | Ziran Li (Damon Li) |

---

## 顶层目录结构

```
AgenticX/
├── agenticx/          # 核心 Python 包（框架主体）
├── examples/          # 示例与场景 demo
├── tests/             # 测试套件（单元 / 集成 / smoke / e2e）
├── docs/              # 文档（架构、CLI、部署、FAQ 等）
├── conclusions/       # 模块结论摘要（本目录）
├── deploy/            # Docker Compose 部署配置
├── scripts/           # 构建 / 发布脚本
├── research/          # 调研资料（codedeepresearch、legacy_v1）
├── discussions/       # 讨论记录
├── rules/             # 项目约定与规范
├── skills/            # 顶层 skill 定义
├── exps/              # 实验性代码
├── assets/            # 静态资源（logo 等）
├── pyproject.toml     # 项目元数据 & 依赖
├── setup.py           # 兼容性安装入口
├── requirements.txt   # 依赖清单
└── README.md          # 面向用户的项目介绍
```

---

## `agenticx/` 包结构概览（核心框架）

以下是 `agenticx/` 一级子模块的功能定位与结论索引。

### 基础设施层

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **core** | 核心抽象层：Agent、Task、Tool、Workflow、事件系统、编排引擎、上下文编译器 | [core_module_conclusion.md](core_module_conclusion.md) |
| **llms** | LLM 统一接入层：多 provider 适配（OpenAI / 百炼 / Kimi / Ollama / Ark）、failover、流式、缓存 | [llms_module_conclusion.md](llms_module_conclusion.md) |
| **configs** | 静态 GraphRAG / knowledge graphers YAML 样例（无运行时加载逻辑） | [configs_module_conclusion.md](configs_module_conclusion.md) |
| **package_root** | 包门面：版本 / 品牌 / 预设与 `__init__` 条件导出；`pyproject.toml` / `requirements.txt` 契约 | [package_root_conclusion.md](package_root_conclusion.md) |
| **utils** | 跨模块原子写盘与受限 / 签名 pickle 工具 | [utils_module_conclusion.md](utils_module_conclusion.md) |
| **workspace** | 用户 / 分身 / 群聊工作区 bootstrap、Markdown 记忆与 favorites 磁盘读写 | [workspace_module_conclusion.md](workspace_module_conclusion.md) |

### 智能体能力层

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **agents** | 专用智能体实现：MiningPlannerAgent、mining_graph、spawn_worker | [agents_module_conclusion.md](agents_module_conclusion.md) |
| **tools** | 工具系统：内置工具集、函数工具、远程工具（MCP/OpenAPI）、文档路由、skill_bundle | [tools_module_summary.md](tools_module_summary.md) |
| **memory** | 记忆系统：短期 / 语义 / 情景 / 层次化记忆、mem0 集成、MCP 记忆、衰减策略 | [memory_module_conclusion.md](memory_module_conclusion.md) |
| **knowledge** | 框架层文档读入、分块、多后端处理、GraphRAG 建图与向量知识库门面 | [knowledge_module_conclusion.md](knowledge_module_conclusion.md) |
| **data_sources** | Studio 统一外部数据源网关：registry 路由插件与 `query_data_source` 工具 | [data_sources_module_conclusion.md](data_sources_module_conclusion.md) |
| **brain** | 多脑知识库：可隔离/可挂载的「文档脑 + 代码脑」架构、多脑聚合检索 | [brain_module_conclusion.md](brain_module_conclusion.md) |
| **code_index** | 代码语义索引：多代码库 hybrid（向量 + BM25）检索、与「代码脑」衔接 | [code_index_module_conclusion.md](code_index_module_conclusion.md) |
| **embeddings** | 向量嵌入：多 provider 适配、本地 / 远程向量化 | [embeddings_module_conclusion.md](embeddings_module_conclusion.md) |
| **retrieval** | 检索增强：RAG 管线、混合搜索 | [retrieval_module_conclusion.md](retrieval_module_conclusion.md) |
| **planner** | 计划模块：PlanNotebook、任务分解、plan-as-a-tool | [planner_module_conclusion.md](planner_module_conclusion.md) |
| **skills** | 技能注册与生命周期：危险模式扫描、模糊 patch、版本变更日志、来源标注 | [skills_module_conclusion.md](skills_module_conclusion.md) |
| **learning** | 技能自进化：工具调用观察采集、会话复盘自动建技能、质量门禁/使用统计/淘汰闭环 | [learning_module_conclusion.md](learning_module_conclusion.md) |
| **avatar** | 分身体系：注册表、群聊、分身会话与默认模型绑定 | [avatar_module_conclusion.md](avatar_module_conclusion.md) |

### 协作与通信层

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **protocols** | 通信协议：A2A 协议、MCP 协议、SSE 适配 | [protocols_module_conclusion.md](protocols_module_conclusion.md) |
| **collaboration** | 多智能体协作：Workforce 模式、任务委派、角色扮演 | [collaboration_module_conclusion.md](collaboration_module_conclusion.md) |
| **flow** | 装饰器驱动工作流编排（`Flow`）与可干预执行计划（`ExecutionPlan`） | [flow_module_conclusion.md](flow_module_conclusion.md) |

### 运行时与生命周期

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **runtime** | 智能体运行时：meta_agent / meta_tools、团队调度、上下文清洗、子智能体委派、token SSE | [runtime_module_conclusion.md](runtime_module_conclusion.md) |
| **sessions** | 会话管理：持久化、恢复、分布式会话状态、多租户隔离 | [sessions_module_conclusion.md](sessions_module_conclusion.md) |
| **longrun** | 长任务运行/续跑编排：多任务源轮询、工作区隔离、停滞自愈、续跑/失败退避 | [longrun_module_conclusion.md](longrun_module_conclusion.md) |
| **project_state** | 项目级状态机：磁盘单一事实来源、版本化模型、文件锁/原子写、长周期编码闭环 | [project_state_module_conclusion.md](project_state_module_conclusion.md) |
| **hooks** | 全局 Hook 事件总线、目录化 / 声明式 Hook 加载，以及 LLM / Tool 拦截与 Studio 数据面 | [hooks_module_conclusion.md](hooks_module_conclusion.md) |
| **storage** | 存储后端：统一存储接口、多后端（文件 / Redis / Postgres / SQLite） | [storage_module_conclusion.md](storage_module_conclusion.md) |
| **sandbox** | 安全沙箱：受限代码执行、microsandbox / 远端后端、三档模式工厂、JSONL 审计 | [sandbox_module_conclusion.md](sandbox_module_conclusion.md) |
| **safety** | 安全管线：输入验证、Prompt 注入检测、密钥泄漏、审计、沙箱策略（8 个组件，纵深防御） | [safety_module_conclusion.md](safety_module_conclusion.md) |

### 可观测性与评估

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **observability** | 可观测性：回调系统、Prometheus 指标、OTel 集成、span tree、轨迹分析 | [observability_module_conclusion.md](observability_module_conclusion.md) |
| **evaluation** | 评估框架：自动化评估管线、多维指标 | [evaluation_module_conclusion.md](evaluation_module_conclusion.md) |

### 部署与服务化

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **server** | API 服务：FastAPI 路由、网关、SSE、生产级基础设施、webhook 触发 | [server_module_conclusion.md](server_module_conclusion.md) |
| **studio** | 桌面后端：会话管理、SSE、子智能体状态、KB/技能/扩展 REST、群聊路由 | [studio_module_conclusion.md](studio_module_conclusion.md) |
| **gateway** | IM 远程指令网关：飞书 / 企业微信 → 云端 → 本机 Agent 的适配与中继 | [gateway_module_conclusion.md](gateway_module_conclusion.md) |
| **deploy** | 部署工具：AgentKit 配置生成、Dockerfile 生成、火山引擎适配 | [deploy_module_conclusion.md](deploy_module_conclusion.md) |
| **cli** | 命令行工具：`agx` 入口、项目创建、部署、监控 | [cli_conclusion.md](cli_conclusion.md) |

### 领域扩展

| 子模块 | 一句话定位 | 结论文档 |
|--------|-----------|---------|
| **embodiment** | GUI Agent / 具身智能：动作反思、卡住检测、动作缓存、Device-Cloud 路由、DAG 验证 | [embodiment_conclusion.md](embodiment_conclusion.md) |
| **extensions** | AGX Bundle 扩展生态：bundle 定义、本地安装卸载、多源注册表聚合搜索 | [extensions_module_conclusion.md](extensions_module_conclusion.md) |
| **cc_bridge** | 本机 Claude Code 桥接：受 Token 保护的本地 HTTP/NDJSON 控制面、headless / TUI 双模 | [cc_bridge_module_conclusion.md](cc_bridge_module_conclusion.md) |
| **desktop** | Near 桌面应用（Electron + React）：多窗格、群聊、工作区、焦点语音、远程后端 | [desktop_conclusion.md](../desktop/conclusions/desktop_conclusion.md) |
| **integrations** | 第三方适配层：Volcengine AgentKit 桥接与 vendored mem0 记忆引擎 | [integrations_module_conclusion.md](integrations_module_conclusion.md) |
| **delivery** | Near Desktop 交付 POC：git worktree 沙箱 + 五阶段 `plan.mdc` 流水线 | [delivery_module_conclusion.md](delivery_module_conclusion.md) |
| **trainer** | 训练器命名空间占位（当前仅空 `__init__.py`） | [trainer_module_conclusion.md](trainer_module_conclusion.md) |

---

## `examples/` 示例概览

以下按场景分类列出示例目录/文件，不下钻到子目录内部。

### 场景化 Demo 目录

| 目录名 | 场景 |
|--------|------|
| `agenticx-for-agentkit/` | AgentKit 集成（hi-agent、advanced-agent） |
| `agenticx-for-agent-skills/` | Skill 匹配与管理 SOP |
| `agenticx-for-deepresearch/` | 深度调研（2025 AI 事件等） |
| `agenticx-for-chatbi/` | 对话式 BI |
| `agenticx-for-finance/` | 金融场景 |
| `agenticx-for-sandbox/` | 沙箱场景 |
| `agenticx-for-graphrag/` | 图谱 RAG |
| `agenticx-for-vibecoding/` | Vibe Coding |
| `agenticx-for-spec-coding/` | Spec Coding |
| `agenticx-for-guiagent/` | GUI Agent |
| `agenticx-for-docparser/` | 文档解析 |
| `agenticx-for-intent-recognition/` | 意图识别 |
| `agenticx-for-math-modeling/` | 数学建模 |
| `agenticx-for-future-prediction/` | 未来预测 |
| `agenticx-for-modelarch-discovery/` | 模型架构发现 |
| `agenticx-for-queryoptimizer/` | 查询优化 |
| `agenticx-for-mcloud-intentrec/` | MCloud 意图识别 |
| `AgenticX-StellarFlow/` | StellarFlow 集成 |
| `eigent-integration/` | Eigent 集成 |
| `simple_chat_agent/` | 简单聊天 Agent |

### 独立示例脚本（精选）

| 文件 | 用途 |
|------|------|
| `m5_agent_demo.py` / `m6_agent_demo.py` | Agent 核心 demo（单 / 多 Agent） |
| `m7_m8_comprehensive_demo.py` | 工作流 + 协作综合 demo |
| `m9_a2a_demo.py` | A2A 通信 demo |
| `m10_observability_demo.py` | 可观测性 demo |
| `m15_retrieval_demo.py` | 检索增强 demo |
| `hierarchical_memory_demo.py` | 层次化记忆 demo |
| `collaboration_demo.py` | 多智能体协作 demo |
| `hooks_quickstart_demo.py` | 钩子系统快速上手 |
| `mcp_v2_demo.py` | MCP v2 协议 demo |
| `microsandbox_example.py` | Microsandbox 集成 |
| `tool_system_demo.py` | 工具系统 demo |
| `server_example.py` | 服务端 demo |
| `deploy_example.py` | 部署 demo |
| `human_in_the_loop_example.py` | 人机协作 demo |

---

## 内化成果总览

AgenticX 从多个开源项目内化了核心能力，以下是已整理的内化总结：

| 内化来源 | 结论文档 | 主要贡献 |
|----------|---------|---------|
| Google ADK | [adk_internalization_summary.md](adk_internalization_summary.md) | 评估框架、会话管理、上下文编译器 |
| Pydantic AI | [pydantic-ai_internalization_summary.md](pydantic-ai_internalization_summary.md) | 图执行引擎、输出验证 |
| VeADK (火山引擎) | [veadk_internalization_summary.md](veadk_internalization_summary.md) | Agent Builder、模型 fallback、技能沙箱、轨迹转换 |

---

## 怎么用这份索引

1. **新 session 起步**：读本文件，获取模块全貌和定位
2. **定位目标模块**：根据任务找到对应子模块，点击结论链接
3. **深入实现细节**：以 conclusion 中的入口 / 符号为索引，回到源码核对；文件级细节不在本目录展开

## 如何维护

本目录由 `.cursor/skills/code-module-summaries/` skill 管理（`layout: custom`，控制面为 `conclusions/registry.json` + `conclusions/state/`）。日常增量：

```bash
python .cursor/skills/code-module-summaries/scripts/scan_changes.py plan \
  --repo . --control-dir conclusions
```

按 plan 输出更新受影响模块的 conclusion，再对每个模块执行 `checkpoint`。不要用文件 mtime 或「最新一次 commit」作为基线；每模块基线是 `state/<module-id>.json` 中的完整 commit OID。
