---
source: https://ark.volcengine.com/region:cn-beijing/docs/list-skills-api
fetched: 2026-10-24
title: 查询技能列表
---

# 查询技能列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/skills`

查询方舟平台预置技能或自定义技能列表。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Query 参数

> 在 URL Query String 中传入。

**limit** `integer` `默认值 20` | 每页数量

用于设置单页最多返回的记录数。

**取值范围**：`[1, 100]`

**name** `string` | 技能名称

用于按 `SKILL.md` 中的技能名称筛选技能。

**page** `string` | 下一页标识

首次请求时省略该参数。后续请求将上一次响应返回的 `next_page` 原样传入该参数。

该值由服务端生成，不是页码。不要解析、生成或修改该值。

**source** `string` | 技能来源

用于按技能来源筛选技能：

* `custom`：返回当前账号的自定义技能。
* `ark`：返回方舟平台预置技能。

省略时，服务端返回这两类技能。该接口不支持查询 Skill Hub 技能，传入 `skill_hub` 时返回参数错误。

## 响应参数

**data** `object[]` | 技能列表

包含当前页返回的技能列表。

**created_at** `integer` | 创建时间

`data.created_at`

技能创建时间，为 Unix 时间戳，单位为秒。

**display_title** `string` | 展示名称

`data.display_title`

技能的展示名称。未配置时，服务端返回 `SKILL.md` 中的 `name`。

**id** `string` | 技能 ID

`data.id`

用于唯一标识技能。服务端返回的自定义技能和方舟平台预置技能 ID 均以 `skill-` 开头。

**latest_version** `string` | 最新版本

`data.latest_version`

表示技能的最新版本号。

**object** `string` | 资源类型

`data.object`

用于标识响应对象的资源类型，固定为 `skill`。

**protection_enabled** `boolean` | 内容保护开关

`data.protection_enabled`

表示技能是否已启用内容保护。`true` 表示已启用，`false` 表示未启用。

**source** `string` | 技能来源

`data.source`

该字段表示技能来源：

* `custom` 表示当前账号上传或导入的自定义技能。
* `ark` 表示方舟平台预置技能。

**updated_at** `integer` | 技能更新时间

`data.updated_at`

技能最后更新时间，为 Unix 时间戳，单位为秒。

**description** `string` | 技能描述

`data.description`

表示方舟平台从 `SKILL.md` 中解析出的技能描述。

**name** `string` | 技能名称

`data.name`

表示 `SKILL.md` 中定义的技能名称。

**has_more** `boolean` | 是否有下一页

表示是否还有下一页数据：

* `true`：仍有数据，可以继续分页查询。
* `false`：已返回最后一页。

**next_page** `string` | 下一页标识

服务端生成的下一页标识。`has_more` 为 `true` 时，将该值原样传入下一次请求的 `page`；没有下一页时，不返回该字段。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills?limit=20&source=custom" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "data": [
    {
      "id": "skill-20260922102030-a1b2c",
      "object": "skill",
      "created_at": 1790072430,
      "description": "提取文档中的结构化信息",
      "latest_version": "1",
      "display_title": "文档处理",
      "source": "custom",
      "updated_at": 1790072430,
      "name": "document-helper",
      "protection_enabled": false
    }
  ],
  "has_more": false
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

result = client.get(
    "/skills?limit=20&source=custom",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "data": [
    {
      "id": "skill-20260922102030-a1b2c",
      "object": "skill",
      "created_at": 1790072430,
      "description": "提取文档中的结构化信息",
      "latest_version": "1",
      "display_title": "文档处理",
      "source": "custom",
      "updated_at": 1790072430,
      "name": "document-helper",
      "protection_enabled": false
    }
  ],
  "has_more": false
}
```

### Go


#### Request

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/volcengine/ark-runtime-go/arkruntime"
	"github.com/volcengine/ark-runtime-go/arkruntime/model"
)

type jsonResponse struct {
	model.HttpHeader
	value map[string]interface{}
}

func (response *jsonResponse) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &response.value)
}

func main() {
	client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
		arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)
	response := &jsonResponse{}
	err := client.Do(
		context.Background(),
		http.MethodGet,
		"https://ark.cn-beijing.volces.com/api/v3/skills?limit=20&source=custom",
		"",
		"",
		response,
	)
	if err != nil {
		panic(err)
	}

	output, err := json.MarshalIndent(response.value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(output))
}
```

#### Response

```
{
  "data": [
    {
      "id": "skill-20260922102030-a1b2c",
      "object": "skill",
      "created_at": 1790072430,
      "description": "提取文档中的结构化信息",
      "latest_version": "1",
      "display_title": "文档处理",
      "source": "custom",
      "updated_at": 1790072430,
      "name": "document-helper",
      "protection_enabled": false
    }
  ],
  "has_more": false
}
```
