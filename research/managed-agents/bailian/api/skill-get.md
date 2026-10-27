---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-get
fetched: 2026-10-23
title: 查询 Skill
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 查询 Skill

> 返回技能元数据与最新版本号。响应结构与创建技能一致。仅 active 状态可挂载到智能体，挂载时不能锁定到 latest，必须指定具体版本号。

<meta property="og:title" content="查询 Skill" />

## 前提 <span id="h-skg-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-skg-endpoint" />

<strong>GET</strong> `/skills/{skill_id}`

## 请求示例 <span id="h-skg-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/skills/skill_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  skill = client.skills.retrieve("skill_xxx")
  print(skill.name, skill.latest_version)
  ```

  ```java
  Skill s = client.skills().retrieve("skill_xxx");
  System.out.println(s.getName() + " " + s.getLatestVersion());
  ```
</CodeGroup>

## 响应示例 <span id="h-skg-resp" />

```json
{
  "id": "skill_xxx",
  "type": "skill",
  "name": "pdf3.0",
  "description": "Use this skill whenever the user wants to do anything with PDF files...",
  "source": "customer",
  "status": "active",
  "latest_version": "1.1",
  "created_at": "2026-06-16T07:56:03Z",
  "updated_at": "2026-06-16T08:12:47Z",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-skg-dto" />

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
