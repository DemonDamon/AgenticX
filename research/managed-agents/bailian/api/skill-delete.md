---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-delete
fetched: 2026-10-23
title: 删除 Skill
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Skill

> 删除技能及全部版本，不可再挂载到新智能体。已挂载旧版本的智能体仍可正常使用，会话历史不受影响。

<meta property="og:title" content="删除 Skill" />

## 前提 <span id="h-skd-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-skd-endpoint" />

<strong>DELETE</strong> `/skills/{skill_id}`

## 请求示例 <span id="h-skd-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/skills/skill_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.skills.delete("skill_xxx")
  ```

  ```java
  client.skills().delete("skill_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-skd-resp" />

```json
{
  "id": "skill_xxx",
  "type": "skill_deleted",
  "request_id": "xxx"
}
```

### 响应字段

| 字段           | 类型     | 说明                  |
| ------------ | ------ | ------------------- |
| `id`         | string | 被删除的技能 ID           |
| `type`       | string | 固定为 `skill_deleted` |
| `request_id` | string | 本次请求的唯一标识           |
