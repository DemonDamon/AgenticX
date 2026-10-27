---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-version-get
fetched: 2026-10-23
title: 查询 Skill 版本
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 查询 Skill 版本

> 返回指定版本的元数据与扫描状态。仅 active 可挂载。

<meta property="og:title" content="查询 Skill 版本" />

## 前提 <span id="h-skgv-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-skgv-endpoint" />

<strong>GET</strong> `/skills/{skill_id}/versions/{version}`

## 请求示例 <span id="h-skgv-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/skills/skill_xxx/versions/1.0" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  sv = client.skills.versions.retrieve("skill_xxx", "1.0")
  print(sv.version, sv.status)
  ```

  ```java
  SkillVersion v = client.skills().retrieveVersion("skill_xxx", "1.0");
  System.out.println(v.getVersion() + " " + v.getStatus());
  ```
</CodeGroup>

## 响应示例 <span id="h-skgv-resp" />

```json
{
  "id": "skillver_xxx",
  "skill_id": "skill_xxx",
  "type": "skill_version",
  "name": "pdf3.0",
  "description": "从 SKILL.md 解析的描述",
  "version": "1.0",
  "status": "active",
  "created_at": "2026-06-16T07:56:03+00:00",
  "updated_at": "2026-06-16T07:57:42+00:00"
}
```

### 响应字段 <span id="h-skgv-dto" />

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
