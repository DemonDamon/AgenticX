---
source: https://ark.volcengine.com/region:cn-beijing/docs/update-skill-api
fetched: 2026-10-24
title: 设置技能内容保护
---

# 设置技能内容保护

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}`

设置是否对自定义技能开启内容保护。启用内容保护后，运行技能时，方舟平台会注入保护指令，降低技能内容被直接输出的风险。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定要更新的技能。

### Body 参数

**protection_enabled** `boolean` | 内容保护开关

用于更新技能的内容保护设置。

* 省略或传 `null`：不改变内容保护开关，`updated_at` 不变。
* 传入当前值：不改变内容保护开关，`updated_at` 不变。
* 传入不同的 `true` 或 `false`：更新内容保护设置和 `updated_at`。

## 响应参数

**created_at** `integer` | 创建时间

技能创建时间，为 Unix 时间戳，单位为秒。

**display_title** `string` | 展示名称

技能的展示名称。未配置时，服务端返回 `SKILL.md` 中的 `name`。

**id** `string` | 技能 ID

用于唯一标识已更新的技能，值以 `skill-` 开头。

**latest_version** `string` | 最新版本

表示技能的最新版本号。

**object** `string` | 资源类型

用于标识响应对象的资源类型，固定为 `skill`。

**protection_enabled** `boolean` | 内容保护开关

表示技能是否已启用内容保护。`true` 表示已启用，`false` 表示未启用。

**source** `string` | 技能来源

表示技能来源，固定为 `custom`。该值表示上传或导入的自定义技能。

**updated_at** `integer` | 技能更新时间

技能最后更新时间，为 Unix 时间戳，单位为秒。

**description** `string` | 技能描述

表示方舟平台从 `SKILL.md` 中解析出的技能描述。

**name** `string` | 技能名称

表示 `SKILL.md` 中定义的技能名称。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"protection_enabled": true}'
```

#### Response

```
{
  "id": "<SKILL_ID>",
  "object": "skill",
  "created_at": 1790072430,
  "description": "提取文档中的结构化信息",
  "latest_version": "1",
  "display_title": "文档处理",
  "source": "custom",
  "updated_at": 1790073000,
  "name": "document-helper",
  "protection_enabled": true
}
```

### Python


#### Request

```python
import json
import os

from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

result = client.post(
    "/skills/<SKILL_ID>",
    cast_to=object,
    body={
        "protection_enabled": True
    },
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "id": "<SKILL_ID>",
  "object": "skill",
  "created_at": 1790072430,
  "description": "提取文档中的结构化信息",
  "latest_version": "1",
  "display_title": "文档处理",
  "source": "custom",
  "updated_at": 1790073000,
  "name": "document-helper",
  "protection_enabled": true
}
```
