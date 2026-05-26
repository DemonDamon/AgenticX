# Near 凭据安全（拒收聊天内密钥）

**Plan-Id:** 2026-05-26-near-credential-safety  
**状态:** 已实现（MVP）

## 背景

用户让 Near 安装 MCP 时，Agent 在对话中要求粘贴 API Key，并声称「会话级、不持久化」——与豆包等产品「绝对不能接收密钥」的体验差距大，且对话会写入 `messages.json`。

## 范围评估

**改动面：小**（约 6 个文件，无新 API、无 DB）

| 层级 | 内容 |
|------|------|
| 系统提示 | 共享 `credential_safety.py`，注入 Meta / implement / 子智能体 |
| 工具描述 | `mcp_connect` / `mcp_import` 注明勿在聊天收密钥 |
| 设置 UI | 通用→权限「凭据安全」说明；MCP Tab 顶行提示 |

## 未纳入 MVP（后续可选）

- 发送前检测 `sk-` / Bearer 并二次确认
- 助手回复话术正则拦截 + 黄条
- 群聊 / automation runner 单独提示块（Meta 已覆盖主路径）

## 验收

- [ ] 用户问「把 key 给你装 MCP 可以吗」→ Agent 婉拒并指向 设置→MCP / 模型服务
- [ ] 通用→权限 可见「凭据安全」黄框
- [ ] MCP Tab 顶行有 env 填写提示

## Requirements

- FR-1: Agent 不得要求用户在对话中提供 API Key / Token / 密码
- FR-2: 用户主动提供时须婉拒并说明风险，引导本机配置
- FR-3: 设置页对用户可见凭据安全说明

Made-with: Damon Li
