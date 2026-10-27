---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-skill-version-api
fetched: 2026-10-24
title: 查询指定版本的技能
---

# 查询指定版本的技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}/versions/{version}`

查询指定技能在某一版本下的详细信息，不返回技能文件内容。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定要查询版本的技能。

**version** `string` `必选` | 版本号

用于指定要查询的版本号。

## 响应参数

**created_at** `string` | 创建时间

该版本的创建时间，采用 RFC 3339 格式。

**display_title** `string` | 展示名称

表示该版本的展示名称。

**id** `string` | 版本 ID

用于唯一标识该版本，值以 `skillver-` 开头。

**skill_id** `string` | 技能 ID

表示该版本所属技能的 ID。

**type** `string` | 资源类型

用于标识响应对象的资源类型，固定为 `skill_version`。

**version** `string` | 版本号

表示技能的版本号。

**description** `string` | 技能描述

表示方舟平台从该版本的 `SKILL.md` 中解析出的技能描述。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>/versions/<VERSION>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "skillver-20260922102510-b2c3d",
  "type": "skill_version",
  "skill_id": "<SKILL_ID>",
  "version": "<VERSION>",
  "display_title": "文档处理",
  "description": "提取文档中的结构化信息",
  "created_at": "2026-09-22T10:25:10Z"
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
    "/skills/<SKILL_ID>/versions/<VERSION>",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "id": "skillver-20260922102510-b2c3d",
  "type": "skill_version",
  "skill_id": "<SKILL_ID>",
  "version": "<VERSION>",
  "display_title": "文档处理",
  "description": "提取文档中的结构化信息",
  "created_at": "2026-09-22T10:25:10Z"
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
		"https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>/versions/<VERSION>",
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
  "id": "skillver-20260922102510-b2c3d",
  "type": "skill_version",
  "skill_id": "<SKILL_ID>",
  "version": "<VERSION>",
  "display_title": "文档处理",
  "description": "提取文档中的结构化信息",
  "created_at": "2026-09-22T10:25:10Z"
}
```
