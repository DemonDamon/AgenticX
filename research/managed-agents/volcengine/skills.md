---
source: https://ark.volcengine.com/region:cn-beijing/docs/skills
fetched: 2026-10-24
title: Skills
---

# Skills

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

Skills 是可复用的能力包，用于给 Agent 补充领域知识、操作流程和最佳实践。与直接把大量规则写进 `system` 不同，Skills 更适合承载可复用、可维护的专业能力。

# 获取 Skills

方舟 Managed Agents 支持两类 Skills 来源：

- 预置 Skills：从 SkillHub 选择。
- 自定义 Skills：通过 `CreateSkill` 接口上传本地 Skills。

## 方式 1：从 SkillHub 选择预置 Skills

如果你使用的是平台预置 Skills，可以直接在 Agent 的 `skills` 配置中引用对应 Skill。预置 Skills 适合通用场景，例如文档处理、结构化内容生成或固定工作流编排。

由于预置 Skills 由平台统一维护，你不需要自己上传文件，也不需要关心版本包结构。选择完成后，把对应 Skill ID 写入 Agent 的 `skills` 数组即可。

如果你需要查询预置 Skill 的 ID，请前往 [SkillHub 页面](https://console.volcengine.com/skillhub) 查看。

## 方式 2：上传自定义 Skills

如果预置 Skills 无法覆盖你的场景，可以先通过 `CreateSkill` 接口上传本地 Skills，再在 Agent 中引用返回的 `skill_id`。

当前支持两种上传方式：

- 按文件上传：逐个上传同一个 Skill 目录中的文件，并保留目录结构。
- ZIP 上传：将一个完整 Skill 目录打包成 ZIP 文件后上传。

> **说明**
>
> 每次请求只能创建一个 Skill，且技能文件中必须包含且仅包含一个 `SKILL.md`。

### 上传限制与目录建议

按以下约束组织自定义 Skills：

- 每次请求上传的原始文件总大小不超过 **30 MiB**。
- 单个版本最多包含 **500** 个文件。
- ZIP 解压后单个文件不超过 **30 MiB**，全部文件总大小不超过 **120 MiB**。
- 所有文件必须位于同一个顶层目录，且该目录下必须直接包含且仅包含 **1 个** `SKILL.md`。

ZIP 包推荐使用统一顶层目录，`SKILL.md` 放在顶层目录的直接子级：

```text
basic_math.zip
└── basic_math/
    ├── SKILL.md
    └── meta.json
```

### 按文件上传

按文件上传适合在构建流程中逐个组织文件。重复传入 `files[]`，并在每个字段的 `filename=` 中填写文件上传后在 Skill 中的路径。

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/skills \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "display_title=Web Artifacts Builder" \
  -F "files[]=@./basic_math/SKILL.md;filename=basic_math/SKILL.md;type=text/markdown" \
  -F "files[]=@./basic_math/scripts/init.sh;filename=basic_math/scripts/init.sh;type=text/plain"
```

其中：

- `files[]` 是按文件上传使用的字段名。
- `@` 后面是本地真实路径。
- `filename=` 指定文件上传后在 Skill 中的路径，例如 `basic_math/SKILL.md`。
- 所有 `filename=` 必须使用同一个顶层目录，例如 `basic_math/`。
- `type=` 是 MIME 类型，可以省略。

### ZIP 上传

ZIP 方式更适合把整个 Skill 目录一次性打包上传：

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/skills \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "files=@./basic_math.zip;type=application/zip"
```

成功上传后，接口会返回 Skill 记录，重点关注 `id`、`latest_version`、`display_title` 和 `source`：

```json
{
  "id": "skill-20260926143025-a1b2c",
  "object": "skill",
  "created_at": 1790433025,
  "description": "Perform basic arithmetic operations.",
  "latest_version": "1",
  "display_title": "basic-math",
  "source": "custom",
  "updated_at": 1790433025,
  "name": "basic-math"
}
```

其中 `id` 就是后续挂载到 Agent 时要引用的 `skill_id`。

# 在 Agent 上引用 Skills

获取 Skills 后，你需要在 `CreateAgent` 或 `UpdateAgent` 的 `skills` 字段中引用 Skill。

- 预置 Skills：从 SkillHub 选择后，把对应 Skill ID 写入 `skills`。
- 自定义 Skills：先调用 `CreateSkill` 上传，拿到 `skill_id` 后再写入 `skills`。如果需要指定自定义 Skill 的版本，请显式传入 `version`，否则通常使用默认版本。

> **说明**
>
> 单个 Agent 最多可配置 50 个 Skills。

## `skills` 字段结构

在 `CreateAgent` 或 `UpdateAgent` 请求中，每个 Skill 条目都通过 `skills` 数组声明。关于字段结构的详细信息，请参见[创建智能体](api/create-agent-api.md)。

## 示例代码

示例如下：

```Bash
curl https://ark.cn-beijing.volces.com/api/v3/agents \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "数据处理 Agent",
    "model": {
      "id": "doubao-seed-2-1-pro-260628"
    },
    "skills": [
      { 
        "type": "skill_hub",
        "skill_id": "s-yepozmp9tsf2adf*****"
      },
      {
        "type": "custom",
        "skill_id": "skill-20260812080348-****",
        "version": "1"
      }
    ]
  }'
```

其中：

- `s-yepozmp9tsf2adf*****` 表示你从 [SkillHub 页面](https://console.volcengine.com/skillhub) 查到的预置 Skill ID。

- `skill-20260812080348-****` 表示 `CreateSkill` 返回的自定义 Skill ID。

# 使用建议

- 对稳定、通用的能力，优先选择 SkillHub 中的预置 Skills。

- 对团队私有流程、内部规范或自定义操作手册，使用自定义 Skills。
- 不要把一次性任务描述写进 Skill；Skill 负责定义能力，具体任务应通过 Session 事件传入。
- 上传前建议在本地先确认 `SKILL.md`、脚本和依赖文件路径关系，避免上传后引用失败。

# 相关文档

**[Agent](define-agent.md)**
Agent 是包含基本信息、System Prompt、扩展能力的配置模板。

**[MCP](mcp.md)**
MCP（Model Context Protocol）用于把第三方系统的工具与数据源接入 Agent。

**[Tools](tools.md)**
Tools 决定 Agent 在 Session 中能主动调用哪些执行能力。

**[工具权限策略](tool-permission-policy.md)**
工具权限策略用于控制 Agent 发起工具调用时，是自动执行，还是暂停等待确认。
