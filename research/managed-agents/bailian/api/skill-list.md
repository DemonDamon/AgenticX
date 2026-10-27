---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-list
fetched: 2026-10-23
title: 列出 Skill
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Skill

> cursor 分页列出技能，按 created_at 倒序。支持按来源过滤（自建或阿里云百炼官方）。仅 active 状态可挂载到智能体。

<meta property="og:title" content="列出 Skill" />

## 前提 <span id="h-skl-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-skl-endpoint" />

<strong>GET</strong> `/skills`

## Query 参数 <span id="h-skl-q" />

| 参数       | 类型     | 默认         | 说明                                       |
| -------- | ------ | ---------- | ---------------------------------------- |
| `limit`  | int    | 20         | 每页数量，最大 100                              |
| `page`   | string | —          | 首次不传，后续传上一次响应的 `next_page`               |
| `source` | string | `customer` | 来源筛选：`customer`（自建）或 `official`（阿里云百炼官方） |

## 请求示例 <span id="h-skl-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/skills?source=customer&limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  for skill in client.skills.list(source="customer", limit=20):
      print(skill.id, skill.name)
  ```

  ```java
  CursorPage<Skill> page = client.skills().list(SkillListParam.builder()
      .source("customer").limit(20).build());
  for (Skill s : page.getData()) System.out.println(s.getId() + " " + s.getName());
  ```
</CodeGroup>

## 响应示例 <span id="h-skl-resp" />

```json
{
  "data": [
    {
      "id": "skill_xxx",
      "type": "skill",
      "name": "pdf3.0",
      "description": "Use this skill whenever the user wants to do anything with PDF files...",
      "source": "customer",
      "status": "active",
      "latest_version": "1.1",
      "created_at": "2026-06-16T07:56:03+00:00",
      "updated_at": "2026-06-16T08:12:47+00:00"
    }
  ],
  "next_page": "skill_xxx",
  "request_id": "xxx"
}
```

响应包含 `data`（Skill 对象数组）与 `next_page`。Skill 对象字段如下：

### Skill 对象字段 <span id="h-skl-dto" />

| 字段                          | 类型     | 说明                                                                 |
| --------------------------- | ------ | ------------------------------------------------------------------ |
| `id`                        | string | 技能 ID，格式 `skill_xxx`                                               |
| `type`                      | string | 固定为 `skill`                                                        |
| `name` / `description`      | string | 从 zip 包内 `SKILL.md` 解析得到                                           |
| `source`                    | string | 来源：`customer`（自建） / `official`（阿里云百炼官方）                            |
| `status`                    | string | 扫描状态：`checking` / `active` / `rejected` / `deleted`，仅 `active` 可挂载 |
| `latest_version`            | string | 最新版本号，挂载到智能体时不能锁定到 `latest`，必须指定具体版本号                              |
| `created_at` / `updated_at` | string | 创建 / 最近更新时间，ISO 8601                                               |
