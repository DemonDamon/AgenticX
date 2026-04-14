# AgenticX 三层架构深度分析

## 一、概述

AgenticX 是一个统一、可扩展、生产级的多智能体应用开发框架，采用清晰的三层架构设计：

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop Layer (Electron + React)          │
│  用户界面、状态管理、Native 集成、多面板协作、终端嵌入        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP REST API + SSE Streaming
┌──────────────────────▼──────────────────────────────────────┐
│                  Studio Server Layer (FastAPI)               │
│  会话管理、API 路由、SSE 事件流、MCP 服务器管理、Avatar 管理  │
└──────────────────────┬──────────────────────────────────────┘
                       │ 直接 Python 调用
┌──────────────────────▼──────────────────────────────────────┐
│                   Runtime Layer (Core Agent)                 │
│  智能体调度、工具执行、MCP 集成、循环控制、记忆管理、事件系统  │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、Runtime 层（核心运行时）

### 2.1 模块划分与入口文件

| 模块 | 路径 | 职责 |
|------|------|------|
| **核心调度器** | `agenticx/runtime/agent_runtime.py` | AgentRuntime 主类，think-act 循环 |
| **团队管理** | `agenticx/runtime/team_manager.py` | 子智能体生命周期管理、并发控制 |
| **群组路由** | `agenticx/runtime/group_router.py` | 多智能体群组聊天、消息路由 |
| **元工具集** | `agenticx/runtime/meta_tools.py` | 2800+ 行，高层任务分解与协调工具 |
| **循环控制** | `agenticx/runtime/loop_controller.py` | 最大迭代次数控制 |
| **循环检测** | `agenticx/runtime/loop_detector.py` | 重复模式检测与预警 |
| **工具编排** | `agenticx/runtime/tool_orchestrator.py` | 多工具并行执行、依赖管理 |
| **LLM 重试** | `agenticx/runtime/llm_retry.py` | 指数退避重试策略 |
| **提供者故障转移** | `agenticx/runtime/provider_failover.py` | LLM 提供者降级与备份 |
| **Token 预算** | `agenticx/runtime/token_budget.py` | Token 消耗控制与管理 |
| **上下文压缩** | `agenticx/runtime/compactor.py` | 记忆优化、上下文压缩 |
| **确认机制** | `agenticx/runtime/confirm.py` | ConfirmGate 人类确认门控 |
| **事件系统** | `agenticx/runtime/events.py` | EventType、RuntimeEvent 定义 |
| **Hook 系统** | `agenticx/runtime/hooks/` | 运行时行为扩展点 |
| **任务分解** | `agenticx/runtime/task_decomposer.py` | 复杂任务拆解 |
| **资源监控** | `agenticx/runtime/resource_monitor.py` | 系统资源监控 |
| **健康检查** | `agenticx/runtime/health_probe.py` | 运行时健康探针 |
| **Todo 管理** | `agenticx/runtime/todo_manager.py` | 任务列表管理 |
| **使用量元数据** | `agenticx/runtime/usage_metadata.py` | 使用指标追踪 |

### 2.2 核心类与主函数

#### AgentRuntime（agent_runtime.py:709）
```python
class AgentRuntime:
    """LLM-driven runtime that emits structured events."""
    
    def __init__(
        self,
        llm: Any,
        confirm_gate: ConfirmGate,
        *,
        max_tool_rounds: int = MAX_TOOL_ROUNDS,  # 默认 10
        loop_warning_threshold: int = 4,
        loop_critical_threshold: int = 8,
        hooks: Optional[HookRegistry] = None,
        team_manager: Optional[Any] = None,
        mid_turn_persist: Optional[Callable[[], None]] = None,
    )
    
    async def run_turn(
        self,
        user_input: str,
        session: StudioSession,
        should_stop: Optional[Callable[[], bool | Awaitable[bool]]] = None,
        *,
        agent_id: str = "meta",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
        user_message_content: Optional[Any] = None,
        history_user_attachments: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[RuntimeEvent, None]
```

**主要流程**（run_turn）：
1. 重置 token 预算，设置持久化计时器
2. 构建系统提示词，准备工具列表
3. 清理历史消息，执行上下文压缩
4. 追加用户消息，触发 on_agent_start hook
5. **LLM 调用 → 工具检测 → 工具编排 → 工具执行 → 上下文更新** 循环
6. 直到完成或停止信号

#### TeamManager（team_manager.py）
- 子智能体状态跟踪：pending/running/completed/failed/cancelled
- 并发限制与超时管理
- 子智能体上下文（SubAgentContext）管理

#### GroupRouter（group_router.py）
- 元智能体（leader）与子智能体通信
- 基于上下文的消息路由
- META_LEADER_AGENT_ID 常量定义

### 2.3 MCP 集成

| 文件 | 职责 |
|------|------|
| `agenticx/tools/mcp_hub.py` | MCPHub 多服务器工具聚合 |
| `agenticx/cli/studio_mcp.py` | MCP 配置与连接管理 |
| `agenticx/tools/remote_v2.py` | MCPClientV2 MCP 客户端实现 |

**MCP 工具执行流**：
```
AgentRuntime.run_turn()
    ↓
Tool Orchestrator (partition_tool_calls)
    ↓
MCPHub (mcp_hub.py)
    ↓
MCPClientV2 (remote_v2.py)
    ↓
MCP Server (外部或内置)
    ↓
Tool Execution
    ↓
Result Return
```

### 2.4 导出入口（runtime/__init__.py）

```python
__all__ = [
    "AgentRuntime",              # 核心运行时
    "ConfirmGate",               # 确认门控基类
    "SyncConfirmGate",           # 同步确认
    "AsyncConfirmGate",          # 异步确认
    "AutoApproveConfirmGate",    # 自动批准
    "EventType",                 # 事件类型枚举
    "RuntimeEvent",              # 运行时事件
    "TodoManager",               # Todo 管理
    "Scratchpad",                # 暂存器
    "AgentTeamManager",          # 团队管理器
    "SubAgentContext",           # 子智能体上下文
    "SubAgentStatus",            # 子智能体状态
    "ResourceMonitor",           # 资源监控
    "META_AGENT_TOOLS",          # 元工具集
    "dispatch_meta_tool_async",  # 元工具分发
    "LoopController",            # 循环控制器
    "AutoSolveMode",             # 自动求解模式
    "SpawnConfig",               # 生成配置
]
```

---

## 三、Studio Server 层（Web/API 服务）

### 3.1 模块划分与入口文件

| 模块 | 路径 | 职责 |
|------|------|------|
| **FastAPI 应用** | `agenticx/studio/server.py` | 3600+ 行，主 API 服务器 |
| **会话管理** | `agenticx/studio/session_manager.py` | SessionManager，会话生命周期 |
| **协议模型** | `agenticx/studio/protocols.py` | Pydantic 模型（请求/响应） |
| **Avatar 注册** | `agenticx/avatar/registry.py` | Avatar 管理与发现 |
| **群组聊天** | `agenticx/avatar/group_chat.py` | GroupChatRegistry |
| **Studio MCP** | `agenticx/cli/studio_mcp.py` | MCP 服务器连接与工具构建 |

### 3.2 核心类与主函数

#### create_studio_app()（server.py:192）
```python
def create_studio_app() -> FastAPI:
    """创建 FastAPI 应用，配置路由、中间件、生命周期"""
    
    @contextlib.asynccontextmanager
    async def _studio_lifespan(app: FastAPI):
        """应用生命周期：加载 hooks、初始化 MCP、启动网关等"""
        
    # CORS 中间件配置
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
```

#### SessionManager（session_manager.py:115）
```python
@dataclass
class ManagedSession:
    session_id: str
    studio_session: StudioSession
    confirm_gate: AsyncConfirmGate
    sub_confirm_gates: Dict[str, AsyncConfirmGate]
    team_manager: Optional[AgentTeamManager]
    updated_at: float
    created_at: float
    avatar_id: Optional[str]
    avatar_name: Optional[str]
    session_name: Optional[str]
    pinned: bool
    archived: bool
    taskspaces: list[dict[str, str]]
    execution_state: str  # idle | running | interrupted

class SessionManager:
    def __init__(self, *, ttl_seconds: int = 3600)
    def create(...) -> ManagedSession
    def get(...) -> Optional[ManagedSession]
    def delete(...) -> None
    def list(...) -> list[ManagedSession]
```

### 3.3 API 端点（server.py）

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/chat` | POST | 聊天端点，SSE 流式响应（L993） |
| `/api/confirm` | POST | 确认响应（L974） |
| `/api/session` | GET | 获取会话状态（L755） |
| `/api/session/messages` | GET | 会话消息历史（L855） |
| `/api/session/messages/delete` | POST | 删除消息（L866） |
| `/api/subagents/status` | GET | 子智能体状态（L1666） |
| `/api/subagent/cancel` | POST | 取消子智能体执行（L1623） |
| `/api/subagent/retry` | POST | 重试子智能体（L1758） |
| `/api/mcp/servers` | GET | MCP 服务器列表（L1800） |
| `/api/mcp/connect` | POST | 连接 MCP 服务器（L1860） |
| `/api/mcp/disconnect` | POST | 断开 MCP 服务器（L1920） |
| `/api/mcp/import` | POST | 导入 MCP 配置（L1838） |
| `/api/mcp/settings` | GET | MCP 设置（L1888） |
| `/api/avatars` | GET | Avatar 列表（L2231） |
| `/api/avatars` | POST | 创建 Avatar（L2242） |
| `/api/avatars/fork` | POST | 复制 Avatar（L2603） |
| `/api/avatars/generate` | POST | 生成 Avatar（L2632） |
| `/api/sessions` | GET | 会话列表（L2306） |
| `/api/sessions` | POST | 创建会话（L2335） |
| `/api/sessions/search` | GET | 搜索会话（L2315） |
| `/api/sessions/{session_id}/pin` | POST | 固定会话（L2418） |
| `/api/sessions/{session_id}/fork` | POST | 复刻会话（L2443） |
| `/api/sessions/archive-before` | POST | 归档旧会话（L2459） |
| `/api/sessions/batch-delete` | POST | 批量删除会话（L2475） |
| `/api/groups` | GET | 群组列表（L2675） |
| `/api/groups` | POST | 创建群组（L2683） |
| `/api/taskspace/workspaces` | GET | 工作区列表（L2511） |
| `/api/taskspace/workspaces` | POST | 创建工作区（L2524） |
| `/api/taskspace/files` | GET | 工作区文件（L2561） |
| `/api/taskspace/file` | GET | 读取文件（L2580） |
| `/api/memory/favorites` | GET | 收藏列表（L2766） |
| `/api/memory/save` | POST | 保存记忆（L2818） |
| `/api/messages/forward` | POST | 转发消息（L2878） |
| `/api/skills` | GET | 技能列表（L3049） |
| `/api/skills/{name}` | GET | 技能详情（L3095） |
| `/api/skills/refresh` | POST | 刷新技能（L3125） |
| `/api/skills/settings` | GET | 技能设置（L2952） |
| `/api/tools/status` | GET | 工具状态（L2007） |
| `/api/tools/registry` | GET | 工具注册（L2014） |
| `/api/tools/policy` | GET | 工具策略（L2067） |
| `/api/tools/install` | POST | 安装工具（L2091） |
| `/api/hooks` | GET | Hook 列表（L3300） |
| `/api/hooks/settings` | GET | Hook 设置（L3392） |
| `/api/bundles` | GET | 包列表（L3436） |
| `/api/bundles/install` | POST | 安装包（L3479） |
| `/api/bundles/install-preview` | POST | 预览安装（L3451） |
| `/api/registry/search` | GET | 注册中心搜索（L3549） |
| `/api/registry/skillhub/search` | GET | SkillHub 搜索（L3566） |
| `/api/registry/install` | POST | 注册中心安装（L3619） |
| `/api/registry/install-preview` | POST | 注册中心预览（L3581） |
| `/api/permissions` | GET | 权限（L3143） |
| `/api/cc-bridge/config` | GET | CC Bridge 配置（L3193） |
| `/api/cc-bridge/token/regenerate` | POST | 重新生成 token（L3283） |
| `/api/health/providers` | GET | 提供者健康检查（L3028） |
| `/api/sessions/interrupted` | GET | 被中断会话（L3039） |
| `/api/loop` | POST | 循环控制（L1520） |
| `/api/artifacts` | GET | 产物（L841） |
| `/api/session/summary` | POST | 会话摘要（L946） |
| `/api/test-email` | POST | 测试邮件（L1950） |

### 3.4 协议模型（protocols.py）

```python
class ChatRequest(BaseModel):
    session_id: str
    user_input: str
    group_id: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    agent_id: Optional[str] = None
    mode: Optional[str] = "interactive"
    context_files: Optional[Dict[str, str]] = None
    image_inputs: Optional[List[ChatImageInput]] = None
    mentioned_avatar_ids: Optional[List[str]] = None
    quoted_message_id: Optional[str] = None
    quoted_content: Optional[str] = None
    meta_leader_display_name: Optional[str] = None
    user_display_name: Optional[str] = None
    user_nickname: Optional[str] = None
    user_preference: Optional[str] = None
    active_taskspace_id: Optional[str] = None

class ConfirmResponse(BaseModel):
    session_id: str
    request_id: str
    approved: bool
    agent_id: str = "meta"

class SessionState(BaseModel):
    session_id: str
    provider: Optional[str] = None
    model: Optional[str] = None
    artifact_paths: List[str] = Field(default_factory=list)
    context_files: List[str] = Field(default_factory=list)
    avatar_id: Optional[str] = None
    avatar_name: Optional[str] = None

class SseEvent(BaseModel):
    type: str
    data: Dict[str, Any]
```

### 3.5 Studio MCP 集成（cli/studio_mcp.py）

关键函数：
- `build_mcp_tools_context()`: 为智能体构建 MCP 工具上下文
- `auto_connect_servers()`: 自动连接配置的 MCP 服务器
- `mcp_connect()` / `mcp_connect_async()`: 连接 MCP 服务器
- `mcp_disconnect_async()`: 断开 MCP 服务器
- `load_available_servers()`: 加载可用服务器列表
- `import_mcp_config()`: 导入 MCP 配置

---

## 四、Desktop 层（Electron + React）

### 4.1 模块划分与入口文件

| 模块 | 路径 | 职责 |
|------|------|------|
| **Electron 主进程** | `desktop/electron/main.ts` | Native OS 集成、进程管理、IPC |
| **Electron Preload** | `desktop/electron/preload.ts` | Renderer 安全 API |
| **React 应用** | `desktop/src/App.tsx` | 主应用组件、状态协调 |
| **Zustand 状态** | `desktop/src/store.ts` | 全局状态管理 |
| **聊天视图** | `desktop/src/components/LiteChatView.tsx` | 主要聊天界面 |
| **子智能体面版** | `desktop/src/components/SubAgentPanel.tsx` | 子智能体状态展示 |
| **Avatar 侧边栏** | `desktop/src/components/AvatarSidebar.tsx` | Avatar 选择 |
| **设置面板** | `desktop/src/components/SettingsPanel.tsx` | 配置界面 |
| **确认对话框** | `desktop/src/components/ConfirmDialog.tsx` | 人类确认 UI |
| **终端嵌入** | `desktop/src/components/TerminalEmbed.tsx` | xterm.js 终端 |

### 4.2 核心文件解析

#### Electron Main（electron/main.ts）

**主要职责**：
- macOS Tray 集成、菜单管理、窗口管理
- `agx serve` 进程生命周期管理
- 配置管理：`~/.agenticx/config.yaml`
- 远程后端支持：可连接远程 `agx serve` 实例
- 电源管理：`powerSaveBlocker` 防止自动化任务休眠

**关键配置路径**：
```typescript
const CONFIG_DIR = path.join(os.homedir(), ".agenticx");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.yaml");
const AUTOMATION_TASKS_PATH = path.join(CONFIG_DIR, "automation_tasks.json");
const AUTOMATION_CRONTASK_DIR = path.join(CONFIG_DIR, "crontask");
const WORKSPACE_DIR = path.join(CONFIG_DIR, "workspace");
const META_SOUL_PATH = path.join(WORKSPACE_DIR, "SOUL.md");
const AVATARS_DIR = path.join(CONFIG_DIR, "avatars");
const FEISHU_BINDING_PATH = path.join(CONFIG_DIR, "feishu_binding.json");
const WECHAT_BINDING_PATH = path.join(CONFIG_DIR, "wechat_binding.json");
```

**GPU 策略**（L17-21）：
```typescript
// Windows + NVIDIA 缓解 Chromium 绘制 corruption
if (process.platform === "win32" || process.env.AGX_DISABLE_GPU === "1") {
  app.commandLine.appendSwitch("disable-gpu");
  app.disableHardwareAcceleration();
}
```

#### React App（src/App.tsx）

**主要组件**：
- `AvatarSidebar`: Avatar 选择侧边栏
- `ConfirmDialog`: 确认对话框
- `SettingsPanel`: 设置面板
- `OnboardingView`: 引导视图
- `LiteChatView`: 轻量聊天视图
- `PaneManager`: 多面板管理
- `SidebarResizer`: 侧边栏调整器
- `Topbar`: 顶部栏

**持久化状态**（WORKSPACE_STATE_STORAGE_KEY）：
```typescript
type PersistedPaneState = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
  modelProvider?: string;
  modelName?: string;
  historyOpen: boolean;
  contextInherited: boolean;
  taskspacePanelOpen: boolean;
  membersPanelOpen: boolean;
  sidePanelTab: "workspace" | "members";
  activeTaskspaceId: string | null;
  spawnsColumnOpen?: boolean;
  spawnsColumnSuppressAuto?: boolean;
  spawnsColumnBaselineIds?: string[];
  sessionTokens?: { input: number; output: number };
};
```

#### Zustand Store（src/store.ts）

**核心类型**：
```typescript
export type UiStatus = "idle" | "listening" | "processing";
export type MsgRole = "user" | "assistant" | "tool";
export type SubAgentStatus = 
  | "pending" | "awaiting_confirm" | "running" 
  | "completed" | "failed" | "cancelled";
export type ConfirmStrategy = "manual" | "semi-auto" | "auto";
export type ThemeMode = "dark" | "light" | "dim";
export type ChatStyle = "im" | "terminal" | "clean";

export type ChatPane = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
  modelProvider: string;
  modelName: string;
  messages: Message[];
  historyOpen: boolean;
  contextInherited: boolean;
  taskspacePanelOpen: boolean;
  membersPanelOpen: boolean;
  sidePanelTab: SidePanelTab;
  activeTaskspaceId: string | null;
  spawnsColumnOpen: boolean;
  spawnsColumnSuppressAuto: boolean;
  spawnsColumnBaselineIds: string[];
  terminalTabs: PaneTerminalTab[];
  activeTerminalTabId: string | null;
  sessionTokens: { input: number; output: number };
  historySearchTerms: string[];
};

export type Message = {
  id: string;
  role: MsgRole;
  content: string;
  timestamp?: number;
  agentId?: string;
  avatarName?: string;
  avatarUrl?: string;
  provider?: string;
  model?: string;
  quotedMessageId?: string;
  quotedContent?: string;
  forwardedHistory?: ForwardedHistoryCard;
  attachments?: MessageAttachment[];
  inlineConfirm?: PendingConfirm;
};
```

### 4.3 主要 React 组件

| 组件 | 路径 | 功能 |
|------|------|------|
| `LiteChatView` | `src/components/LiteChatView.tsx` | 主聊天界面 |
| `ChatPane` | `src/components/ChatPane.tsx` | 单个聊天面板 |
| `SubAgentPanel` | `src/components/SubAgentPanel.tsx` | 子智能体列表面板 |
| `SubAgentCard` | `src/components/SubAgentCard.tsx` | 子智能体卡片 |
| `AvatarSidebar` | `src/components/AvatarSidebar.tsx` | Avatar 侧边栏 |
| `SettingsPanel` | `src/components/SettingsPanel.tsx` | 设置面板 |
| `ConfirmDialog` | `src/components/ConfirmDialog.tsx` | 确认对话框 |
| `TerminalEmbed` | `src/components/TerminalEmbed.tsx` | 终端嵌入 |
| `PaneManager` | `src/components/PaneManager.tsx` | 多面板管理 |
| `Topbar` | `src/components/Topbar.tsx` | 顶部栏 |
| `AvatarCreateDialog` | `src/components/AvatarCreateDialog.tsx` | Avatar 创建 |
| `AvatarSettingsPanel` | `src/components/AvatarSettingsPanel.tsx` | Avatar 设置 |
| `SessionHistoryPanel` | `src/components/SessionHistoryPanel.tsx` | 会话历史 |
| `TaskspacePanel` | `src/components/TaskspacePanel.tsx` | 任务空间面板 |
| `WorkspacePanel` | `src/components/WorkspacePanel.tsx` | 工作区面板 |
| `ModelPicker` | `src/components/ModelPicker.tsx` | 模型选择器 |
| `AutomationTab` | `src/components/automation/AutomationTab.tsx` | 自动化标签页 |
| `CommandPalette` | `src/components/CommandPalette.tsx` | 命令调色板 |
| `MessageRenderer` | `src/components/messages/MessageRenderer.tsx` | 消息渲染器 |
| `AssistantBubble` | `src/components/messages/AssistantBubble.tsx` | 助手气泡 |
| `UserBubble` | `src/components/messages/UserBubble.tsx` | 用户气泡 |
| `ToolCallCard` | `src/components/messages/ToolCallCard.tsx` | 工具调用卡片 |
| `MermaidBlock` | `src/components/messages/MermaidBlock.tsx` | Mermaid 图表 |
| `CodePreview` | `src/components/CodePreview.tsx` | 代码预览 |
| `QrConnectModal` | `src/components/QrConnectModal.tsx` | 二维码连接 |
| `KeybindingsPanel` | `src/components/KeybindingsPanel.tsx` | 快捷键面板 |

### 4.4 技术栈（desktop/package.json）

```json
{
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",           // 拖拽
    "@dnd-kit/sortable": "^10.0.0",       // 可排序
    "@xterm/addon-fit": "^0.11.0",         // 终端适配
    "@xterm/xterm": "^6.0.0",              // 终端
    "js-yaml": "^4.1.1",                    // YAML 解析
    "lucide-react": "^0.577.0",             // 图标
    "mermaid": "^11.13.0",                  // 图表
    "node-pty": "^1.1.0",                   // PTY
    "prismjs": "^1.29.0",                   // 代码高亮
    "qrcode": "^1.5.4",                     // 二维码
    "react": "^18.3.1",                      // React
    "react-dom": "^18.3.1",                  // React DOM
    "react-markdown": "^9.0.1",              // Markdown
    "rehype-katex": "^7.0.1",               // 数学公式
    "remark-gfm": "^4.0.1",                  // GFM
    "remark-math": "^6.0.0",                 // 数学
    "whisper-wasm": "^0.0.1",                // 语音识别
    "zustand": "^5.0.3"                       // 状态管理
  },
  "devDependencies": {
    "electron": "^34.0.2",
    "typescript": "^5.8.2",
    "vite": "^6.2.1",
    "tailwindcss": "^3.4.17"
  }
}
```

---

## 五、三层调用关系

### 5.1 调用链总图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Interaction                              │
│  (Keyboard / Mouse / Voice / File Drag)                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    Desktop Layer (React)                             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Zustand Store (src/store.ts)                                  │ │
│  │  - ChatPane[]: 多面板状态                                      │ │
│  │  - Message[]: 消息列表                                         │ │
│  │  - SubAgentStatus: 子智能体状态                                │ │
│  │  - UiStatus: UI 状态 (idle/processing)                        │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
│                             │                                         │
│  ┌──────────────────────────▼────────────────────────────────────┐ │
│  │ React Components (LiteChatView, SubAgentPanel, etc.)         │ │
│  │  - 用户输入处理                                                 │ │
│  │  - SSE 事件渲染                                                 │ │
│  │  - 确认对话框触发                                               │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                              │ HTTP REST + SSE
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                  Studio Server Layer (FastAPI)                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ POST /api/chat (server.py:993)                                    │ │
│  │  - 接收 ChatRequest                                                 │ │
│  │  - 获取/创建 ManagedSession (SessionManager)                       │ │
│  │  - 调用 AgentRuntime.run_turn()                                    │ │
│  │  - 返回 StreamingResponse (SSE)                                    │ │
│  └──────────────────────────┬────────────────────────────────────────┘ │
│                             │                                             │
│  ┌──────────────────────────▼────────────────────────────────────────┐ │
│  │ SessionManager (session_manager.py:115)                           │ │
│  │  - create(): 创建 ManagedSession                                    │ │
│  │  - get(): 获取会话                                                  │ │
│  │  - list(): 列出来会话                                               │ │
│  │  - ManagedSession.studio_session: StudioSession 实例               │ │
│  │  - ManagedSession.team_manager: AgentTeamManager 实例              │ │
│  └──────────────────────────┬────────────────────────────────────────┘ │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                              │ 直接 Python 调用
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                   Runtime Layer (Core)                                  │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ AgentRuntime.run_turn() (agent_runtime.py:784)                   │ │
│  │  ┌─────────────────────────────────────────────────────────────┐ │ │
│  │  │ 1. 构建系统提示词 + 工具列表                                 │ │ │
│  │  │ 2. 上下文压缩 (ContextCompactor)                            │ │ │
│  │  │ 3. LLM 调用 (think)                                          │ │ │
│  │  │ 4. 工具检测与编排 (ToolOrchestrator)                        │ │ │
│  │  │ 5. 工具执行 (act)                                            │ │ │
│  │  │    - STUDIO_TOOLS (native)                                   │ │ │
│  │  │    - MCPHub (MCP 工具)                                       │ │ │
│  │  │    - meta_tools (高层工具)                                    │ │ │
│  │  │ 6. 循环检测 (LoopDetector)                                   │ │ │
│  │  │ 7. Token 预算控制 (TokenBudgetGuard)                         │ │ │
│  │  │ 8. 事件发射 (RuntimeEvent)                                   │ │ │
│  │  └─────────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────┬────────────────────────────────────────┘ │
│                             │                                             │
│  ┌──────────────────────────▼────────────────────────────────────────┐ │
│  │ Event Stream (RuntimeEvent → SseEvent)                            │ │
│  │  - EventType.TEXT: 文本增量                                        │ │
│  │  - EventType.TOOL_CALL: 工具调用                                   │ │
│  │  - EventType.TOOL_RESULT: 工具结果                                 │ │
│  │  - EventType.FINAL: 最终回复                                       │ │
│  │  - EventType.CONFIRM: 确认请求                                     │ │
│  │  - EventType.SUBAGENT_*: 子智能体事件                             │ │
│  │  - token_usage: Token 使用量                                       │ │
│  └──────────────────────────┬────────────────────────────────────────┘ │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                              │ SSE 事件流 (反向)
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                    Desktop Layer (React)                                │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ SSE Event Handler (in App.tsx / LiteChatView.tsx)                │ │
│  │  - 更新 Zustand Store                                              │ │
│  │  - 触发 React 重渲染                                                │ │
│  │  - 播放语音输出 (TTS)                                               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 关键数据流：用户发送消息

```
1. 用户在 LiteChatView 输入文本
   ↓
2. React 调用 store.appendMessage() + store.sendChat()
   ↓
3. sendChat() 发起 fetch POST /api/chat
   └─ ChatRequest: { session_id, user_input, provider, model, ... }
   ↓
4. Studio Server: @app.post("/api/chat") (server.py:993)
   ├─ SessionManager.get(session_id) 获取 ManagedSession
   ├─ 获取 ManagedSession.studio_session (StudioSession)
   ├─ 获取 ManagedSession.get_or_create_team() (AgentTeamManager)
   ├─ 构建 tools: STUDIO_TOOLS + MCP tools (build_mcp_tools_context)
   ├─ 调用 AgentRuntime.run_turn(user_input, session, ...)
   └─ 返回 StreamingResponse
   ↓
5. Runtime: AgentRuntime.run_turn() (agent_runtime.py:784)
   ├─ 构建 system_prompt
   ├─ 准备 tools (过滤 allowed_tool_names)
   ├─ 历史消息清理 + 上下文压缩
   ├─ 循环:
   │  ├─ LLM 调用 (获取响应)
   │  ├─ 检测 tool_calls
   │  ├─ ToolOrchestrator.partition_tool_calls() (分组并行)
   │  ├─ 工具执行:
   │  │  ├─ STUDIO_TOOLS → dispatch_tool_async()
   │  │  ├─ MCP 工具 → MCPHub → MCPClientV2
   │  │  └─ meta_tools → dispatch_meta_tool_async()
   │  ├─ 确认检查 (ConfirmGate)
   │  ├─ 循环检测 (LoopDetector)
   │  ├─ Token 预算 (TokenBudgetGuard)
   │  └─ 发射 RuntimeEvent (yield)
   └─ 结束，发射 EventType.FINAL
   ↓
6. Studio Server: _runtime_event_to_sse_lines() (server.py:82)
   ├─ RuntimeEvent → SseEvent
   ├─ 若 FINAL，追加 token_usage 事件
   └─ "data: {json}\n\n" 格式
   ↓
7. Desktop: SSE EventSource onmessage
   ├─ 解析 SseEvent
   ├─ 根据 type 分发:
   │  ├─ "text" → store.appendText()
   │  ├─ "tool_call" → store.addToolCall()
   │  ├─ "tool_result" → store.setToolResult()
   │  ├─ "confirm" → store.showConfirm()
   │  ├─ "subagent_*" → store.updateSubAgent()
   │  ├─ "final" → store.finalizeMessage()
   │  └─ "token_usage" → store.updateSessionTokens()
   └─ React 自动重渲染相关组件
```

### 5.3 关键数据流：人类确认

```
1. Runtime: AgentRuntime 检测到需要确认
   ↓
2. Runtime: yield RuntimeEvent(type=EventType.CONFIRM)
   ↓
3. Studio Server: SSE 事件 "confirm" 发送到 Desktop
   ↓
4. Desktop: store.showConfirm() → ConfirmDialog 弹窗
   ↓
5. 用户点击"批准"或"拒绝"
   ↓
6. Desktop: POST /api/confirm (server.py:974)
   └─ ConfirmResponse: { session_id, request_id, approved, agent_id }
   ↓
7. Studio Server: 获取 ManagedSession.get_confirm_gate(agent_id)
   ↓
8. Studio Server: confirm_gate.set_response(approved)
   ↓
9. Runtime: confirm_gate.wait() 被唤醒
   ↓
10. Runtime: 继续执行（根据 approved 决定分支）
```

### 5.4 关键数据流：子智能体生成

```
1. Meta Agent 调用 delegate_to_avatar / spawn_agent 等 meta_tool
   ↓
2. meta_tools.dispatch_meta_tool_async() → TeamManager.spawn_subagent()
   ↓
3. TeamManager: 创建 SubAgentContext，状态变为 pending → running
   ↓
4. Runtime: 发射 SUBAGENT_SPAWNED / SUBAGENT_STATUS 事件
   ↓
5. Desktop: SubAgentPanel 显示子智能体卡片（running 状态）
   ↓
6. TeamManager: 子智能体执行 AgentRuntime.run_turn() (独立)
   ├─ 子智能体事件通过 event_emitter 发射
   └─ 同步到主会话
   ↓
7. 子智能体完成 → TeamManager: 状态变为 completed/failed
   ↓
8. Runtime: 发射 SUBAGENT_COMPLETED / SUBAGENT_FAILED 事件
   ↓
9. Desktop: SubAgentCard 更新状态（显示结果或错误）
```

---

## 六、潜在风险点

### 6.1 Runtime 层风险

| 风险 | 位置 | 严重程度 | 说明 |
|------|------|----------|------|
| **循环依赖风险** | `agent_runtime.py` ↔ `meta_tools.py` | 高 | L709 AgentRuntime 导入 meta_tools，meta_tools 回调 AgentRuntime |
| **单点故障** | `AgentRuntime.run_turn()` | 高 | 700+ 行巨型函数，核心调度逻辑集中 |
| **状态一致性** | `ManagedSession.team_manager` | 中 | TeamManager 持有 base_session 引用，需手动同步 |
| **内存泄漏** | `SessionManager._sessions` | 中 | TTL 清理，高并发下可能累积 |
| **MCP 连接泄漏** | `MCPHub` | 中 | 多个 MCP 服务器连接，缺少连接池管理 |
| **Token 预算精度** | `TokenBudgetGuard` | 低 | 仅在 turn 级别重置，跨 turn 累计可能有偏差 |

### 6.2 Studio Server 层风险

| 风险 | 位置 | 严重程度 | 说明 |
|------|------|----------|------|
| **巨型文件** | `server.py` (3600+ 行) | 高 | 单文件包含所有 API 路由，职责过重 |
| **SSE 背压** | `/api/chat` StreamingResponse | 中 | 客户端消费慢时可能导致内存累积 |
| **会话锁竞争** | `ManagedSession.execution_state` | 中 | running/idle/interrupted 状态转换缺少显式锁 |
| **CORS 配置** | `allow_origins=["*"]` | 中 | 生产环境建议限制源 |
| **配置热加载** | ConfigManager | 低 | 部分配置修改需重启服务 |

### 6.3 Desktop 层风险

| 风险 | 位置 | 严重程度 | 说明 |
|------|------|----------|------|
| **状态膨胀** | `ChatPane` 类型 | 中 | 字段达 20+，多面板时内存占用高 |
| **重渲染性能** | `useAppStore` | 中 | 全局状态更新可能触发不必要重渲染 |
| **进程孤儿** | `agx serve` spawn | 中 | Electron 崩溃可能遗留 Python 进程 |
| **配置同步** | `config.yaml` IPC | 低 | 主进程与渲染器配置同步可能有竞态 |
| **离线模式** | Remote Server 连接 | 低 | 网络闪断时 SSE 重连逻辑较简单 |

### 6.4 跨层耦合风险

| 风险 | 涉及层 | 严重程度 | 说明 |
|------|--------|----------|------|
| **协议耦合** | `protocols.py` ↔ TypeScript types | 中 | Pydantic 模型与 TypeScript 类型需手动同步 |
| **事件类型耦合** | `EventType` enum ↔ SSE 消费者 | 中 | 新增事件类型需同步更新 Desktop 处理逻辑 |
| **StudioSession 耦合** | Server ↔ Runtime | 高 | Server 直接持有并操作 StudioSession 内部状态 |

---

## 七、架构图（文字版）

### 7.1 分层架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Desktop Layer (Electron)                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  React Components (UI Layer)                                       │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │  │
│  │  │LiteChatView  │ │SubAgentPanel │ │SettingsPanel/AvatarSidebar│  │  │
│  │  └──────┬───────┘ └──────┬───────┘ └───────────┬──────────────┘  │  │
│  └─────────┼───────────────────┼───────────────────────┼──────────────────┘  │
│            │                   │                       │                   │
│  ┌─────────▼───────────────────▼───────────────────────▼──────────────────┐  │
│  │  Zustand Store (src/store.ts)                                          │  │
│  │  - ChatPane[]    - Message[]      - SubAgentState[]                   │  │
│  │  - UiStatus      - Config         - Avatar[]                          │  │
│  └─────────┬──────────────────────────────────────────────────────────────┘  │
└────────────┼─────────────────────────────────────────────────────────────────┘
             │
             │ HTTP REST + SSE (http://localhost:8765)
             │
┌────────────▼─────────────────────────────────────────────────────────────────┐
│                      Studio Server Layer (FastAPI)                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  API Endpoints (server.py)                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐          │  │
│  │  │ /api/chat   │  │/api/confirm  │  │ /api/sessions/*  │          │  │
│  │  │ /api/subagent│  │/api/mcp/*    │  │ /api/avatars/*   │          │  │
│  │  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘          │  │
│  └─────────┼───────────────────┼─────────────────────┼────────────────────┘  │
│            │                   │                     │                        │
│  ┌─────────▼───────────────────▼─────────────────────▼────────────────────┐  │
│  │  SessionManager (session_manager.py)                                    │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │  │
│  │  │ ManagedSession {                                                  │ │  │
│  │  │   - studio_session: StudioSession    (来自 cli/studio.py)        │ │  │
│  │  │   - confirm_gate: AsyncConfirmGate                                │ │  │
│  │  │   - team_manager: AgentTeamManager    (来自 runtime)             │ │  │
│  │  │ }                                                                 │ │  │
│  │  └───────────────────────────────────────────────────────────────────┘ │  │
│  └─────────┬──────────────────────────────────────────────────────────────┘  │
└────────────┼─────────────────────────────────────────────────────────────────┘
             │
             │ 直接 Python 函数调用
             │
┌────────────▼─────────────────────────────────────────────────────────────────┐
│                        Runtime Layer (Core)                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  AgentRuntime (agent_runtime.py:709)                                  │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │  │
│  │  │ __init__(llm, confirm_gate, team_manager, ...)                   │ │  │
│  │  │                                                                     │ │  │
│  │  │ run_turn(user_input, session, ...)                                │ │  │
│  │  │  ┌─────────────────────────────────────────────────────────────┐ │ │  │
│  │  │  │ 1. System Prompt + Tools Setup                            │ │ │  │
│  │  │  │ 2. Context Compaction (ContextCompactor)                  │ │ │  │
│  │  │  │ 3. LLM Call (think phase)                                  │ │ │  │
│  │  │  │ 4. Tool Call Detection                                    │ │ │  │
│  │  │  │ 5. Tool Orchestration (partition_tool_calls)             │ │ │  │
│  │  │  │ 6. Tool Execution                                          │ │ │  │
│  │  │  │    - STUDIO_TOOLS (native tools)                          │ │ │  │
│  │  │  │    - MCPHub (MCP tools via mcp_hub.py)                  │ │ │  │
│  │  │  │    - meta_tools (high-level coordination)                 │ │ │  │
│  │  │  │ 7. Loop Detection (LoopDetector)                          │ │ │  │
│  │  │  │ 8. Token Budget (TokenBudgetGuard)                        │ │ │  │
│  │  │  │ 9. Emit RuntimeEvent (yield)                              │ │ │  │
│  │  │  └─────────────────────────────────────────────────────────────┘ │ │  │
│  │  └───────────────────────────────────────────────────────────────────┘ │  │
│  └─────────┬──────────────────────────────────────────────────────────────┘  │
│            │                                                                   │
│  ┌─────────┼──────────────────────────────────────────────────────────────┐  │
│  │         │                          Support Modules                        │  │
│  │  ┌──────▼───────┐  ┌──────────────┐  ┌───────────────────────┐      │  │
│  │  │TeamManager   │  │GroupRouter   │  │LoopController/Detector│      │  │
│  │  │              │  │              │  │                       │      │  │
│  │  └──────────────┘  └──────────────┘  └───────────────────────┘      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐      │  │
│  │  │ConfirmGate   │  │LLMRetryPolicy│  │TokenBudgetGuard       │      │  │
│  │  └──────────────┘  └──────────────┘  └───────────────────────┘      │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
             │
             │ MCP Protocol
             │
┌────────────▼─────────────────────────────────────────────────────────────────┐
│                   Tools & MCP Integration Layer                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  MCPHub (tools/mcp_hub.py)                                           │  │
│  │  - 聚合多个 MCP 服务器的工具                                           │  │
│  │  - 路由工具调用到对应服务器                                           │  │
│  └─────────┬──────────────────────────────────────────────────────────────┘  │
│            │                                                                   │
│  ┌─────────┼──────────────────┬──────────────────┬───────────────────────┐  │
│  │         │                  │                  │                       │  │
│  ┌▼────────┐    ┌────────────▼─────────┐   ┌▼──────────────────┐    │  │
│  │MCPClient│    │Studio Tools (builtin)│   │Meta Tools         │    │  │
│  │V2       │    │(tools/builtin.py)    │   │(runtime/meta_tools)│    │  │
│  └─────────┘    └──────────────────────┘   └────────────────────┘    │  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 目录结构总览

```
/Users/damon/myWork/AgenticX/
├── agenticx/                           # Python 包
│   ├── __init__.py
│   ├── cli/                             # CLI 入口
│   │   ├── main.py                     # agx / agenticx 主命令
│   │   ├── studio.py                   # StudioSession 定义
│   │   ├── studio_mcp.py               # MCP 配置与连接
│   │   ├── studio_skill.py             # Skill 管理
│   │   ├── agent_tools.py              # STUDIO_TOOLS 定义
│   │   ├── config_manager.py           # 配置管理
│   │   └── ...
│   ├── runtime/                         # Runtime 层 ⭐
│   │   ├── __init__.py                 # 导出 AgentRuntime 等
│   │   ├── agent_runtime.py            # AgentRuntime 核心类 (709+)
│   │   ├── team_manager.py             # AgentTeamManager
│   │   ├── group_router.py             # GroupChatRouter
│   │   ├── meta_tools.py               # 元工具集 (2800+ 行)
│   │   ├── tool_orchestrator.py        # 工具编排
│   │   ├── loop_controller.py          # 循环控制
│   │   ├── loop_detector.py            # 循环检测
│   │   ├── llm_retry.py                # LLM 重试策略
│   │   ├── provider_failover.py        # 提供者故障转移
│   │   ├── token_budget.py             # Token 预算
│   │   ├── compactor.py                # 上下文压缩
│   │   ├── confirm.py                  # ConfirmGate
│   │   ├── events.py                   # EventType, RuntimeEvent
│   │   ├── hooks/                      # Hook 系统
│   │   ├── todo_manager.py             # Todo 管理
│   │   ├── resource_monitor.py         # 资源监控
│   │   ├── health_probe.py             # 健康检查
│   │   ├── task_decomposer.py          # 任务分解
│   │   ├── usage_metadata.py           # 使用量元数据
│   │   └── ...
│   ├── studio/                          # Studio Server 层 ⭐
│   │   ├── __init__.py
│   │   ├── server.py                   # FastAPI 应用 (3600+ 行)
│   │   ├── session_manager.py          # SessionManager
│   │   ├── protocols.py                # Pydantic 模型 (ChatRequest 等)
│   │   └── ...
│   ├── tools/                           # 工具层
│   │   ├── __init__.py
│   │   ├── mcp_hub.py                  # MCPHub
│   │   ├── remote_v2.py                # MCPClientV2
│   │   ├── builtin.py                  # 内置工具
│   │   ├── function_tool.py            # 函数工具包装
│   │   ├── skill_bundle.py             # Skill 包
│   │   └── ...
│   ├── avatar/                          # Avatar 系统
│   │   ├── registry.py                 # AvatarRegistry
│   │   ├── group_chat.py               # GroupChatRegistry
│   │   └── ...
│   ├── llms/                            # LLM 抽象
│   │   ├── provider_resolver.py        # ProviderResolver
│   │   └── ...
│   ├── memory/                          # 记忆系统
│   │   ├── session_store.py            # SessionStore
│   │   ├── workspace_memory.py         # WorkspaceMemoryStore
│   │   └── ...
│   ├── hooks/                           # Hook 系统
│   ├── gateway/                         # 网关
│   ├── workspace/                       # 工作区
│   ├── utils/                           # 工具函数
│   └── ...
├── desktop/                             # Desktop 层 ⭐
│   ├── package.json
│   ├── electron/
│   │   ├── main.ts                     # Electron 主进程
│   │   ├── preload.ts                  # Preload 脚本
│   │   └── tsconfig.json
│   ├── src/
│   │   ├── main.tsx                    # React 入口
│   │   ├── App.tsx                     # 主应用组件
│   │   ├── store.ts                    # Zustand 全局状态
│   │   ├── components/
│   │   │   ├── LiteChatView.tsx       # 聊天视图
│   │   │   ├── ChatPane.tsx            # 聊天面板
│   │   │   ├── SubAgentPanel.tsx       # 子智能体面版
│   │   │   ├── SubAgentCard.tsx        # 子智能体卡片
│   │   │   ├── AvatarSidebar.tsx       # Avatar 侧边栏
│   │   │   ├── SettingsPanel.tsx       # 设置面板
│   │   │   ├── ConfirmDialog.tsx       # 确认对话框
│   │   │   ├── TerminalEmbed.tsx       # 终端嵌入
│   │   │   ├── PaneManager.tsx         # 面板管理
│   │   │   ├── Topbar.tsx              # 顶部栏
│   │   │   ├── messages/               # 消息组件
│   │   │   ├── automation/             # 自动化组件
│   │   │   ├── ds/                     # 设计系统组件
│   │   │   └── ...
│   │   ├── core/                        # 核心逻辑
│   │   ├── voice/                       # 语音相关
│   │   ├── utils/                       # 工具函数
│   │   └── ...
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── ...
├── pyproject.toml                       # Python 包配置
├── README.md
└── ...
```

---

## 八、结构化摘要

### 8.1 三层职责总结

| 层级 | 技术栈 | 核心入口 | 主要职责 |
|------|--------|----------|----------|
| **Runtime 层** | Python 3.10+ | `agenticx/runtime/agent_runtime.py` <br>`AgentRuntime.run_turn()` | 智能体 think-act 循环、工具执行、MCP 集成、子智能体调度、循环控制、记忆管理 |
| **Studio Server 层** | FastAPI + Uvicorn | `agenticx/studio/server.py` <br>`create_studio_app()` | HTTP API、SSE 事件流、会话管理、MCP 服务器管理、Avatar 管理 |
| **Desktop 层** | Electron 34 + React 18 + Zustand | `desktop/electron/main.ts` <br>`desktop/src/App.tsx` | 用户界面、多面板协作、Native 集成、状态管理、终端嵌入 |

### 8.2 关键调用链路

```
用户输入
  ↓
Desktop: LiteChatView → Zustand store.sendChat()
  ↓
HTTP: POST /api/chat (ChatRequest)
  ↓
Studio Server: SessionManager.get(session_id)
  ↓
Studio Server: AgentRuntime.run_turn(user_input, session)
  ↓
Runtime: (LLM → Tool Orchestration → Tools → Events) loop
  ↓
Studio Server: StreamingResponse (SSE events)
  ↓
Desktop: EventSource → Zustand store 更新 → React 重渲染
```

### 8.3 核心类与函数速查表

| 实体 | 位置 | 用途 |
|------|------|------|
| `AgentRuntime` | `runtime/agent_runtime.py:709` | 核心运行时调度器 |
| `AgentRuntime.run_turn()` | `runtime/agent_runtime.py:784` | 单次执行 turn（think-act 循环） |
| `SessionManager` | `studio/session_manager.py:115` | 会话生命周期管理 |
| `ManagedSession` | `studio/session_manager.py:69` | 单个会话的运行时状态 |
| `create_studio_app()` | `studio/server.py:192` | FastAPI 应用工厂 |
| `POST /api/chat` | `studio/server.py:993` | 聊天端点（SSE 流式） |
| `AgentTeamManager` | `runtime/team_manager.py` | 子智能体团队管理 |
| `GroupChatRouter` | `runtime/group_router.py` | 群组聊天路由 |
| `MCPHub` | `tools/mcp_hub.py` | 多 MCP 服务器工具聚合 |
| `MCPClientV2` | `tools/remote_v2.py` | MCP 协议客户端 |
| `useAppStore` | `desktop/src/store.ts` | Zustand 全局状态 |
| `App` | `desktop/src/App.tsx` | React 主应用组件 |

### 8.4 风险与建议

| 风险域 | 主要问题 | 建议 |
|--------|----------|------|
| **代码组织** | `server.py` (3600+ 行)、`meta_tools.py` (2800+ 行) 过大 | 拆分为多个路由模块 + 服务模块 |
| **跨层耦合** | Server 直接操作 StudioSession 内部状态 | 引入清晰的服务层接口 |
| **类型安全** | Pydantic 模型与 TypeScript 类型手动同步 | 考虑代码生成工具（如 OpenAPI → TypeScript） |
| **可观测性** | Runtime 事件通过 SSE 透出，但缺少 tracing | 集成 OpenTelemetry，端到端追踪 |
| **测试覆盖** | 核心路径缺少集成测试 | 增加关键流程序号测试（chat → confirm → subagent） |

### 8.5 架构亮点

✅ **清晰的分层**：Runtime / Studio Server / Desktop 职责边界明确  
✅ **事件驱动**：RuntimeEvent → SseEvent 流式传递，实时性好  
✅ **可扩展的工具系统**：MCP 协议 + 内置工具 + meta_tools 三层  
✅ **灵活的会话管理**：支持多面板、多 Avatar、子智能体  
✅ **生产级特性**：重试、故障转移、循环检测、Token 预算、确认门控

---

## 附录：文件路径索引

### Runtime 关键文件
- `/Users/damon/myWork/AgenticX/agenticx/runtime/agent_runtime.py`
- `/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py`
- `/Users/damon/myWork/AgenticX/agenticx/runtime/group_router.py`
- `/Users/damon/myWork/AgenticX/agenticx/runtime/meta_tools.py`
- `/Users/damon/myWork/AgenticX/agenticx/runtime/__init__.py`

### Studio Server 关键文件
- `/Users/damon/myWork/AgenticX/agenticx/studio/server.py`
- `/Users/damon/myWork/AgenticX/agenticx/studio/session_manager.py`
- `/Users/damon/myWork/AgenticX/agenticx/studio/protocols.py`
- `/Users/damon/myWork/AgenticX/agenticx/cli/studio_mcp.py`

### Desktop 关键文件
- `/Users/damon/myWork/AgenticX/desktop/electron/main.ts`
- `/Users/damon/myWork/AgenticX/desktop/src/App.tsx`
- `/Users/damon/myWork/AgenticX/desktop/src/store.ts`
- `/Users/damon/myWork/AgenticX/desktop/package.json`

### 工具与 MCP 关键文件
- `/Users/damon/myWork/AgenticX/agenticx/tools/mcp_hub.py`
- `/Users/damon/myWork/AgenticX/agenticx/tools/remote_v2.py`
- `/Users/damon/myWork/AgenticX/agenticx/cli/agent_tools.py`
