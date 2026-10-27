---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-skill
fetched: 2026-10-23
title: Agent Skills
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent Skills

> 技能是打包后的能力集合，封装常见任务的端到端流程。在控制台 Skill 管理页面管理，可被多个智能体复用。

<meta property="og:title" content="Agent Skills" />

技能以 zip 包形式上传，zip 根目录须包含 `SKILL.md`。

## SKILL.md 编写规范 <span id="skillmd-spec" />

`SKILL.md` 由 YAML front matter 和 Markdown 正文两部分组成。front matter 用 `---` 包裹，声明技能名称与描述，智能体据此判断何时调用；正文写执行指令，技能触发后才加载。

```markdown
---
name: my-custom-skill
description: "技能的功能描述，包含触发条件、适用场景和不适用场景。"
---

在此编写技能的执行指令。
```

<Note>
  front matter 缺失、未用 `---` 包裹或 YAML 语法错误，审查会不通过。
</Note>

**字段说明**

| 字段          | 必填 | 说明                                                                   |
| ----------- | -- | -------------------------------------------------------------------- |
| name        | 是  | 技能的唯一标识名称。仅限小写字母、数字和连字符，不超过 64 字符，如 `data-cleaner`、`invoice-parser`。 |
| description | 是  | 描述技能的触发条件和处理能力，直接影响调用准确率。不超过 1024 字符，不能包含尖括号。                        |

**description 编写建议**

description 的质量决定了智能体调用技能的准确性，建议包含以下信息：

1. **适用的输入类型**：技能处理的文件格式或数据类型。
2. **支持的操作**：技能可以执行的具体操作。
3. **触发关键词**：对话中可能出现的、应触发该技能的关键词或表达方式。
4. **不适用的场景**：不应触发该技能的场景，避免误调用。

## 上传自定义技能 <span id="8b15eefa8d1u5" />

1. 点击**自定义 Skill**。
2. 选择本地 zip 包（不超过 10 MB），提交后系统自动审查内容，进入 `checking` 状态。审查通过变为 `active`，可挂载到智能体；审查未通过变为 `rejected`，不能挂载。

通过 API 上传时，需先调用文件上传接口获得 `file_id`，再传入创建接口。完整参数与响应字段详见[创建 Skill API](api/skill-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/skills" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"file_id": "file_xxx"}'
  ```

  ```python
  skill = client.skills.create(file_id="file_xxx")
  print(skill.id)
  ```

  ```java
  Skill skill = client.skills().create(SkillCreateParam.builder()
      .fileId("file_xxx").build());
  System.out.println(skill.getId());
  ```
</CodeGroup>

## 版本管理 <span id="3d0613b3c8lcg" />

在技能详情页可上传新版本。挂载到智能体时必须指定具体版本号，后续上传新版本不影响已挂载的智能体。

通过 API 上传新版本时，同样需要先获得 `file_id`。版本号由服务端自动生成。完整参数与响应字段详见[上传 Skill 新版本](api/skill-version-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/skills/skill_xxx/versions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"file_id": "file_xxx"}'
  ```

  ```python
  sv = client.skills.versions.create("skill_xxx", file_id="file_xxx")
  print(sv.version)
  ```

  ```java
  SkillVersion sv = client.skills().createVersion("skill_xxx",
      SkillCreateParam.builder().fileId("file_xxx").build());
  System.out.println(sv.getVersion());
  ```
</CodeGroup>

## 挂载到智能体 <span id="09adca7f42uo2" />

在智能体编辑页的**技能**区点击**添加技能**，从下拉选择技能并指定版本。通过 API 创建或更新智能体时，在 `skills` 字段中指定技能 ID 与版本，详见[创建 Agent API](api/agent-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "my-agent",
      "model": {"id": "qwen3.8-max"},
      "skills": [
        {"type": "customer", "skill_id": "skill_xxx", "version": "1.0"}
      ]
    }'
  ```

  ```python
  agent = client.agents.create(
      name="my-agent",
      model="qwen3.8-max",
      skills=[
          {"type": "customer", "skill_id": "skill_xxx", "version": "1.0"},
      ],
  )
  print(agent.id)
  ```

  ```java
  Agent agent = client.agents().create(AgentCreateParam.builder()
      .name("my-agent")
      .model("qwen3.8-max")
      .skills(List.of(SkillConfig.builder()
          .type("customer")
          .skillId("skill_xxx")
          .version("1.0")
          .build()))
      .build());
  System.out.println(agent.getId());
  ```
</CodeGroup>

## 删除 <span id="h-skill-delete" />

技能只支持删除，不支持归档。在技能详情页点击**删除**，技能将被硬删除，不可恢复。已挂载到智能体的技能引用将失效。

通过 API 删除技能，不可恢复。完整参数与响应字段详见[删除 Skill](api/skill-delete.md)。

<CodeGroup>
  ```bash
  curl -X DELETE "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/skills/skill_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.skills.delete("skill_xxx")
  ```

  ```java
  client.skills().delete("skill_xxx");
  ```
</CodeGroup>

## 下一步

- [定义 Agent](managed-agents-agent-definition.md)：在智能体上挂载技能。
- [发起会话](managed-agents-session-event.md)：观察智能体如何调用技能。
