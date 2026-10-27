---
name: agenticx-enterprise-agent-builder
description: Draft or modify an ENTERPRISE managed agent (企业智能体) from a natural-language request, preview the version diff, and submit it as a draft for admin review. Use when the user wants to build, change, or migrate an agent for their company's managed agent platform. Not for local desktop avatars (use agenticx-agent-builder for 本机分身).
metadata:
  author: AgenticX
  version: "0.1.0"
---

# 企业智能体构建（草稿）

帮助员工用自然语言起草企业智能体配置（`agx.agent/v1`），在对话里展示与企业侧最新版本的差异，确认后提交为**草稿**。发布永远由管理员在管理台完成。

## 硬性规则

1. 只用 `enterprise_agent_builder` 工具读写企业侧；看不到该工具时先调用 `tool_search` 搜索 `enterprise_agent_builder`。
2. **永远不要说「已发布」「已上线」「同事已经可以用了」**。提交成功只代表草稿或候选版本已保存。
3. 提交前必须先 `preview`，把「变更摘要」和 `diff` 代码块原样展示给用户，并得到用户明确同意后再 `submit`。
4. 不要把任何密钥、Token、密码、Cookie 写进配置或系统提示；需要访问外部系统时告诉用户「凭证由管理员在凭证库中配置」。
5. 只能修改用户自己通过 Near 提交的企业智能体；`list` 里没有的不要尝试修改。
6. 用户只是想要一个本机分身时，改用 `agenticx-agent-builder` 技能。

## 流程

1. **澄清**（最多两轮，优先给选项）：负责什么、给谁用、需要哪些能力（读写文件、执行命令、联网检索、读取文档）、哪些操作需要人工确认。
2. **修改已有智能体时**：先 `list`，再 `get` 取最新版本，在原配置上**只改用户要求的部分**，其余字段（含数组里未提到的项）原样保留。
3. **起草 Manifest**（见下方字段说明），调用 `preview`。
4. **展示**：照抄工具返回的「预检结果 / 变更摘要 / 差异」。有「需要修正」时先修正再 `preview`。
5. **确认后提交**：`submit`（新建时提供 `display_name`，可选 `description` 与 `note`）。把返回文本转述给用户，并提示「请联系管理员在管理台发布」。

## Manifest 字段（agx.agent/v1）

```json
{
  "schema": "agx.agent/v1",
  "model": "<providerId>/<modelName>",
  "system": "系统提示",
  "tools": [
    {"type": "agx_builtin", "default_policy": "always_allow",
     "configs": [{"name": "bash_exec", "policy": "always_ask"}]}
  ],
  "mcp_servers": [],
  "skills": [],
  "multiagent": null,
  "runtime": {"max_tool_rounds": 40, "max_session_tokens": null},
  "metadata": {"welcome_message": "", "suggested_questions": []}
}
```

- `model`：沿用基线版本的模型；新建时询问用户或保留企业常用模型名，格式必须是 `供应商/模型`。
- 内置工具只能从以下 14 个中选：`bash_exec`、`file_read`、`file_write`、`file_edit`、`list_files`、`code_outline`、`web_fetch`、`web_search`、`get_current_datetime`、`todo_write`、`scratchpad_read`、`scratchpad_write`、`liteparse`、`tool_result_recall`。未列出的工具会被拒绝。停用某个工具写 `{"name": "...", "enabled": false}`。
- 权限只有两档：`always_allow`（自动执行）与 `always_ask`（每次需要人工确认）。会写文件、执行命令、访问外网的工具建议 `always_ask`；无人值守的定时任务不要依赖 `always_ask`。
- `mcp_servers` 只写 `name`、`url`、`transport`（`http` 或 `sse`），**不能**写 `headers` 或 `env`。
- `skills` 只能引用企业技能库中已上架的技能（`{"source": "tenant", "id": "...", "version": null}`）；不确定时留空并提示用户联系管理员。
- `multiagent` 保持 `null`（多智能体协作由管理员配置）。

## 常见回复

- 未登录企业：请用户在「设置 → 企业」中登录。
- 提交返回 409「已被管理员回收」：说明该智能体已停用，建议新建。
- 「内容与最新版本相同」：说明没有产生新版本，无需再次提交。
