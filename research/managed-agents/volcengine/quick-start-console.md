---
source: https://ark.volcengine.com/region:cn-beijing/docs/quick-start-console
fetched: 2026-10-24
title: 快速入门（控制台）
---

# 快速入门（控制台）

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

方舟 Managed Agents 控制台提供可视化界面，让你无需编写 API 代码即可创建、配置并测试 Agent。你可以在控制台里交互式地打磨 Agent 配置，验证行为符合预期后，再拿到对应的 ID 接入到自己的业务代码中。

> 首次访问需登录 [火山方舟控制台](https://ark.volcengine.com/region:cn-beijing/managed-agents/agents?projectName=default)，进入 **Managed Agents** 模块。

<span id="prerequisites"></span>
# 准备工作

<span id="get_api_key"></span>
## 1. 获取 API Key

访问 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey)，单击 **创建 API Key**，作为后续接入业务代码的访问密钥。

<span id="enable_managed_agent"></span>
## 2. 开通 Managed Agents 服务

访问 [开通管理页面](https://ark.volcengine.com/region:cn-beijing/openManagement)，切换到 **Managed Agents** 页签开通服务。

<span id="enable_model_service"></span>
## 3. 开通模型服务

访问 [开通管理页面](https://ark.volcengine.com/region:cn-beijing/openManagement) 开通模型服务。

创建 Seedance Managed Agent 前，根据控制台提示开通 Seedance Managed Agent 使用权限及所需的模型和工具服务。

<span id="build_agent"></span>
# 构建 Agent

<span id="create_agent"></span>
## 1. 创建 Agent
Agent 是可版本化、可复用的智能体配置资产，定义角色、能力、行为边界和运行规则，是所有任务运行的模板和基准。

访问 [火山方舟控制台](https://ark.volcengine.com/region:cn-beijing/managed-agents/agents?projectName=default)，进入 **Managed Agents** 模块。在 **Agents** 页面单击 **创建 Agent**，跟随界面引导填写：

- **Agent 版本**：根据任务类型选择通用 Agent 或 Seedance Managed Agent。
- **模型和系统提示词**：选择一个 **模型**，并编写 **系统提示词**，为 Agent 设定角色、做事风格与工作原则。
- **Skills**：从 **火山 SkillHub** 中挂载预置 **Skill**，或本地上传自定义 **Skill**，扩展 Agent 的领域能力。
- **Tools**：勾选内置的 **Agent Toolset**（如 `bash`、`edit`、`read`、`write` 等基础工具），让 Agent 能够读写文件、执行命令。
- **MCPs**：以 URL 形式接入远程 **MCP Server**，把外部系统能力接入 Agent。
- **Multi Agents**：将多个 Agent 组合成协同工作流，一个 Agent 可以调用另一个 Agent 完成子任务。

保存后，控制台会为该 Agent 生成一个稳定的 `agent_id`。每次修改配置都会自动生成新版本，支持版本对比、回滚和灰度发布。

<span id="create_environment"></span>
## 2. 创建 Environment
定义 Agent 的运行环境模板，预置依赖、环境变量和产物存储等。创建 Session 时绑定 Environment，确保代码在一致环境中执行。

在 [Environments 页面](https://ark.volcengine.com/region:cn-beijing/managed-agents/environments?projectName=default) 单击 **创建 Environment**，跟随界面引导填写：

- **类型**：当前仅支持 **云托管**——沙箱由方舟按需拉起、自动休眠。
- **预装包**：按需添加 `pip`、`apt` 依赖（如 `numpy`、`pandas`），沙箱首次启动时安装。
- **环境变量**：以键值对形式注入到沙箱进程，沙箱启动时自动加载，供 Agent 执行的代码和命令直接读取。常用于配置业务侧的非敏感参数，例如设置时区 `TZ=Asia/Shanghai`。
- **产物存储**：可选。需要长期保留 Agent 写入 `/mnt/session/outputs/` 的最终产物时，选择已授权的自有 TOS 目录；不选择时使用方舟公共 TOS，你需要在平台 TTL 到期前下载所需文件。

保存后得到一个稳定的 `environment_id`。

> **说明**
>
> 你的 TOS Bucket 必须与 Managed Agents 服务部署在同一地域。首次选择 TOS 目录时，如果控制台提示未授权，先按页面引导完成项目授权。

<span id="debug_agent"></span>
# 调试 Agent

在控制台里以交互方式测试 Agent。每次调试创建一个 Session，展示事件流、工具调用、输入输出完整记录，可随时回放。

Session 是一次独立的 Agent 任务运行会话，包含从发起、执行到结束的完整生命周期：
1. 在 [Sessions 页面](https://ark.volcengine.com/region:cn-beijing/managed-agents/sessions?projectName=default) 单击 **创建 Session**，选择要绑定的 **Agent** 和 **Environment**。Session 默认继承该 Environment 的产物存储配置。

2. 在 **Session 详情** 页面调试会话：
   - **发起**：在 **会话面板** 输入自然语言指令，或上传附件（表格、文档、代码、图片等）作为任务输入。
   - **观察**：**事件时间轴（Trace）** 实时呈现 Agent 的思考过程、工具调用、代码执行、错误重试等全链路节点。
   - **验证**：Session 结束后可查看 **最终交付产物**、**总耗时**、**Token 消耗**、**工具调用次数** 等运行统计，判断 Agent 行为是否符合预期。

反复调整 **系统提示词**、**Tools**、**Skills**，直到 Session 试跑结果符合预期。

<span id="prototype_to_code"></span>
# 从原型到代码

Agent 配置验证通过后，把它接入到业务代码中只需两步。

<span id="copy_ids_from_console"></span>
## 1. 从控制台复制 ID

- 从 **Agent 详情页** 复制 `agent_id`。
- 从 **Environment 详情页** 复制 `environment_id`。
- 前往 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 单击 **创建 API Key**，作为访问密钥。

<span id="create_session_in_code"></span>
## 2. 在代码中引用它们创建 Session

将 `agent_id`、`environment_id` 和 API Key 填入下面的请求，创建一个绑定该 Agent 与环境的 Session：

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/sessions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent-xxxxxxxxxxxxxx-xxxxx",
    "environment_id": "env-xxxxxxxxxxxxxx-xxxxx",
    "title": "My first session"
  }'
```
拿到返回的 `session_id` 后，即可通过 Events API 向 Session 发送消息，并通过 SSE 流式接收 Agent 的响应事件。详情请参见 [Session 事件流](session-event-stream.md)。
