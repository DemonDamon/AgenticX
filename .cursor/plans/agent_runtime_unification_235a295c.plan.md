---
name: Agent Runtime Unification
overview: 将 Agent Loop 从 CLI studio.py 中抽象为独立的 AgentRuntime 内核，输出标准化事件流，同时服务 CLI 终端和桌面端（FastAPI + Electron）。
todos: []
isProject: true
phases:
  - name: "Phase 0: Agent Loop 收口（p2-streaming + commit）"
    todos:
      - id: p0-streaming
        content: agent_loop.py 纯文本分支改为流式输出：无 tool_calls 时使用 llm.stream() 逐 token 打印，保持 tool_call 分支不变（仍用 invoke）；更新 test_agent_loop.py 验证流式路径
        status: pending
      - id: p0-commit
        content: "按功能点分组提交 Agent Loop 改造的全部变更，每个 commit 带 Plan-Id: studio_agent_loop_改造_428be5da / Plan-File / Made-with: Damon Li"
        status: pending
  - name: "Phase 1: AgentRuntime 内核抽象"
    todos:
      - id: p1-events
        content: "新建 agenticx/runtime/events.py：定义 RuntimeEvent dataclass（type: str, data: dict）和 EventType 枚举（ROUND_START / TOOL_CALL / TOOL_RESULT / CONFIRM_REQUIRED / CONFIRM_RESPONSE / TOKEN / FINAL / ERROR）"
        status: pending
      - id: p1-confirm-gate
        content: 新建 agenticx/runtime/confirm.py：定义 ConfirmGate 抽象基类（async def request_confirm(question, context) -> bool）+ SyncConfirmGate（CLI 用 input()）+ AsyncConfirmGate（桌面端用 asyncio.Event 等待 HTTP 回复）
        status: pending
      - id: p1-runtime-core
        content: 新建 agenticx/runtime/agent_runtime.py：AgentRuntime 类，核心方法 async def run_turn(user_input, session) -> AsyncGenerator[RuntimeEvent]；内部复用 STUDIO_TOOLS + dispatch_tool + _build_agent_system_prompt；确认操作走 ConfirmGate；token 输出走 RuntimeEvent(TOKEN)；最大轮次走 RuntimeEvent(ERROR)
        status: pending
      - id: p1-tools-refactor
        content: 重构 agent_tools.py：将 _confirm() 和 console.print 替换为通过 ConfirmGate 回调 + 返回结构化结果；dispatch_tool 新增 confirm_gate 参数；保持现有测试兼容（SyncConfirmGate 作为默认）
        status: pending
      - id: p1-tests
        content: tests/test_agent_runtime.py：mock LLM + mock ConfirmGate，验证事件流完整性（ROUND_START → TOOL_CALL → CONFIRM_REQUIRED → TOOL_RESULT → FINAL）、最大轮次终止、纯文本路径产出 TOKEN 事件
        status: pending
  - name: "Phase 2: CLI Adapter 切换"
    todos:
      - id: p2-cli-adapter
        content: 重构 agent_loop.py 的 run_agent_loop：改为 AgentRuntime 的同步包装，内部 asyncio.run(runtime.run_turn(...))，消费事件流：TOKEN→print、TOOL_CALL→显示工具名、CONFIRM_REQUIRED→input()、FINAL→返回文本
        status: pending
      - id: p2-studio-adapt
        content: studio.py 主循环适配：保持 / 命令不变，非 / 输入走新的 run_agent_loop（内部已切换到 Runtime）；验证 /undo、/history、/ctx、@ref 等全部兼容
        status: pending
      - id: p2-trace-cmd
        content: studio.py 新增 /trace 命令：打印最近一次 agent loop 的完整事件流（tool decisions + confirm + results），方便开发者调试
        status: pending
      - id: p2-regression
        content: 运行全量测试（test_agent_tools + test_agent_loop + test_cli_studio），确保 29+ tests 全部通过；补充 /trace 命令的基础测试
        status: pending
  - name: "Phase 3: Service Adapter（FastAPI 服务化）"
    todos:
      - id: p3-protocols
        content: 新建 agenticx/studio/protocols.py：定义 API 请求/响应模型（ChatRequest、ConfirmResponse、SessionState）和 SSE 事件格式，参考桌面版 plan 的 WebSocket API 设计
        status: pending
      - id: p3-session-mgr
        content: 新建 agenticx/studio/session_manager.py：多会话管理（create/get/delete session），每个 session 持有独立 StudioSession + AgentRuntime 实例，支持超时清理
        status: pending
      - id: p3-server
        content: 新建 agenticx/studio/server.py：FastAPI 应用，核心端点：POST /api/chat（SSE 流式返回 RuntimeEvent）、POST /api/confirm（回复确认）、GET /api/session（会话状态）、GET /api/artifacts（产物列表）、DELETE /api/session（重置）
        status: pending
      - id: p3-server-tests
        content: tests/test_studio_server.py：使用 httpx + FastAPI TestClient，验证 SSE 事件流、确认闸门流程、会话生命周期；mock LLM 避免真实调用
        status: pending
      - id: p3-cli-entry
        content: agx serve 命令：在 agenticx/cli/main.py 新增 serve 子命令，启动 FastAPI 服务（uvicorn），支持 --port --host 参数
        status: pending
  - name: "Phase 4: Desktop MVP（Electron + React 脚手架）"
    todos:
      - id: p4-scaffold
        content: desktop/ 目录：Electron + React + TypeScript 项目脚手架（electron-builder + Vite），含 main.ts（主进程）+ App.tsx（渲染进程）+ 基础打包配置
        status: pending
      - id: p4-floating-ball
        content: FloatingBall 组件：全局置顶、可拖拽、状态指示（idle/listening/processing）、右键菜单（设置/侧边栏/退出），参考桌面版 plan 4.1.1 设计
        status: pending
      - id: p4-sidebar
        content: Sidebar 组件：对话气泡（用户/助手/工具调用）、确认弹窗（ConfirmDialog）、代码预览面板、输入框（文本），通过 SSE 连接 agx serve 获取事件流
        status: pending
      - id: p4-tray
        content: 系统托盘集成：菜单项（打开侧边栏/设置/退出）、状态图标切换
        status: pending
      - id: p4-e2e
        content: Desktop 端到端验证：启动 agx serve → 打开 Electron → 输入自然语言 → 看到事件流 → 确认工具调用 → 查看产物
        status: pending
  - name: "Phase 5: 语音层与体验增强（后续）"
    todos:
      - id: p5-stt
        content: 集成 STT（Web Speech API / Whisper）：悬浮球点击→录音→转文字→发送到 /api/chat
        status: pending
      - id: p5-tts
        content: 集成 TTS（Edge TTS / Web Speech API）：FINAL 事件 → 语音播报，支持情感化语气（参考桌面版 plan 4.2.3）
        status: pending
      - id: p5-wakeword
        content: 唤醒词监听（Picovoice / 自定义）：Hey Jarvis → 唤醒 → 开始录音
        status: pending
      - id: p5-interrupt
        content: 语音打断：TTS 播放中检测用户说话 → 停止播放 → 切入新一轮对话
        status: pending
---

# Agent Runtime 统一化

## 战略定位

```
            AgentRuntime（核心内核）
           ┌────────────┴────────────┐
           ▼                          ▼
     CLI Adapter                Service Adapter
    （agx studio）              （FastAPI + SSE）
     typed REPL                       │
                                      ▼
                              Desktop UI (Electron)
                              voice + floating ball
```

**核心原则**：Runtime 是唯一的"大脑"，CLI 和 Desktop 只是不同的"嘴和手"。

## 已有基础（Agent Loop 改造已完成）

- `agenticx/cli/agent_tools.py`：11 个工具 + dispatch_tool + 安全机制
- `agenticx/cli/agent_loop.py`：run_agent_loop + system prompt + 历史管理
- `agenticx/cli/studio.py`：REPL 主循环 + / 命令 + 会话状态
- 安全：shell=False、workspace 边界、diff 确认、高风险子命令检测
- 测试：29 passed（agent_tools + agent_loop + cli_studio）

## 当前问题（要解决的）

- Agent Loop 与 CLI REPL **耦合**：`run_agent_loop` 直接 `console.print`、直接 `input()`
- 无法被 HTTP 服务层调用（阻塞 I/O、无事件流）
- `_confirm()` 和 `ask_user` 是同步 `input()`，桌面端无法接管
- 工具执行结果直接打印到 stdout，不是结构化事件

## 关键设计

### AgentRuntime 事件协议

```python
@dataclass
class RuntimeEvent:
    type: str  # "token" | "tool_call" | "tool_result" | "confirm_required" | "final" | "error" | "round_start"
    data: Dict[str, Any]

# 示例事件流：
# {"type": "round_start", "data": {"round": 1, "max_rounds": 10}}
# {"type": "tool_call",   "data": {"name": "bash_exec", "arguments": {...}}}
# {"type": "confirm_required", "data": {"id": "xxx", "question": "Write to file?"}}
# ... 用户回复 confirm ...
# {"type": "tool_result", "data": {"name": "bash_exec", "result": "exit_code=0..."}}
# {"type": "token",       "data": {"text": "已"}}
# {"type": "token",       "data": {"text": "完成"}}
# {"type": "final",       "data": {"text": "已完成文件写入。"}}
```

### 确认闸门（Confirm Gate）

现有的 `_confirm()`/`ask_user` 改为异步回调：

- CLI adapter：同步 `input()` 阻塞
- Service adapter：发 SSE confirm_required 事件，等 HTTP POST 回复

### 文件清单

- `agenticx/runtime/agent_runtime.py`（新建）：AgentRuntime 核心，输出事件流
- `agenticx/runtime/events.py`（新建）：RuntimeEvent + EventType 定义
- `agenticx/runtime/confirm.py`（新建）：ConfirmGate 抽象 + CLI/Async 实现
- `agenticx/runtime/__init__.py`（新建）：导出
- `agenticx/cli/agent_loop.py`（重构）：改为调用 AgentRuntime
- `agenticx/cli/agent_tools.py`（重构）：confirm 回调化
- `agenticx/cli/studio.py`（适配）：消费 RuntimeEvent 事件流
- `agenticx/studio/server.py`（新建）：FastAPI 服务层
- `agenticx/studio/session_manager.py`（新建）：多会话管理
- `agenticx/studio/protocols.py`（新建）：API 协议定义
- `desktop/`（新建）：Electron + React 前端脚手架

## 与桌面版 plan 的关系

桌面版 plan（`.cursor/plans/2026-03-08-agenticx-studio-desktop.plan.md`）保留作为 **PRD 参考**：

- UI/UX 设计（悬浮球/侧边栏/托盘）→ Phase 4 直接复用
- 语音交互设计 → Phase 5 直接复用
- API 协议草案 → Phase 3 参考并升级
- 技术栈选型 → 沿用（Electron + React + FastAPI + Zustand）
- 里程碑节奏 → 吸收但按新架构重排

