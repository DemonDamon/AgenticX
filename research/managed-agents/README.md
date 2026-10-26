# Managed Agents 调研资料

按厂商归档的官方文档快照。抓取日期：2026-10-23（火山方舟为 2026-10-24）。

正文来自文档站的 Markdown 源：智谱、阿里云百炼与火山方舟文档页的 Copy page（URL 加 `.md`），WorkBuddy Enterprise 文档的 `.md`。页面里的配图下载到各厂商目录的 `assets/`，Markdown 用相对路径引用。每篇开头的 `source` 是原页面地址。百炼这批文档正文没有配图，因此没有 `assets/`。

## 智谱（`zhipu/`）

来源：[Managed Agents 概述](https://docs.bigmodel.cn/cn/managed-agents/overview) 及其侧边栏下的全部指南页，以及这些指南指向的 OpenAPI 页。

指南（29 篇，与文档导航顺序一致）：

- [概述](zhipu/overview.md)
- [快速入门（API）](zhipu/quickstart.md)
- [快速入门（控制台）](zhipu/console-quickstart.md)
- [Z Agent Builder Skill](zhipu/builder-skill.md)
- [最佳实践](zhipu/examples.md)
- [定义 Agent](zhipu/agent-setup.md)
- [工具](zhipu/tools.md)
- [连接 MCP](zhipu/mcp.md)
- [工具权限](zhipu/permission-policies.md)
- [Agent Skills](zhipu/skills.md)
- [Multi Agent](zhipu/multiagent.md)
- [配置运行环境](zhipu/cloud-environment.md)
- [预装沙箱环境](zhipu/sandbox-reference.md)
- [创建会话](zhipu/create-session.md)
- [管理会话](zhipu/session-operations.md)
- [在控制台查看与调试会话](zhipu/session-debugging.md)
- [会话线程](zhipu/threads.md)
- [事件与流式输出](zhipu/events.md)
- [凭据管理](zhipu/vaults.md)
- [文件](zhipu/files.md)
- [记忆](zhipu/memory-stores.md)
- [访问 GitHub 仓库](zhipu/github-repository.md)
- [评测与自迭代](zhipu/evaluation.md)
- [定时任务](zhipu/deployments.md)
- [Webhook 通知](zhipu/webhooks.md)
- [接入聊天渠道](zhipu/channels.md)
- [API 参考](zhipu/api-reference.md)
- [协议版本与兼容](zhipu/protocol-versions.md)
- [常见问题](zhipu/faq.md)

OpenAPI 在 `zhipu/api-reference/`，按资源分子目录：`agent`、`environment`、`session`、`session/threads`、`file`、`memory`、`vault`、`skill`、`deployment`、`channel`。指南页之间、以及指南和接口页之间的站内链接已改成相对路径。

## WorkBuddy（`workbuddy/`）

来源：WorkBuddy Enterprise 文档里的 **WorkBuddy Managed Agents** 一节。入口：[产品介绍](https://www.workbuddy.cn/docs/enterprise/216050766183768064)。

- [产品介绍](workbuddy/产品介绍.md)
- [快速开始](workbuddy/快速开始.md)
- [使用说明](workbuddy/使用说明.md)
- [Agent Manifest 字段说明](workbuddy/Agent-Manifest-字段说明.md)

[WorkBuddy Managed Agents](workbuddy/WorkBuddy-Managed-Agents.md) 和 [开发指南](workbuddy/开发指南.md) 在上游是目录节点，没有正文，本地文件只保留本节目录。

## 阿里云百炼（`bailian/`）

来源：[Managed Agent 文档](https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents) 整节，以及 [Managed Agent API](https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-api)。你给的入口是 CLI 命令速查：[Managed Agent CLI](https://docs.bailian.console.aliyun.com/zh/model-studio/cli/managed-agent)，保存在 [cli/managed-agent.md](bailian/cli/managed-agent.md)。

指南（与文档导航顺序一致）：

- [Managed Agent](bailian/managed-agents.md)
- [开始使用](bailian/managed-agents-start-using.md)
- [概述](bailian/managed-agents-introduction.md)
- [快速开始](bailian/managed-agents-quick-start.md)
- [使用 CLI](bailian/managed-agents-cli.md)
- [构建 Agent](bailian/managed-agents-agent.md)
- [定义 Agent](bailian/managed-agents-agent-definition.md)
- [Agent 工具配置](bailian/managed-agents-builtin-tools.md)
- [Agent MCP](bailian/managed-agents-mcp.md)
- [Agent Skills](bailian/managed-agents-skill.md)
- [多智能体协作](bailian/managed-agents-multiagent.md)
- [配置 Agent 环境](bailian/managed-agents-environment.md)
- [云端托管环境](bailian/managed-agents-cloud-hosting.md)
- [委派任务给 Agent](bailian/managed-agents-session.md)
- [发起会话](bailian/managed-agents-session-event.md)
- [管理会话](bailian/managed-agents-session-operations.md)
- [会话事件流（SSE）](bailian/managed-agents-event-stream.md)
- [密钥库认证](bailian/managed-agents-credential.md)
- [定时任务](bailian/managed-agents-deployment.md)
- [Webhook 通知](bailian/managed-agents-webhook.md)
- [Agent 上下文管理](bailian/managed-agents-context.md)
- [文件上传与挂载](bailian/managed-agents-file.md)
- [记忆库](bailian/managed-agents-memory-store.md)
- [计费说明](bailian/managed-agents-billing.md)
- [最佳实践](bailian/managed-agents-best-practices.md)
- [入门：搭一个数据分析 Agent](bailian/managed-agents-data-analysis.md)
- [进阶：生产化定时晨报机器人](bailian/managed-agents-production.md)
- [进阶：提示词版本管理与回滚](bailian/managed-agents-prompt-versioning.md)
- [进阶：多智能体定制复杂提案](bailian/managed-agents-multiagent-proposal.md)
- [进阶：联网研究与模型成本分层](bailian/managed-agents-cost-tiering.md)
- [进阶：Webhook 事件通知](bailian/managed-agents-webhook-notifications.md)
- [进阶：自定义 MCP 与 Skills](bailian/managed-agents-custom-mcp-skills.md)
- [进阶：密钥库安全注入与出网网关](bailian/managed-agents-credential-security.md)
- [进阶：跨会话工作记忆交接](bailian/managed-agents-memory-handoff.md)
- [进阶：多模态输入与图片问答](bailian/managed-agents-multimodal-image.md)
- [进阶：构建对话客户端](bailian/managed-agents-client-streaming.md)
- [更新日志](bailian/managed-agents-changelog.md)

OpenAPI 99 篇在 `bailian/api/`，覆盖 Agent、Environment、Session、Event、File、Memory、Skill、Vault、Credential、Deployment、Webhook。指南和接口页之间的站内链接已改成相对路径。

## 火山方舟（`volcengine/`）

来源：从 [概述](https://ark.volcengine.com/region:cn-beijing/docs/overview) 起，沿页面底部「下一篇」直到知识库之前。另收了同产品的 API、教程和 CLI 命令参考。配图在 `volcengine/assets/`。

指南（下一篇顺序）：

- [概述](volcengine/overview.md)
- [快速入门（代码）](volcengine/quick-start-code.md)
- [快速入门（控制台）](volcengine/quick-start-console.md)
- [Agent](volcengine/define-agent.md)
- [Skills](volcengine/skills.md)
- [MCP](volcengine/mcp.md)
- [Tools](volcengine/tools.md)
- [工具权限策略](volcengine/tool-permission-policy.md)
- [模型支持的参数列表](volcengine/model-parameter-support.md)
- [配置云环境](volcengine/configure-cloud-environment.md)
- [云沙箱参考](volcengine/cloud-sandbox-reference.md)
- [自托管环境概述](volcengine/self-hosted-environment-overview.md)
- [配置并运行自托管环境](volcengine/configure-self-hosted-environment.md)
- [自托管环境安全说明](volcengine/self-hosted-environment-security.md)
- [启动 Session](volcengine/start-session.md)
- [管理 Session](volcengine/manage-session.md)
- [Session 事件流](volcengine/session-event-stream.md)
- [使用 Vaults 认证](volcengine/use-vaults-authentication.md)
- [运行和管理后台工具任务](volcengine/background-tool-tasks.md)
- [上传与挂载文件](volcengine/upload-and-mount-files.md)
- [持久化记忆](volcengine/persistent-memory.md)
- [使用 Dream 整理长期记忆](volcengine/dream-overview.md)
- [编排 Multi Agent](volcengine/multi-agent.md)
- [将零代码应用迁移至 Managed Agents](volcengine/migrate-from-bot-api.md)

教程：

- [\[基础\] 构建连续对话的工单分诊助手](volcengine/tutorials/build-triage-agent-with-continuous-session.md)
- [\[基础\] 工单分诊 Agent 系统提示词版本管理](volcengine/tutorials/agent-system-prompt-versioning.md)
- [\[基础\] Custom Tool 使用教程](volcengine/tutorials/managed-agent-custom-tool-tutorial.md)
- [\[基础\] 使用 Viking 知识库检索构建知识问答 Agent](volcengine/tutorials/build-knowledge-base-agent-with-viking-search.md)
- [\[基础\] 在豆包工作中使用 Managed Agents](volcengine/tutorials/use-managed-agents-in-doubao-work.md)
- [\[基础\] 使用 Seedance Managed Agent 生成图片和视频](volcengine/tutorials/visual-creation-agent.md)
- [\[进阶\] 构建可持续迭代的 AI 研究交付工作台](volcengine/tutorials/build-research-workbench.md)
- [\[进阶\] 构建从 CSV 到交互式报告的数据分析 Agent](volcengine/tutorials/build-csv-data-analyst-agent.md)
- [\[进阶\] 使用 Vaults 让开发 Agent 以用户身份提交 GitHub PR](volcengine/tutorials/build-github-agent-with-vaults.md)
- [\[进阶\] 使用 Memory Store 构建有记忆的购物助手](volcengine/tutorials/build-shopping-assistant-with-memory.md)
- [\[进阶\] 用多智能体团队生成定制销售提案](volcengine/tutorials/build-multi-agent-proposal-team.md)
- [\[进阶\] 使用 arkcli 构建集成 Vault 与 Memory 的投研 Agent](volcengine/tutorials/build-investment-research-agent-with-arkcli.md)

OpenAPI 75 篇在 `volcengine/api/`，从创建智能体到技能、记忆库、保管库、会话事件。CLI 命令参考在 [cli/managed-agents.md](volcengine/cli/managed-agents.md)。指南、教程和接口页之间的站内链接已改成相对路径。
