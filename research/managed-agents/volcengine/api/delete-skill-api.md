---
source: https://ark.volcengine.com/region:cn-beijing/docs/delete-skill-api
fetched: 2026-10-24
title: 删除技能
---

# 删除技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`DELETE https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}`

删除指定的自定义技能。技能与技能版本是独立资源，删除最后一个版本不会删除技能。

删除技能前，按以下顺序处理：

1. 更新引用该技能的 Agent，移除对应技能配置。删除技能不会自动移除引用；未移除时，相关 Agent 后续创建的 Session 可能运行失败。
2. 删除该技能的全部版本。存在多个版本时，先删除非最新版本，再删除最后剩余的最新版本。
3. 调用本接口删除技能。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定要删除的技能。

## 响应参数

**id** `string` | 技能 ID

用于标识已删除的技能。

**type** `string` | 删除结果类型

用于标识删除成功响应的资源类型，固定为 `skill_deleted`。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>" \
  -X DELETE \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<SKILL_ID>",
  "type": "skill_deleted"
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
    "/skills/<SKILL_ID>",
    cast_to=object,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "id": "<SKILL_ID>",
  "type": "skill_deleted"
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
		"https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>",
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
  "id": "<SKILL_ID>",
  "type": "skill_deleted"
}
```
