---
name: Studio Agent Loop 改造
overview: 将 agx studio 从"固定路由 REPL"升级为"LLM Agent Loop + Tool Calling"架构，让 LLM 自主选择工具（bash、file_edit、codegen、mcp_call、skill_use、ask_user 等），同时兼容现有 / 命令快捷方式。这是 CLI 和桌面版的共同底座。
todos: []
isProject: true
phases:
  - name: "Phase 1: Tool 定义与注册"
    todos:
      - id: p1-tool-schema
        content: 新建 `agenticx/cli/agent_tools.py`：定义 STUDIO_TOOLS 列表（OpenAI function calling JSON Schema 格式），包含 bash_exec、file_read、file_write、file_edit、codegen、mcp_connect、mcp_call、skill_use、skill_list、ask_user、list_files 共 11 个工具
        status: pending
      - id: p1-tool-impl
        content: agent_tools.py 中实现每个工具的执行函数：bash_exec 用 subprocess.run（白名单检查）、file_read 用 Path.read_text（行号范围）、file_write 用 Path.write_text（显示 diff 确认）、file_edit 用字符串替换（显示 diff）、codegen 调用 CodeGenEngine、mcp_connect/mcp_call 调用 studio_mcp、skill_use/skill_list 调用 studio_skill、ask_user 用 input() 阻塞等待、list_files 用 os.listdir + glob
        status: pending
      - id: p1-dispatcher
        content: agent_tools.py 中实现 `dispatch_tool(name, arguments, session) -> str` 统一分发器，根据 tool name 路由到对应函数，返回字符串结果
        status: pending
      - id: p1-safety
        content: bash_exec 安全机制：定义 SAFE_COMMANDS 白名单（ls/cat/head/tail/grep/find/wc/python/pip/git/echo/pwd/which/tree），非白名单命令自动调用 ask_user 确认；file_write/file_edit 写入前显示 diff 并确认
        status: pending
  - name: "Phase 2: Agent Loop 引擎"
    todos:
      - id: p2-loop-core
        content: 新建 `agenticx/cli/agent_loop.py`：实现 `run_agent_loop(session, llm, user_input) -> str` 核心函数。构建 system prompt（元 Skills + artifacts + context_files + MCP tools），调用 llm.invoke(messages, tools=STUDIO_TOOLS, tool_choice='auto')，解析 response 中的 tool_calls，执行工具，将结果回注 messages，循环直到 LLM 返回纯文本或达到最大轮次
        status: pending
      - id: p2-system-prompt
        content: agent_loop.py 中实现 `_build_agent_system_prompt(session)` ：注入角色定义、元 Skills 摘要、当前 artifacts、context_files、MCP 工具信息、行为准则（中文回复、关键操作确认、安全约束）
        status: pending
      - id: p2-streaming
        content: Agent Loop 纯文本输出时使用流式输出（复用现有的 print(chunk) 逻辑）；tool_call 执行时显示 spinner 或状态提示
        status: pending
      - id: p2-history
        content: Agent Loop 每轮的 messages（含 tool_calls + tool results）存入 session.chat_history，保持多轮对话连贯性
        status: pending
      - id: p2-max-turns
        content: 最大循环轮次限制（默认 MAX_TOOL_ROUNDS=10），超过时提示用户并停止
        status: pending
  - name: "Phase 3: Studio 主循环改造"
    todos:
      - id: p3-integrate
        content: studio.py 主循环改造：保留所有 / 命令快捷路由（/mcp、/skill、/ctx、/show、/run、/save、/undo、/image、/history、/config、/discover、/exit）；删除 IntentClassifier 路由逻辑，非 / 输入全部走 run_agent_loop(session, llm, user_input)；删除 _chat_reply 函数（Agent Loop 替代）
        status: pending
      - id: p3-session-update
        content: "StudioSession 新增 `agent_messages: List[Dict]` 字段，存储 Agent Loop 的完整 messages 历史（含 tool_calls），替代现有的 chat_history（仅存 role/content 对）"
        status: pending
      - id: p3-welcome
        content: 更新欢迎语：「直接用自然语言描述你想做什么，或输入 shell 命令。」
        status: pending
  - name: "Phase 4: 文档与测试"
    todos:
      - id: p4-docs
        content: docs/cli.md 更新 Studio 章节：说明 Agent Loop 架构、工具列表、安全机制、典型用法示例（自然语言 + shell 命令 + 混合场景）
        status: pending
      - id: p4-tests
        content: tests/test_agent_tools.py 和 tests/test_agent_loop.py：mock LLM 和工具，验证 tool dispatch、安全白名单、循环终止、流式输出
        status: pending
      - id: p4-commit
        content: 按功能点分组提交，所有 commit 带 Plan-Id trailer
        status: pending
---

# Studio Agent Loop 改造

## 架构对比

**现有架构（固定路由）**：

```
用户输入 → IntentClassifier(规则+LLM) → CHAT/GENERATE/MODIFY → 固定处理器
```

**目标架构（Agent Loop）**：

```
用户输入 → / 命令快捷路由（保留）
         → 非 / 开头 → Agent Loop:
             system prompt(元Skills+上下文+工具定义)
             + user message
             → LLM(tool_choice="auto")
             → tool_call? → 执行工具 → 结果回注 → 继续循环
             → 纯文本?  → 流式输出 → 结束
```

## 关键设计决策

### 1. / 命令保留为"快捷方式"

`/mcp`、`/skill`、`/ctx`、`/show`、`/run` 等保持不变，作为 power user 的快捷入口。
非 / 开头的输入全部进入 Agent Loop。

### 2. Tool 定义（JSON Schema for function calling）

每个工具对应一个 Python 函数 + JSON Schema 定义。LLM 通过 `tools` 参数看到所有工具。

**核心工具集**：

- `bash_exec(command)` — 在当前目录执行 shell 命令，返回 stdout/stderr
- `file_read(path, start_line?, end_line?)` — 读取文件内容
- `file_write(path, content)` — 写入/覆盖文件
- `file_edit(path, old_text, new_text)` — 精确替换文件片段（类似 CC 的 apply diff）
- `codegen(target, description)` — 调用 CodeGenEngine 生成 agent/workflow/tool/skill
- `mcp_connect(server_name)` — 连接 MCP server
- `mcp_call(tool_name, arguments)` — 调用 MCP 工具
- `skill_use(name)` — 激活 skill 到上下文
- `skill_list()` — 列出可用 skills
- `ask_user(question)` — 暂停执行，向用户提问，等待回答
- `list_files(directory?, pattern?)` — 列出目录内容（安全版 ls）

### 3. 安全边界

- `bash_exec`：默认白名单（ls, cat, head, tail, grep, find, wc, python, pip, git status/log/diff）
- 非白名单命令需用户确认（通过 ask_user）
- `file_write`/`file_edit` 写入前显示 diff，需确认
- 最大循环轮次限制（防止死循环），默认 10 轮

### 4. 与现有代码的关系

- `IntentClassifier`：**保留但弱化**，仅作为 Agent Loop 内部的一个 fallback
- `CodeGenEngine`：**保留**，作为 `codegen` 工具的底层实现
- `studio_mcp.py`：**保留**，`mcp_connect/mcp_call` 工具的底层实现
- `studio_skill.py`：**保留**，`skill_use/skill_list` 工具的底层实现
- `_chat_reply()`：**替换**为 Agent Loop 的文本输出路径

## 改动文件清单

- `agenticx/cli/agent_tools.py`（新建）：定义所有 Studio Tool 函数 + JSON Schema
- `agenticx/cli/agent_loop.py`（新建）：Agent Loop 核心引擎（system prompt 构建、tool dispatch、循环控制）
- `agenticx/cli/studio.py`（修改）：主循环中非 / 输入走 agent_loop，替代 IntentClassifier + 固定路由
- `agenticx/cli/codegen_engine.py`（微调）：作为 codegen tool 的底层，无重大改动
- `docs/cli.md`（更新）：Agent Loop 使用说明

