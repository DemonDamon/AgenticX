---
name: 2026-04-06-firecrawl-local-mcp-integration
overview: 在不引入云端 API Key 依赖的前提下，为 AgenticX 增加 Firecrawl 本地 MCP 集成能力，并修复技能侧联网调用策略，确保 tech-daily-news 可稳定使用已连接工具完成周报抓取。
todos:
  - id: inspect-mcp-defaults
    content: 梳理并确认 mcp 默认配置注入与 auto_connect 现状（studio_mcp/server/studio）
    status: completed
  - id: add-firecrawl-default-entry
    content: 在 MCP 默认配置中新增 firecrawl 本地接入条目，保持非破坏性合并
    status: completed
  - id: wire-default-autoconnect
    content: 在未显式配置时将 firecrawl 纳入默认 auto_connect 候选
    status: completed
  - id: harden-tool-selection-prompts
    content: 强化 list_mcps/mcp_tool_names 引导与未知工具名报错提示
    status: completed
  - id: add-selfhost-docs-and-verify
    content: 补充本地自托管文档与联通性验证步骤，并执行读路径验证
    status: completed
isProject: false
---

# Firecrawl 本地 MCP 集成方案

## 目标与边界
- 目标：将 Firecrawl 作为本地 MCP 工具接入 AgenticX，默认可自动连接（你已确认），并让技能执行严格基于 `list_mcps` / `mcp_tool_names`，避免虚构工具名。
- 边界：本次不做桌面端自动拉起 Docker 容器；提供清晰的本地部署与验证引导文档。

## 代码改动计划
- 更新 MCP 默认配置注入逻辑，在 [agenticx/cli/studio_mcp.py](agenticx/cli/studio_mcp.py) 中：
  - 扩展 `ensure_default_agenticx_mcp_json()` 的默认条目，新增 `firecrawl`（stdio 模式，命令形态为 `npx -y firecrawl-mcp`，并支持本地 `FIRECRAWL_API_URL` 环境变量）。
  - 保持“仅补充、不覆盖用户已有配置”的策略，与现有 `browser-use` 一致。
- 更新 MCP 自动连接默认策略，在 [agenticx/studio/server.py](agenticx/studio/server.py) 与 [agenticx/cli/studio.py](agenticx/cli/studio.py) 的 `mcp.auto_connect` 解析逻辑中：
  - 当用户未显式配置 `mcp.auto_connect` 时，默认候选包含 `firecrawl`（并保留当前对 `browser-use` 的特殊过滤约束）。
  - 若用户已配置，严格尊重用户配置，不强行追加。
- 优化技能调用防呆，在 [agenticx/runtime/prompts/meta_agent.py](agenticx/runtime/prompts/meta_agent.py) 与 [agenticx/cli/agent_tools.py](agenticx/cli/agent_tools.py) 中：
  - 增加“先 `list_mcps` 再 `mcp_call`”的硬性提示；
  - 强化错误文案，遇到未知 `tool_name` 时优先提示可用 `mcp_tool_names`，避免出现 `web.fetch.ai-tech-sites-weekly-updates` 这类编造名称。
- 针对 `tech-daily-news` 来源技能做本地优先策略说明（不改用户个人技能文件内容前提下，先在运行时提示层兜底）：
  - 通过系统提示与工具描述明确：优先 Firecrawl，本地不可用时回退 bocha 搜索工具。

## 文档与可操作指引
- 在项目文档补充本地自托管接入步骤（建议新建或补充至现有 MCP/Tools 指南）：
  - 本地启动 Firecrawl（docker compose）；
  - 在 `~/.agenticx/mcp.json` / 设置面板校验 `firecrawl` 配置；
  - `list_mcps`、`mcp_connect firecrawl`、`mcp_call` 的最小连通性验证流程；
  - 无 API key 的本地模式说明与常见故障排查。

## 验证计划
- 单元/冒烟验证：
  - `load_available_servers()` 能识别 `firecrawl`；
  - 新会话下 `list_mcps` 可见 `firecrawl` 且按 auto_connect 规则尝试连接；
  - 未知 MCP 工具名报错包含可用工具引导。
- 手工验证：
  - 本地起 Firecrawl 后，在 Desktop MCP 面板看到并连接 `firecrawl`；
  - 用一次日报指令验证不再调用虚构工具名，且能产出目标 Markdown 文件。

## 风险与回退
- 风险：`firecrawl-mcp` 版本或本地环境（Node/Docker）差异导致连接失败。
- 缓解：默认配置只“提供入口”，失败时保留现有 bocha 路径回退；不影响其他 MCP。
- 回退：移除默认 `firecrawl` 注入和默认 auto_connect 候选即可恢复现状。