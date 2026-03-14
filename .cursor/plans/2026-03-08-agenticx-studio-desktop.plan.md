---
name: AgenticX Studio Desktop
overview: 基于现有 AGX Studio CLI 构建的 Jarvis 式桌面应用，提供悬浮球/侧边栏 UI、完整语音交互（唤醒词、情感化 TTS、打断恢复）、以及元智能体驱动的全自动 AgenticX 操作体验。
todos: []
isProject: true
phases:
  - name: "Phase 0: 现状与资产盘点"
    todos:
      - id: p0-asset-cli
        content: 确认现有 CLI studio.py 的完整功能：意图分类、代码生成、MCP 管理、Skill 管理、上下文注入、/discover 推荐
        status: done
      - id: p0-asset-meta-skills
        content: 确认 agenticx/skills/ 下的元 Skill：agenticx-quickstart、agenticx-agent-builder、agenticx-workflow-designer、agenticx-tool-creator、agenticx-skill-manager、agenticx-deployer、agenticx-a2a-connector、agenticx-memory-architect
        status: done
---

# AgenticX Studio Desktop 设计文档

> 2026-03-08 | 基于方案 B（服务分层架构）

---

## 一、项目概述

### 1.1 愿景

**AgenticX Studio Desktop** 是一个 Jarvis 式的桌面 AI 助手，它隐藏所有复杂的配置、拖拉拽操作，通过**自然语言 + 语音**的极简交互方式，让用户仅凭描述就能完成：

- 智能体（Agent）的创建、配置、运行
- 工作流（Workflow）的设计、编排、执行
- 工具（Tool）的开发、集成、调用
- 技能（Skill）的发现、安装、使用
- MCP 服务器的连接、管理、工具调用

所有这些操作都由一个**元智能体（Meta-Agent）**全权处理，它深度理解 AgenticX 框架，并在关键决策点寻求用户确认。

### 1.2 核心设计原则


| 原则         | 说明                                  |
| ---------- | ----------------------------------- |
| **隐藏复杂性**  | 所有配置、拖拉拽、技术细节对用户不可见                 |
| **语音优先**   | 完整的语音交互链：唤醒 → 聆听 → 理解 → 执行 → 语音反馈   |
| **半自动自治**  | 元智能体自主执行，但在关键决策点询问确认                |
| **复用现有资产** | 90% 的核心逻辑来自现有的 `agx studio` CLI     |
| **渐进式增强**  | CLI 功能 → 服务化 → UI 包装 → 语音层 → 元智能体增强 |


---

## 二、现有资产盘点

### 2.1 已有的 CLI 功能（100% 可复用）


| 模块            | 文件                                  | 功能                                                      |
| ------------- | ----------------------------------- | ------------------------------------------------------- |
| **意图分类器**     | `agenticx/cli/intent_classifier.py` | GENERATE_CODE / MODIFY_CODE / CHAT / QUESTION / UNCLEAR |
| **代码生成引擎**    | `agenticx/cli/codegen_engine.py`    | 基于描述生成 agent/workflow/tool/skill 代码                     |
| **Studio 核心** | `agenticx/cli/studio.py`            | 会话管理、上下文注入、历史记录、快照/撤销                                   |
| **MCP 管理**    | `agenticx/cli/studio_mcp.py`        | `/mcp list/connect/disconnect/tools/call`               |
| **Skill 管理**  | `agenticx/cli/studio_skill.py`      | `/skill list/search/use/info`                           |
| **智能推荐**      | `agenticx/cli/studio.py`            | `/discover` 命令推荐 MCP + Skill                            |
| **元 Skills**  | `agenticx/skills/*/SKILL.md`        | 8 个 AgenticX 专项技能指南                                     |


### 2.2 已有元 Skills（深度理解 AgenticX）

```
agenticx/skills/
├── agenticx-quickstart         # 快速入门指南
├── agenticx-agent-builder       # Agent 创建与配置
├── agenticx-workflow-designer   # Workflow 设计与编排
├── agenticx-tool-creator        # Tool 开发与集成
├── agenticx-skill-manager       # Skill 管理与使用
├── agenticx-deployer            # 部署与发布
├── agenticx-a2a-connector       # Agent 间通信
└── agenticx-memory-architect    # 内存架构设计
```

---

## 三、系统架构（方案 B：服务分层）

### 3.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron (React/TypeScript)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  悬浮球 UI   │  │  侧边栏对话   │  │  托盘控制     │        │
│  │  (Floating)  │  │  (Sidebar)   │  │  (Tray)      │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              语音交互层（Voice Layer）                      │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │ │
│  │  │ 唤醒词   │  │  STT    │  │  TTS    │  │ 打断管理  │ │ │
│  │  │(WakeWord)│  │(Speech) │  │(Speech) │  │(Interrupt)│ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ IPC / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Meta-Agent Service (Python FastAPI)                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │         Studio Core（复用 CLI 逻辑）                         │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │ │
│  │  │ IntentClass- │ │ CodeGen-     │ │ Studio-      │     │ │
│  │  │ ifier        │ │ Engine       │ │ Session      │     │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │ │
│  │  │ StudioMCP    │ │ StudioSkill  │ │ ContextInj-  │     │ │
│  │  │              │ │              │ │ ection       │     │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Meta-Agent Orchestrator                        │ │
│  │  - 理解用户意图（利用元 Skills）                             │ │
│  │  - 规划执行步骤                                               │ │
│  │  - 关键决策点确认                                             │ │
│  │  - 任务协调与状态追踪                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  MCP Hub     │  │ Skill Loader │  │ Task Queue   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │ 子进程池
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              AgenticX Worker Processes（按需启动）               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Agent Exec   │  │ Workflow     │  │ Tool/Skill   │        │
│  │ Worker       │  │ Engine       │  │ Invoker      │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 分层职责


| 层             | 技术栈                         | 职责                                             |
| ------------- | --------------------------- | ---------------------------------------------- |
| **UI 层**      | Electron + React/TypeScript | 悬浮球、侧边栏对话、托盘、系统级快捷键                            |
| **语音层**       | Web Speech API / 第三方服务      | 唤醒词监听、STT、情感化 TTS、打断管理                         |
| **服务层**       | Python FastAPI              | Meta-Agent 业务逻辑、Studio Core、HTTP/WebSocket API |
| ** worker 层** | AgenticX (独立进程)             | 实际的 Agent 执行、Workflow 运行、重型计算                  |


---

## 四、详细设计

### 4.1 UI 设计：悬浮球 + 侧边栏

#### 4.1.1 悬浮球（Floating Ball）

```
    [ 🎤 ]  ← 悬浮球，默认显示麦克风图标
            ↓ 点击展开
    ┌─────────────────┐
    │  正在听...       │ ← 语音监听状态
    │  "帮我创建一个   │
    │   数据分析 Agent" │ ← 实时转录
    └─────────────────┘
            ↓ 拖拽移动
    [ ⚡ ]  ← 有任务执行时的动画状态
```

**功能**：

- 全局置顶，可拖拽到屏幕任意位置
- 麦克风图标：默认状态，点击开始语音输入
- 动画图标：任务执行中
- 通知气泡：任务完成/需要确认时闪烁
- 右键菜单：设置、打开侧边栏、退出

#### 4.1.2 侧边栏（Sidebar）

```
┌─────────────────────────────────┐
│  AgenticX Studio          [ − ] [×] │
├─────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │ 🎤  语音输入                │ │ ← 输入区
│  │ [文本输入框]                │ │
│  └─────────────────────────────┘ │
├─────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │ 💬  我：帮我创建一个...     │ │ ← 对话历史
│  │ 🤖  好的，我来帮你创建一个  │ │
│  │    数据分析 Agent。需要我    │ │
│  │    连接什么数据源吗？        │ │
│  │ 👉 [确认] [修改] [取消]     │ │ ← 确认按钮
│  └─────────────────────────────┘ │
├─────────────────────────────────┤
│  📊 当前任务：创建 Data Analyst   │ ← 状态区
│     进度：[━━━━━━━━━━] 80%      │
└─────────────────────────────────┘
```

**功能**：

- 对话气泡显示（用户/助手/系统消息）
- 确认按钮：关键决策点（Yes/No/修改）
- 任务进度条
- 生成的代码预览（可折叠）
- 历史记录回溯

#### 4.1.3 托盘（Tray）

```
菜单栏 → [🔴] AgenticX Studio
              ├─ 打开侧边栏
              ├─ 语音设置
              ├─ 查看历史
              ├─ 关于
              └─ 退出
```

### 4.2 语音交互层设计

#### 4.2.1 语音唤醒（Wake Word）

```
"Hey Jarvis"  →  唤醒  →  [悬浮球变亮 + 提示音]
                  ↓
              开始监听
```

**可选唤醒词**：

- "Hey Jarvis"（默认）
- "Hey AgenticX"
- "Hey Studio"
- 自定义唤醒词

#### 4.2.2 语音打断（Interrupt）

```
🤖 正在说："首先，我需要创建一个..."
👤 （打断）"等等，不用数据源了"
    ↓
🤖 立即停止  →  [好的，明白了]  →  调整计划
```

**实现**：

- 持续监听用户输入
- 检测到用户说话时立即停止 TTS
- 理解打断意图并调整执行计划

#### 4.2.3 情感化 TTS

```
任务成功 → 积极、愉悦的语气
需要确认 → 温和、询问的语气
任务失败 → 抱歉、理解的语气
```

### 4.3 Meta-Agent 设计

#### 4.3.1 元智能体的工作流

```
用户请求
    ↓
[意图理解] → 这是什么类型的任务？
    ↓
[技能检索] → 需要哪些元 Skills？
    ↓
[计划生成] → 步骤 1, 2, 3...
    ↓
[关键决策点检测] → 需要确认吗？
    ↓
    ├─ 是 → [询问用户确认]
    │         ↓
    │      [确认/修改/取消]
    └─ 否 → [执行下一步]
    ↓
[执行] → 调用 Studio Core
    ↓
[反馈] → 语音 + 文字反馈
```

#### 4.3.2 元智能体的工具集


| 工具                             | 用途           |
| ------------------------------ | ------------ |
| `read_skill(name)`             | 读取元 Skill 内容 |
| `list_available_skills()`      | 列出可用元 Skills |
| `create_agent(description)`    | 创建 Agent     |
| `create_workflow(description)` | 创建 Workflow  |
| `create_tool(description)`     | 创建 Tool      |
| `connect_mcp(name)`            | 连接 MCP 服务器   |
| `use_skill(name)`              | 激活 Skill     |
| `ask_user(question)`           | 询问用户确认       |
| `list_artifacts()`             | 列出已生成的文件     |


#### 4.3.3 关键决策点定义

需要询问用户确认的场景：

- 🆕 创建新的 Agent/Workflow/Tool 前
- 🔗 连接外部 MCP 服务器前
- ⚠️ 可能有副作用的操作（删除文件、修改配置等）
- 🤔 元智能体不确定用户意图时
- 💰 可能产生费用的操作（调用付费 API）

### 4.4 服务层 API 设计

#### 4.4.1 WebSocket API（实时交互）

```typescript
// 客户端 → 服务端
interface ClientMessage {
  type: 'text' | 'audio' | 'interrupt';
  content?: string;
  audio?: Blob;
}

// 服务端 → 客户端
interface ServerMessage {
  type: 'text' | 'audio' | 'confirm' | 'progress' | 'artifact';
  content?: string;
  audio?: Blob;
  confirm?: {
    question: string;
    options: string[];
  };
  progress?: {
    task: string;
    percent: number;
  };
  artifact?: {
    path: string;
    code: string;
  };
}
```

#### 4.4.2 REST API（管理操作）


| 端点                     | 方法      | 用途           |
| ---------------------- | ------- | ------------ |
| `/api/session`         | GET     | 获取当前会话状态     |
| `/api/session`         | DELETE  | 重置会话         |
| `/api/history`         | GET     | 获取历史记录       |
| `/api/artifacts`       | GET     | 列出已生成文件      |
| `/api/artifacts/:path` | GET     | 下载文件         |
| `/api/mcp/servers`     | GET     | 列出可用 MCP 服务器 |
| `/api/skills`          | GET     | 列出可用 Skills  |
| `/api/config`          | GET/PUT | 获取/修改配置      |


---

## 五、项目结构

### 5.1 目录结构

```
AgenticX/
├── agenticx/
│   ├── cli/
│   │   ├── studio.py              # 现有（保持不变）
│   │   ├── intent_classifier.py   # 现有（保持不变）
│   │   ├── codegen_engine.py      # 现有（保持不变）
│   │   ├── studio_mcp.py          # 现有（保持不变）
│   │   └── studio_skill.py        # 现有（保持不变）
│   └── studio/                     # 【新增】桌面端服务层
│       ├── __init__.py
│       ├── server.py               # FastAPI 服务器
│       ├── meta_agent.py           # 元智能体
│       ├── session_manager.py      # 会话管理
│       ├── voice_controller.py     # 语音控制
│       └── protocols.py            # API 协议定义
├── desktop/                        # 【新增】Electron 前端
│   ├── package.json
│   ├── tsconfig.json
│   ├── electron-builder.yml
│   ├── src/
│   │   ├── main/                   # Electron 主进程
│   │   │   ├── main.ts
│   │   │   ├── ipc.ts              # IPC 处理
│   │   │   └── tray.ts             # 托盘管理
│   │   ├── renderer/               # React 渲染进程
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── FloatingBall.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── ChatBubble.tsx
│   │   │   │   └── ConfirmDialog.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useVoice.ts
│   │   │   │   └── useWebSocket.ts
│   │   │   └── store/
│   │   │       └── index.ts
│   │   └── shared/                 # 共享类型
│   │       └── types.ts
│   └── resources/
│       └── icons/
└── .cursor/plans/
    └── 2026-03-08-agenticx-studio-desktop.plan.md  # 本文档
```

### 5.2 技术栈选型


| 组件         | 技术                              | 选型理由            |
| ---------- | ------------------------------- | --------------- |
| **桌面框架**   | Electron                        | 跨平台、生态成熟、团队熟悉   |
| **前端框架**   | React 18 + TypeScript           | 类型安全、组件化、 hooks |
| **状态管理**   | Zustand                         | 轻量、简单、适合桌面应用    |
| **UI 组件库** | shadcn/ui + Tailwind CSS        | 现代、美观、高度可定制     |
| **后端服务**   | FastAPI                         | 异步、类型提示、自动文档    |
| **语音 STT** | Web Speech API / OpenAI Whisper | 浏览器原生 / 离线可选    |
| **语音 TTS** | Web Speech API / Edge TTS       | 浏览器原生 / 情感化可选   |
| **进程通信**   | IPC + WebSocket                 | 本地高效 + 实时双向     |


---

## 六、MVP 范围与里程碑

### 6.1 MVP 功能范围（Must Have）


| 功能模块              | 包含内容                       |
| ----------------- | -------------------------- |
| **悬浮球 UI**        | 可拖拽、点击展开、任务状态动画            |
| **侧边栏对话**         | 对话气泡、历史记录、代码预览             |
| **文本交互**          | 纯文字的对话式操作                  |
| **Meta-Agent 基础** | 理解意图、调用 Studio Core、关键决策确认 |
| **Agent 创建**      | 描述需求 → 生成代码 → 询问确认 → 保存    |
| **Workflow 创建**   | 描述需求 → 生成编排 → 询问确认 → 保存    |
| **Tool 创建**       | 描述需求 → 生成工具 → 询问确认 → 保存    |
| **MCP 管理**        | 列出/连接/断开 MCP 服务器           |
| **Skill 管理**      | 列出/搜索/激活 Skills            |
| **托盘控制**          | 打开侧边栏、设置、退出                |


### 6.2 后续增强（Should Have / Could Have）


| 优先级        | 功能            |
| ---------- | ------------- |
| **Should** | 语音 STT（语音转文字） |
| **Should** | 语音 TTS（文字转语音） |
| **Should** | 语音唤醒词         |
| **Could**  | 语音打断与恢复       |
| **Could**  | 情感化 TTS       |
| **Could**  | 多轮对话上下文增强     |
| **Could**  | 任务进度可视化       |
| **Could**  | 系统级快捷键        |


### 6.3 开发里程碑

```
Milestone 1: 服务化改造（Week 1-2）
├── 抽取 studio.py 核心逻辑为可调用的服务
├── 实现 FastAPI 服务层
├── 定义 WebSocket + REST API
└── 单元测试

Milestone 2: Electron 基础（Week 2-3）
├── 项目脚手架搭建
├── 悬浮球组件
├── 侧边栏对话组件
├── IPC + WebSocket 连接
└── 托盘集成

Milestone 3: Meta-Agent（Week 3-4）
├── 元智能体 Orchestrator
├── 元 Skills 集成
├── 关键决策点检测
├── 用户确认流程
└── 端到端测试

Milestone 4: 语音交互（Week 4-5）
├── STT 集成
├── TTS 集成
├── 唤醒词监听
├── 打断管理
└── 语音测试

Milestone 5:  polish & 发布（Week 5-6）
├── UI/UX 优化
├── 性能优化
├── 打包与签名
├── 安装包生成
└── 文档
```

---

## 七、风险与缓解


| 风险              | 影响  | 概率  | 缓解措施                  |
| --------------- | --- | --- | --------------------- |
| 语音识别准确率不高       | 中   | 高   | 提供 fallback 文本输入，允许编辑 |
| Meta-Agent 理解偏差 | 高   | 中   | 关键决策点强制确认，提供修改选项      |
| 进程隔离复杂度         | 中   | 中   | 从简单开始，逐步引入 worker 池   |
| 打包体积过大          | 低   | 高   | 优化依赖，按需加载，提供轻量版       |
| 跨平台兼容性问题        | 中   | 中   | 早期多平台测试，CI 自动化        |


---

## 八、成功标准

### 8.1 功能标准

- 用户可以仅凭语音描述创建一个 Agent
- 用户可以仅凭语音描述创建一个 Workflow
- 用户可以仅凭语音描述创建一个 Tool
- Meta-Agent 能在关键决策点询问确认
- 所有现有 CLI 功能在桌面端可用

### 8.2 体验标准

- 从启动到可交互 < 3 秒
- 语音识别延迟 < 500ms
- 任务完成后 1 秒内有反馈
- 用户学习曲线 < 10 分钟
- "Wow" 时刻："这也太简单了！"

---

## 附录

### A. 参考对话示例

#### 示例 1：创建 Agent

```
👤 (语音) "Hey Jarvis，帮我创建一个数据分析智能体"
🤖 (语音) "好的，我来帮你创建一个数据分析 Agent。
            你希望它连接什么数据源吗？比如数据库、CSV 文件、或者 API？"
👤 "就用 CSV 文件吧"
🤖 "明白了。我计划：
            1. 创建一个 Data Analyst Agent
            2. 添加 CSV 读取工具
            3. 配置可视化输出
            要继续吗？"
👤 "继续"
🤖 "好的，正在创建...
            [进度条动画]
            完成！我已经为你创建了 `data_analyst_agent.py`。
            要我帮你运行一下吗？"
```

#### 示例 2：设计 Workflow

```
👤 "我想做一个研究工作流，先搜索资料，然后总结，最后生成报告"
🤖 "听起来是个三阶段的 research pipeline。让我确认一下：
            1. Research Agent：搜索网络资料
            2. Analyst Agent：分析和总结
            3. Writer Agent：生成最终报告
            顺序执行，对吗？"
👤 "对，而且第二个 Agent 需要把结果发给第三个"
🤖 "明白了，我会加上 A2A 通信。
            要我生成这个 workflow 吗？"
👤 "好的"
🤖 "生成中...
            完成！`research_workflow.py` 已创建。
            这个 workflow 使用了 3 个 Agent 和 2 条边。
            需要我解释一下代码吗？"
```

#### 示例 3：连接 MCP + Skill

```
👤 "我想处理一些 PDF 文件"
🤖 "让我看看有什么合适的工具...
            [调用 /discover]
            我推荐：
            - MCP: filesystem（读取文件）
            - Skill: agenticx-quickstart（基础用法）
            要我自动连接和激活吗？"
👤 "好的"
🤖 "正在连接 filesystem MCP...
            正在激活 agenticx-quickstart skill...
            完成！现在你可以让我帮你处理 PDF 了。"
```

### B. 元 Skill 注入示例

Meta-Agent 的 System Prompt 会动态注入元 Skills：

```python
system_prompt = """
你是 AgenticX Studio 的元智能体，帮助用户通过自然语言操作 AgenticX。

以下是可用的元 Skills（根据需要参考）：

{agenticx-quickstart}
{agenticx-agent-builder}
{agenticx-workflow-designer}
{agenticx-tool-creator}
...

你的目标是：
1. 理解用户需求
2. 规划执行步骤
3. 在关键决策点询问用户确认
4. 调用相应的工具完成任务
5. 用自然语言反馈结果

开始！
"""
```

