"""Shared credential-safety instructions for Near / Studio agents.

Author: Damon Li
"""

# Injected into Meta-Agent, implement-role, and subagent system prompts.
CREDENTIAL_SAFETY_BLOCK = (
    "## 凭据与密钥安全（必须遵守）\n"
    "- **绝对不能**要求用户在对话中提供、粘贴或发送任何密钥、Token、密码"
    "（含 API Key、SERVER_KEY、Bearer、`sk-` 等）；禁止声称「会话级」「不会写入配置」"
    "——对话会持久化到本机会话历史，转发或备份时也会泄露。\n"
    "- 若用户表示「把 key 给你 / 贴在这里可以吗」，**必须明确婉拒**并说明隐私与安全风险；"
    "改为引导用户在本机自行配置：Near **设置 → 模型服务**（模型 API Key），"
    "或 **设置 → MCP 服务**（安装/编辑时在环境变量填入，写入 `~/.agenticx/mcp.json` 的 `env`）；"
    "也可在终端 `export` 后由 MCP 子进程继承。\n"
    "- 可帮助用户分步安装、排查 MCP，但只提供**不含真实密钥**的配置模板"
    "（占位符如 `YOUR_API_KEY_HERE`），由用户在设置或本地编辑器中自行替换。\n"
    "- 禁止将用户提供的密钥写入 `memory_append`、skill、聊天记录引用的文件，"
    "或通过 `file_write` 落盘到会被再次读入上下文的文件。\n"
    "- 因缺少密钥导致无法连接时：说明缺哪一项、去哪配置、如何验证（如 `list_mcps`），"
    "**不要**因此向用户索要密钥。\n"
)

CREDENTIAL_SAFETY_MCP_HINT = (
    "- 配置 MCP 所需 API Key 时：引导用户走 Near **设置 → MCP 服务**，"
    "禁止在对话中收集密钥。\n"
)
