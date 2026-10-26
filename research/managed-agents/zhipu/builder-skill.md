---
source: https://docs.bigmodel.cn/cn/managed-agents/builder-skill
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Z Agent Builder Skill

想用自然语言创建云端 Agent，可以把 **Z Agent Builder** 安装到本地编码助手。它帮助你选择配置、调用 Managed Agents API、运行一个真实任务，并留下可复用的 Agent / Environment ID。

## 适用场景

| 你要做什么 | 可以怎样开口 |
| - | - |
| 从业务想法新建 Agent | “做一个每周整理销售表格的 Agent，产出 Excel 和简要结论。” |
| 修改已有 Agent | “给这个 Agent 增加网页检索，保留现有 MCP 和 Skills。” |
| 从其他平台迁移 | “读取我的 LangGraph 项目，把可迁的部分移到 Managed Agents，先说明差异。” |
| 排查或接入外部能力 | “检查这个 Session 为什么等待工具结果；接好 MCP 后跑一个小任务。” |

适合需要云端工具、文件、持续执行或定时运行的任务。短问答和单次模型调用通常直接使用模型 API 更简单。

## 下载并安装到本地 Agent

[下载 Z Agent Builder ZIP](https://cdn.bigmodel.cn/static/platform/files/z-agent/z-agent-builder.zip)

1. 解压 ZIP，保留完整的 `z-agent-builder/` 目录。
2. 将整个目录放入本地编码助手支持的 Skill 目录，确认里面有 SKILL.md、references/ 和 examples/。
3. 新开一个会话，发“使用 Z Agent Builder，先说说你能做什么”，确认助手已发现该 Skill。

不知道安装目录时，可以直接把下面这段话发给本地助手：

```text theme={null}
下载 https://cdn.bigmodel.cn/static/platform/files/z-agent/z-agent-builder.zip，
检查压缩包结构，把完整 z-agent-builder 目录安装到你支持的本地 Skill 目录。
已有安装时保留备份。安装后检查 SKILL.md 并告诉我版本号。
```

Claude Code 可使用项目的 `.claude/skills/z-agent-builder/` 或个人的 `~/.claude/skills/z-agent-builder/`。其他助手按各自 Skill 安装方式操作；普通 ZIP 附件不等于宿主已经加载 Skill。

> [!NOTE]
>
> Builder 安装在你的本地助手里，用于构建和调试云端 Agent。云端运行的业务 Skill（例如财务分析流程）则通过 Skills API 上传并挂载，见[Agent Skills](skills.md)。二者用途不同，不需要为了使用 Builder 把它上传到云端。

## 第一次使用

准备智谱开放平台 API Key，在本地通过环境变量或密钥管理配置；不要将密钥写进任务描述。然后给助手说明任务、输入、输出和触发方式：

```text theme={null}
使用 Z Agent Builder 创建周报 Agent。
输入：本地 sales.csv（需要作为文件挂载到云端）。
输出：/mnt/session/outputs/report.xlsx 和一段结论。
先手动跑一个小任务，确认产物后再添加每周一 9:00 的定时任务。
使用我已配置的 API Key；没有授权不要发外部消息。
```

助手会整理简短配置方案，创建或复用所需资源，并通过 Session 检查真实输入、工具结果和产物。Agent/Environment 创建成功仅代表配置保存，任务成功还要看实际结果。

## 能交付什么

* 可复用的 Agent / Environment / Session ID。
* 一次真实运行的回复、事件或产物链接，以及尚未接通的部分。
* Setup 与 Runtime 分开的调用示例：配置只建一次，后续用 ID 运行。
* 对更新或迁移的能力差异说明；凭据、渠道或本地登录不能自动搬到云端。

给已有 Agent 增加能力时，会保留未修改的数组项；更新只影响新版本引用。Multi Agent、Web 工具和定时触发按任务选用，不是创建普通 Agent 的前置条件。

## 更新与版本

版本读取包内 SKILL.md 的 metadata.version / released\_at；不要把本页日期当作已安装版本。可向本地助手发送：

```text theme={null}
查看 Z Agent Builder 的版本。
检查官方 ZIP 是否有更新，先告诉我变化。
将 Z Agent Builder 更新到最新版，保留安装备份。
```

普通构建不自动替换本地 Skill。更新失败时保留原安装，新开会话再加载新版本。下载包中的旧示例可能沿用旧 beta header；新字段和 API 以[当前协议文档](protocol-versions.md)为准。

## 下一步

> **[快速入门](quickstart.md)**
>
> 用 API 跑通一个任务

> **[Agent Skills](skills.md)**
>
> 挂载业务方法和模板

> **[最佳实践](examples.md)**
>
> 选择工具和任务配方

> **[协议版本](protocol-versions.md)**
>
> 核对接口和兼容性


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.