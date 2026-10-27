---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-create
fetched: 2026-10-23
title: 创建 Skill
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Skill

> 从已上传的 zip 包创建技能。请求体仅含 file_id，name 与 description 由服务端从 zip 包内的 SKILL.md 解析得到。新建技能进入 checking，扫描通过后变为 active，仅 active 可挂载到智能体；命中安全风险变为 rejected。

<meta property="og:title" content="创建 Skill" />

## 前提 <span id="h-skc-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。创建技能前需先用[File](files-api.md)上传 zip 包获得 `file_id`。zip 包根目录须包含 `SKILL.md`，声明技能名称与描述。

## 接口 <span id="h-skc-endpoint" />

<strong>POST</strong> `/skills`

请求体仅含 `file_id`，对应文件须为 `.zip` 且通过审核。`name` 与 `description` 由服务端从 zip 包内的 `SKILL.md` 解析得到。

## 请求示例 <span id="h-skc-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/skills" \
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

## 响应示例 <span id="h-skc-resp" />

```json
{
  "id": "skill_xxx",
  "type": "skill",
  "name": "pdf3.0",
  "description": "Use this skill whenever the user wants to do anything with PDF files...",
  "source": "customer",
  "status": "checking",
  "latest_version": "1.0",
  "created_at": "2026-06-16T07:56:03Z",
  "updated_at": "2026-06-16T07:56:03Z",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-skc-dto" />

| 字段                          | 类型     | 说明                                                                 |
| --------------------------- | ------ | ------------------------------------------------------------------ |
| `id`                        | string | 技能 ID，格式 `skill_xxx`                                               |
| `type`                      | string | 固定为 `skill`                                                        |
| `name` / `description`      | string | 从 zip 包内 `SKILL.md` 解析得到                                           |
| `source`                    | string | 来源：`customer`（自建） / `official`（阿里云百炼官方）                            |
| `status`                    | string | 扫描状态：`checking` / `active` / `rejected` / `deleted`，仅 `active` 可挂载 |
| `latest_version`            | string | 最新版本号，挂载到智能体时不能锁定到 `latest`，必须指定具体版本号                              |
| `created_at` / `updated_at` | string | 创建 / 最近更新时间，ISO 8601                                               |
| `request_id`                | string | 本次请求的唯一标识                                                          |

## 扫描状态 <span id="h-skc-status" />

新建技能或上传新版本进入 `checking` 状态，扫描通过后变为 `active` 才可挂载到智能体；命中安全风险变为 `rejected`，不能挂载，可根据版本信息获取具体错误原因。删除后状态为 `deleted`。
