---
name: Built-in Meta Skills
overview: 为 AgenticX 创建内置元 Skills——教会 AI Agent 如何使用 AgenticX 自身的自文档化技能体系。在 agenticx/skills/ 下新增 8 个 SKILL.md 元技能，并集成到 SkillBundleLoader 使其自动发现。
todos:
  - id: t1
    content: "Task 1: 架构设计 — 确定目录结构、命名规范、扫描路径集成方案"
    status: completed
  - id: t2
    content: "Task 2: agenticx-quickstart — 零到一快速入门 SKILL.md"
    status: completed
  - id: t3
    content: "Task 3: agenticx-agent-builder — Agent 构建指南 SKILL.md"
    status: completed
  - id: t4
    content: "Task 4: agenticx-workflow-designer — 工作流设计 SKILL.md"
    status: completed
  - id: t5
    content: "Task 5: agenticx-tool-creator — 自定义工具创建 SKILL.md"
    status: completed
  - id: t6
    content: "Task 6: agenticx-skill-manager — 技能管理全流程 SKILL.md"
    status: completed
  - id: t7
    content: "Task 7: agenticx-deployer — 部署指南 SKILL.md"
    status: completed
  - id: t8
    content: "Task 8: agenticx-a2a-connector — A2A 协议通信 SKILL.md"
    status: completed
  - id: t9
    content: "Task 9: agenticx-memory-architect — 记忆系统 SKILL.md"
    status: completed
  - id: t10
    content: "Task 10: 集成 SkillBundleLoader — 追加内置路径 + 导出 BUILTIN_SKILLS_DIR"
    status: completed
  - id: t11
    content: "Task 11: 验证 — 导入测试 + scan 发现测试"
    status: completed
isProject: false
---

# AgenticX 内置元 Skills 实现计划

> **目标：** 让 AgenticX 拥有自己的"元 Skills"——自文档化技能，教会 AI Agent 如何正确使用框架本身。用户安装 AgenticX 后执行 `agx skills list` 即可看到这些内置教程级 Skills。

## 背景与动机

AgenticX 已有完善的 Skill 生态基础设施（SkillBundleLoader、SkillRegistryClient/Server、CLI `agx skills` 命令），但没有利用这套体系来教用户使用 AgenticX 自己。

**核心想法：** 框架自带的 SKILL.md 文件，比传统文档更强大——AI Agent 可以在需要时自动加载对应 Skill 获取操作指导，实现"用 AgenticX 教 AgenticX"。

## 架构设计

### 目录结构

```
agenticx/skills/
├── __init__.py                          # 已有：registry 导出 + 新增 BUILTIN_SKILLS_DIR
├── registry.py                          # 已有：注册中心实现（不变）
├── agenticx-quickstart/SKILL.md         # 新增
├── agenticx-agent-builder/SKILL.md      # 新增
├── agenticx-workflow-designer/SKILL.md  # 新增
├── agenticx-tool-creator/SKILL.md       # 新增
├── agenticx-skill-manager/SKILL.md      # 新增
├── agenticx-deployer/SKILL.md           # 新增
├── agenticx-a2a-connector/SKILL.md      # 新增
└── agenticx-memory-architect/SKILL.md   # 新增
```

**设计决策：**

- 目录名使用连字符（如 `agenticx-quickstart`），遵循 Agent Skills spec 命名规范，且不会与 Python 模块名冲突
- 直接放在 `agenticx/skills/` 下，与 `registry.py` 同级，随 pip 包一起分发
- 内置路径追加到 `DEFAULT_SEARCH_PATHS` **末尾**（最低优先级），不会覆盖用户自定义 Skills

### 集成方案

在 `SkillBundleLoader.DEFAULT_SEARCH_PATHS` 末尾追加：

```python
_BUILTIN_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
```

扫描优先级（从高到低）：

1. `./.agents/skills` → 项目级 Cherry Studio
2. `./.agent/skills` → 项目级 universal
3. `~/.agents/skills` → 全局 Cherry Studio
4. `~/.agent/skills` → 全局 universal
5. `./.claude/skills` → 项目级 Claude
6. `~/.claude/skills` → 全局 Claude
7. `agenticx/skills/` → **内置元 Skills（新增）**

---

## Task 1: 架构设计

确定目录结构、命名规范、扫描路径集成方案（见上文）。

## Task 2: agenticx-quickstart

**文件：** `agenticx/skills/agenticx-quickstart/SKILL.md`

覆盖内容：

- 安装（pip install, extras）
- 环境变量配置
- `agx project create` 项目脚手架
- 首个 Agent 的 Python 代码（Agent → Task → AgentExecutor → run）
- CLI 快速命令（agent create, workflow create, run）
- 添加工具（@tool 装饰器）
- 核心 CLI 命令速查表

## Task 3: agenticx-agent-builder

**文件：** `agenticx/skills/agenticx-agent-builder/SKILL.md`

覆盖内容：

- Agent 核心概念（id/name/role/goal）
- Minimal Agent vs Rich Configuration
- LLM Providers（OpenAIProvider, LiteLLMProvider）
- 函数装饰器工具 + 工具绑定
- Task 定义 + Pydantic 输出验证
- 执行策略（AgentExecutor, EventLog）
- 多 Agent 模式（Handoff, BroadcastCommunication）
- GuideRails 约束

## Task 4: agenticx-workflow-designer

**文件：** `agenticx/skills/agenticx-workflow-designer/SKILL.md`

覆盖内容：

- 核心组件（Workflow, WorkflowNode, WorkflowEdge, WorkflowEngine）
- 基础工作流构建
- 三种编排模式：顺序 / 并行 / 条件路由
- 图编排（WorkflowGraph）
- 触发器（ScheduledTrigger, EventDrivenTrigger）
- ExecutionContext 状态跟踪
- CLI 工作流管理命令

## Task 5: agenticx-tool-creator

**文件：** `agenticx/skills/agenticx-tool-creator/SKILL.md`

覆盖内容：

- 三种工具类型：@tool 装饰器 / BaseTool 子类 / MCP 远程工具
- ToolRegistry 注册与发现
- MCP 客户端/服务端集成
- SkillTool（技能作为工具）
- ToolContext 执行上下文
- 工具设计最佳实践

## Task 6: agenticx-skill-manager

**文件：** `agenticx/skills/agenticx-skill-manager/SKILL.md`

覆盖内容：

- Skill 是什么 + 发现路径优先级表
- CLI 全流程（list / search / install / uninstall / publish / serve）
- SKILL.md 格式规范
- SkillBundleLoader / SkillRegistryClient 编程接口
- SkillGate 环境门控
- skill_sync 目录同步

## Task 7: agenticx-deployer

**文件：** `agenticx/skills/agenticx-deployer/SKILL.md`

覆盖内容：

- 四种部署方式对比（API Server / Docker / K8s / Volcengine）
- agx serve 配置与健康端点
- Docker 构建流程
- K8s manifest 生成
- Volcengine AgentKit 全流程（init → config → deploy → invoke → destroy）
- 生产部署检查清单

## Task 8: agenticx-a2a-connector

**文件：** `agenticx/skills/agenticx-a2a-connector/SKILL.md`

覆盖内容：

- A2A 协议概述
- 核心组件（AgentCard, Skill, A2ASkillTool, A2ASkillToolFactory）
- AgentCard 定义与技能声明
- 远程技能作为本地工具
- A2AClient 低层 API
- A2AServer 构建
- 多 Agent 分布式架构模式

## Task 9: agenticx-memory-architect

**文件：** `agenticx/skills/agenticx-memory-architect/SKILL.md`

覆盖内容：

- 记忆系统组件（MemoryManager, Mem0Integration）
- 安装 + 初始化
- 存储与检索 API
- 记忆增强 Agent 模式
- MemoryExtractor 自动提取
- 向量存储后端对比（ChromaDB / Qdrant / Redis / Milvus）
- 医疗场景示例

## Task 10: 集成 SkillBundleLoader

**修改文件：**

- `agenticx/tools/skill_bundle.py` — 在 `DEFAULT_SEARCH_PATHS` 末尾追加 `_BUILTIN_SKILLS_DIR`
- `agenticx/skills/__init__.py` — 导出 `BUILTIN_SKILLS_DIR` 常量

**改动量：** ~5 行代码

## Task 11: 验证

验证结果：

- `BUILTIN_SKILLS_DIR` 正确指向 `agenticx/skills/` 目录
- `SkillBundleLoader().scan()` 发现全部 8 个内置元 Skills
- 不影响已有的用户 Skills 发现（优先级最低）

```
$ python -c "from agenticx.tools.skill_bundle import SkillBundleLoader; ..."
Total skills discovered: 14
Built-in meta skills: 8
  agenticx-a2a-connector: Guide for using the A2A...
  agenticx-agent-builder: Guide for creating and configuring...
  agenticx-deployer: Guide for deploying AgenticX agents...
  agenticx-memory-architect: Guide for setting up and using...
  agenticx-quickstart: AgenticX zero-to-hero quickstart...
  agenticx-skill-manager: Guide for managing AgenticX skills...
  agenticx-tool-creator: Guide for creating custom tools...
  agenticx-workflow-designer: Guide for designing and running...
```

---

## 变更汇总


| 类型  | 文件                                                    | 说明                    |
| --- | ----------------------------------------------------- | --------------------- |
| 新增  | `agenticx/skills/agenticx-quickstart/SKILL.md`        | 快速入门元 Skill           |
| 新增  | `agenticx/skills/agenticx-agent-builder/SKILL.md`     | Agent 构建元 Skill       |
| 新增  | `agenticx/skills/agenticx-workflow-designer/SKILL.md` | 工作流设计元 Skill          |
| 新增  | `agenticx/skills/agenticx-tool-creator/SKILL.md`      | 工具创建元 Skill           |
| 新增  | `agenticx/skills/agenticx-skill-manager/SKILL.md`     | 技能管理元 Skill           |
| 新增  | `agenticx/skills/agenticx-deployer/SKILL.md`          | 部署指南元 Skill           |
| 新增  | `agenticx/skills/agenticx-a2a-connector/SKILL.md`     | A2A 协议元 Skill         |
| 新增  | `agenticx/skills/agenticx-memory-architect/SKILL.md`  | 记忆系统元 Skill           |
| 修改  | `agenticx/tools/skill_bundle.py`                      | 追加内置 Skills 扫描路径      |
| 修改  | `agenticx/skills/__init__.py`                         | 导出 BUILTIN_SKILLS_DIR |


## 风险与后续

- **包体积**：8 个 SKILL.md 文件合计 ~30KB，对 pip 包体积影响可忽略
- **兼容性**：内置路径优先级最低，不会覆盖用户同名 Skills
- **后续扩展**：可继续添加 `agenticx-safety-guardian`、`agenticx-hooks-guide`、`agenticx-observability` 等元 Skills
- **国际化**：当前 SKILL.md 为英文（遵循 Agent Skills spec），后续可考虑中文版本

