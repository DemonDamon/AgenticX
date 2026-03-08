---
name: Studio MCP Skill 集成
overview: 为 agx studio 集成 MCP 连接管理、Skill 发现与激活、以及基于 LLM 的智能推荐（/discover），让 studio 成为 MCP/Skill 的统一入口。
todos: []
isProject: true
phases:
  - name: "Phase 1: MCP 连接管理（/mcp 命令）"
    todos:
      - id: p1-session
        content: "StudioSession 增加 `mcp_hub: Optional[MCPHub]`、`mcp_configs: Dict[str, MCPServerConfig]`（启动时从 load_mcp_config 加载）、`connected_servers: Set[str]` 字段"
        status: done
      - id: p1-helper
        content: 新建 `agenticx/cli/studio_mcp.py`：封装 `mcp_list_servers()`（显示可用+已连接状态）、`mcp_connect(session, name)`（创建 MCPClientV2 → 加入 hub → discover_all_tools → 打印工具列表）、`mcp_disconnect(session, name)`、`mcp_show_tools(session)`（显示所有已连接工具名+描述+input_schema 摘要）、`mcp_call_tool(session, tool_name, args_json)`（调用 hub.call_tool 并打印结果）
        status: done
      - id: p1-commands
        content: studio.py 主循环增加 /mcp 命令分发：/mcp list、/mcp connect <name>、/mcp disconnect <name>、/mcp tools、/mcp call <tool> <json_args>
        status: done
      - id: p1-context
        content: 代码生成 context 注入 mcp_tools：将已连接的 MCP 工具 schema（名称+描述+inputSchema）序列化为文本，作为 `context['mcp_tools']` 传入 CodeGenEngine
        status: done
      - id: p1-codegen
        content: codegen_engine.py `_build_user_prompt()` 处理 `mcp_tools` key：追加「可用的 MCP 工具」段落到 prompt，让生成代码自动使用这些工具
        status: done
      - id: p1-header
        content: _print_header 命令表增加 /mcp 系列命令说明
        status: done
  - name: "Phase 2: Skill 发现与激活（/skill 命令）"
    todos:
      - id: p2-helper
        content: 新建 `agenticx/cli/studio_skill.py`：封装 `skill_list()`（调用 SkillBundleLoader.scan() + 表格展示）、`skill_search(query)`（调用 SkillRegistryClient.search()）、`skill_use(session, name)`（加载 SKILL.md 内容到 session.context_files）、`skill_info(name)`（显示 SKILL.md 完整内容或摘要）
        status: done
      - id: p2-commands
        content: studio.py 主循环增加 /skill 命令分发：/skill list、/skill search <query>、/skill use <name>、/skill info <name>
        status: done
      - id: p2-header
        content: _print_header 命令表增加 /skill 系列命令说明
        status: done
      - id: p2-chat-context
        content: _chat_reply 的 system prompt 中，除了 quickstart 外，也注入已激活 skills 的摘要信息，让对话能引用 skill 知识
        status: done
  - name: "Phase 3: 智能推荐（/discover 命令）"
    todos:
      - id: p3-discover
        content: 实现 `/discover <描述>` 命令：收集所有可用 MCP servers 列表（名称+已有工具描述）+ 所有本地 skills 列表（名称+描述），构建 LLM prompt 让其返回结构化推荐（JSON 格式：recommended_mcps + recommended_skills），解析后展示推荐列表
        status: done
      - id: p3-confirm
        content: 推荐展示后，提示用户「是否自动连接推荐的 MCP 并激活推荐的 Skill？[y/n]」，确认后批量执行 mcp_connect + skill_use
        status: done
      - id: p3-header
        content: _print_header 命令表增加 /discover 命令说明
        status: done
  - name: "Phase 4: 文档与测试"
    todos:
      - id: p4-docs
        content: docs/cli.md 新增「MCP 与 Skill 集成」章节：/mcp 命令用法、/skill 命令用法、/discover 用法、典型工作流示例
        status: done
      - id: p4-tests
        content: tests/ 新增 test_studio_mcp.py 和 test_studio_skill.py：mock MCPClientV2 和 SkillBundleLoader，验证 connect/disconnect/tools/call 流程和 skill_use/list/search 流程
        status: pending
      - id: p4-plan
        content: 提交代码时附带 plan 文件，所有 commit 带 Plan-Id trailer
        status: done
---

# Studio MCP/Skill 集成

## 现状

底层能力全部就绪，studio 是孤岛：

- `MCPClientV2` + `MCPHub`：多 MCP server 连接、工具聚合、工具调用（`agenticx/tools/mcp_hub.py`）
- `load_mcp_config()`：从 `~/.cursor/mcp.json` 加载配置（`agenticx/tools/remote.py:827`）
- `SkillBundleLoader`：扫描本地 skills、合并远程注册中心（`agenticx/tools/skill_bundle.py`）
- `SkillRegistryClient`：搜索/安装远程 skills（`agenticx/skills/registry.py`）

## 设计要点

### MCP 生命周期

- `StudioSession` 持有一个 `MCPHub` 实例（惰性初始化）
- `/mcp connect <name>` 从 `load_mcp_config()` 读取配置 → 创建 `MCPClientV2` → 加入 hub → `discover_all_tools()`
- `/mcp call <tool> <json_args>` 通过 `hub.call_tool()` 实时执行
- `/mcp disconnect <name>` 移除客户端并 `close()`
- 已连接的 MCP 工具 schema 自动注入 `CodeGenEngine` context（`mcp_tools` key）

### Skill 生命周期

- `/skill list` 调用 `SkillBundleLoader.scan()`
- `/skill search <query>` 调用 `SkillRegistryClient.search()`
- `/skill use <name>` 加载 SKILL.md 内容到 `session.context_files`（复用已有机制）
- `/skill info <name>` 显示详情

### 智能推荐（/discover）

- `/discover <描述>` 构建 prompt：系统提示含所有可用 MCP servers 列表 + 所有本地 skills 列表
- LLM 返回推荐的 MCP servers 和 skills
- 用户确认后自动执行 `/mcp connect` + `/skill use`

## 改动文件清单

- `agenticx/cli/studio.py`：核心改动，新增 session 字段、命令处理、上下文注入
- `agenticx/cli/codegen_engine.py`：`_build_user_prompt` 处理 `mcp_tools` context
- `agenticx/cli/studio_mcp.py`（新建）：MCP 相关 helper 函数，隔离复杂度
- `agenticx/cli/studio_skill.py`（新建）：Skill 相关 helper 函数
- `docs/cli.md`：新增 MCP/Skill/Discover 文档章节

