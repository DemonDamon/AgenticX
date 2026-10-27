---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/skill-version-download
fetched: 2026-10-23
title: 下载 Skill 包
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 下载 Skill 包

> 返回 OSS 预签名 URL（file_url），有效期 2 小时，可直接 GET 该 URL 拿到 zip 包内容。

<meta property="og:title" content="下载 Skill 包" />

## 前提 <span id="h-skdl-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-skdl-endpoint" />

<strong>GET</strong> `/skills/{skill_id}/versions/{version}/content`

## 请求示例 <span id="h-skdl-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/skills/skill_xxx/versions/1.0/content" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  content = client.skills.versions.download("skill_xxx", "1.0")
  print(content["file_url"])
  ```

  ```java
  JsonObject content = client.skills().downloadVersion("skill_xxx", "1.0");
  System.out.println(content.get("file_url").getAsString());
  ```
</CodeGroup>

## 响应示例 <span id="h-skdl-resp" />

```json
{
  "skill_id": "skill_xxx",
  "version": "1.0",
  "file_url": "https://<oss-bucket>.oss-cn-xxx.aliyuncs.com/...?Expires=...&Signature=YOUR_SIGNATURE",
  "request_id": "xxx"
}
```

### 响应字段

| 字段           | 类型     | 说明                     |
| ------------ | ------ | ---------------------- |
| `skill_id`   | string | 所属技能 ID                |
| `version`    | string | 版本号                    |
| `file_url`   | string | OSS 预签名下载 URL，有效期 2 小时 |
| `request_id` | string | 本次请求的唯一标识              |
