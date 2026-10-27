---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-skill-version-api
fetched: 2026-10-24
title: 删除指定版本的技能
---

# 删除指定版本的技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}/versions/{version}`

删除当前账号中自定义技能的指定版本，不删除技能本身。

如果技能有多个版本，必须先删除所有非最新版本，之后才能删除最后剩余的最新版本。仍有其他版本时删除最新版本会返回 HTTP 400 `InvalidAction`。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定要删除版本的技能。

**version** `string` `必选` | 版本号

用于指定要删除的版本。

## 响应参数

**id** `string` | 版本 ID

已删除版本的 ID，用于标识该版本。

**type** `string` | 删除结果类型

用于标识删除成功响应的资源类型，固定为 `skill_version_deleted`。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>/versions/<VERSION>" \
  -X DELETE \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<SKILL_VERSION_ID>",
  "type": "skill_version_deleted"
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

result = client.delete(
    "/skills/<SKILL_ID>/versions/<VERSION>",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "id": "<SKILL_VERSION_ID>",
  "type": "skill_version_deleted"
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
		http.MethodDelete,
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
  "id": "<SKILL_VERSION_ID>",
  "type": "skill_version_deleted"
}
```
