---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-version-list
fetched: 2026-10-23
title: 列出 Skill 版本
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Skill 版本

> 按版本号倒序返回技能的全部版本。status=rejected 的版本会附带 additional_properties.error_info，按文件路径列出安全审查问题。仅 active 可挂载。

<meta property="og:title" content="列出 Skill 版本" />

## 前提 <span id="h-sklv-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-sklv-endpoint" />

<strong>GET</strong> `/skills/{skill_id}/versions`

按版本号倒序返回。每项含 `version`、`status`、`created_at`。

## Query 参数 <span id="h-sklv-q" />

| 参数      | 类型     | 默认 | 说明                         |
| ------- | ------ | -- | -------------------------- |
| `limit` | int    | 20 | 每页数量，最大 100                |
| `page`  | string | —  | 首次不传，后续传上一次响应的 `next_page` |

## 请求示例 <span id="h-sklv-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/skills/skill_xxx/versions?limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  for sv in client.skills.versions.list("skill_xxx", limit=20):
      print(sv.version, sv.created_at)
  ```

  ```java
  CursorPage<SkillVersion> versions = client.skills().listVersions(
      "skill_xxx", SkillListParam.builder().limit(20).build());
  for (SkillVersion sv : versions.getData()) System.out.println(sv.getVersion() + " " + sv.getCreatedAt());
  ```
</CodeGroup>

## 响应示例 <span id="h-sklv-resp" />

```json
{
  "data": [
    {
      "id": "skillver_xxx",
      "skill_id": "skill_xxx",
      "type": "skill_version",
      "name": "pdf3.0",
      "description": "从 SKILL.md 解析的描述",
      "version": "1.1",
      "status": "active",
      "created_at": "2026-06-16T08:12:47+00:00",
      "updated_at": "2026-06-16T08:14:30+00:00"
    },
    {
      "id": "skillver_xxx",
      "skill_id": "skill_xxx",
      "type": "skill_version",
      "name": "pdf3.0",
      "description": "从 SKILL.md 解析的描述",
      "version": "1.0",
      "status": "rejected",
      "created_at": "2026-06-16T07:56:03+00:00",
      "updated_at": "2026-06-16T07:57:42+00:00",
      "additional_properties": {
        "error_info": {
          "/index.js": "[Dangerous Tools Without Confirmation] Line 179: ...",
          "/SKILL.md": "[Dangerous Tools Without Confirmation] Line 10: ..."
        }
      }
    }
  ],
  "next_page": "xxx",
  "request_id": "xxx"
}
```

响应包含 `data`（Skill Version 对象数组）与 `next_page`。Skill Version 对象字段如下：

### Skill Version 对象字段 <span id="h-sklv-dto" />

| 字段                          | 类型     | 说明                                                           |
| --------------------------- | ------ | ------------------------------------------------------------ |
| `id`                        | string | 版本 ID，格式 `skillver_xxx`                                      |
| `skill_id`                  | string | 所属技能 ID                                                      |
| `type`                      | string | 固定为 `skill_version`                                          |
| `name` / `description`      | string | 从该版本 zip 包内 `SKILL.md` 解析得到                                  |
| `version`                   | string | 版本号，由服务端生成                                                   |
| `status`                    | string | 扫描状态：`checking` / `active` / `rejected`，仅 `active` 可挂载       |
| `created_at` / `updated_at` | string | 创建 / 最近更新时间，ISO 8601                                         |
| `additional_properties`     | object | 仅 `status=rejected` 时返回，含 `error_info`：按 zip 包内文件路径列出的安全审查问题 |
