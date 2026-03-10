---
name: AgenticX workspace identity
overview: 为 AgenticX 在 `~/.agenticx/` 下引入 OpenClaw 风格的 workspace 目录（IDENTITY.md / USER.md / SOUL.md / MEMORY.md / memory/），并让 meta_agent 的 system prompt 在 session 启动时加载这些文件，使其具有人格化的身份和用户记忆能力。
todos:
  - id: create-workspace-dir
    content: 创建 ~/.agenticx/workspace/ 目录结构和默认 bootstrap 文件（IDENTITY.md / USER.md / SOUL.md / MEMORY.md / memory/）
    status: in_progress
  - id: workspace-loader
    content: 新建 agenticx/workspace/loader.py 模块，负责加载 workspace 文件、ensure_workspace() 初始化
    status: pending
  - id: refactor-meta-agent-prompt
    content: 改造 meta_agent.py 的 prompt 构建逻辑，注入 workspace 身份/用户/记忆上下文，重新分层 prompt 结构
    status: pending
  - id: session-init-workspace
    content: 在 session 启动流程中调用 ensure_workspace()，确保首次运行自动创建默认文件
    status: pending
  - id: config-workspace-path
    content: 在 config_manager.py 的 AgxConfig 中添加 workspace_dir 配置项
    status: pending
isProject: false
---

# AgenticX Workspace 身份与记忆系统

## 现状问题

- `~/.agenticx/` 只有 `config.yaml` + `logs/` + `metrics/`，没有身份/记忆
- `[meta_agent.py](agenticx/runtime/prompts/meta_agent.py)` 的 prompt 完全硬编码，无法感知用户身份
- 问"你是谁"会机械倾倒 skills 列表和 MCP 列表

## 参考：OpenClaw 的 workspace 结构

`~/.openclaw/workspace/` 下的文件构成了完整的身份+记忆体系：

- `AGENTS.md` — 会话启动规则（每次先读什么、记忆策略）
- `IDENTITY.md` — Agent 的名字、角色、风格
- `USER.md` — 用户信息（称呼、时区、偏好）
- `SOUL.md` — 行为人格（不做 chatbot、有主见、先做再问）
- `MEMORY.md` — 长期记忆锚点（用户的关键身份信息）
- `memory/YYYY-MM-DD.md` — 按日期的会话记忆

## 方案

### Phase 1: 创建 `~/.agenticx/workspace/` 目录结构

在 `~/.agenticx/workspace/` 下创建以下 bootstrap 文件：


| 文件            | 作用         | 内容参考                                             |
| ------------- | ---------- | ------------------------------------------------ |
| `IDENTITY.md` | Agent 身份定义 | 名称、角色、风格。默认：AgenticX Desktop Meta-Agent，风格由用户自定义 |
| `USER.md`     | 用户画像       | 用户称呼、时区、偏好。可从 config.yaml 中已有信息初始化               |
| `SOUL.md`     | 行为人格       | 参考 OpenClaw 的 SOUL.md，适配 AgenticX 的 CEO 调度角色     |
| `MEMORY.md`   | 长期记忆       | 用户关键信息锚点，手动或自动维护                                 |
| `memory/`     | 日记忆目录      | 按 `YYYY-MM-DD.md` 存放每日会话记忆                       |


### Phase 2: 新增 workspace 加载模块

新建 `[agenticx/workspace/loader.py](agenticx/workspace/loader.py)`：

```python
WORKSPACE_DIR = Path.home() / ".agenticx" / "workspace"

def load_workspace_file(name: str) -> str | None:
    """Load a workspace markdown file, return None if missing."""

def load_workspace_context() -> dict[str, str]:
    """Load IDENTITY, USER, SOUL, MEMORY + today's memory into a dict."""

def ensure_workspace():
    """Create workspace dir and seed default files if missing."""
```

### Phase 3: 改造 meta_agent.py 的 prompt 构建

在 `[meta_agent.py](agenticx/runtime/prompts/meta_agent.py)` 的 `build_meta_agent_system_prompt()` 中：

1. 调用 `load_workspace_context()` 获取身份、用户、人格、记忆
2. 将 prompt 结构改为：
  - **第一段**：从 `IDENTITY.md` + `SOUL.md` 构建自然的身份描述（不再是"你是 AgenticX Desktop 的首席 Meta-Agent"这种机械开头）
  - **第二段**：从 `USER.md` 注入用户偏好（称呼方式、语言、时区）
  - **第三段**：从 `MEMORY.md` + `memory/today.md` 注入记忆上下文
  - **后续段**：保留现有的核心职责、调度策略、执行纪律（但精简，不在"你是谁"场景全部倾倒）
3. 添加一条指令：当用户问"你是谁"时，基于 IDENTITY + SOUL 简洁回答，不要列举全部 skills/MCP

### Phase 4: 在 session 启动时初始化 workspace

在 `[agenticx/cli/studio.py](agenticx/cli/studio.py)` 或 Desktop 的 `[main.ts](desktop/electron/main.ts)` 中：

- 调用 `ensure_workspace()` 确保目录和默认文件存在
- 首次运行时生成 bootstrap 文件（带引导注释，让用户填写）

### Phase 5: config.yaml 中增加 workspace 路径配置

在 `[config_manager.py](agenticx/cli/config_manager.py)` 的 `AgxConfig` 中添加：

```python
workspace_dir: str = "~/.agenticx/workspace"
```

允许用户自定义 workspace 路径（但默认就是 `~/.agenticx/workspace`）。

## 关键设计决策

- **不引入 SQLite 向量库**：Phase 1 只用 Markdown 文件，保持简单。OpenClaw 的 `main.sqlite` 是更高阶的需求，后续迭代
- **Markdown 文件是「人可读、机可用」的**：用户可以直接编辑这些文件来定义 agent 行为
- **prompt 结构化分层**：身份/人格信息作为 prompt 前缀，能力列表作为后缀的参考资料，避免"问你是谁就倒能力清单"
- **向后兼容**：workspace 文件不存在时，fallback 到现有硬编码行为

