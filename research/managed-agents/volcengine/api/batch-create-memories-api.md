---
source: https://ark.volcengine.com/region:cn-beijing/docs/batch-create-memories-api
fetched: 2026-10-24
title: 批量创建记忆
---

# 批量创建记忆

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/memory_stores/{memory_store_id}/memories/batch_create`

在指定记忆库中批量创建多条文本记忆，适合一次导入多个文件。仅写入一条时，可使用创建记忆接口。调用前需先创建记忆库，并使用创建或查询记忆库接口返回的 ID。

> **说明**
>
> **批量限制**
>
> - 单批必须包含 1–100 条记忆，总内容不超过 50 MiB。每条内容必须是有效的 UTF-8 文本，且不超过 100 KiB。
> - 批内路径重复时，整个请求返回 400 `InvalidParameter`。请求总量超限、批次参数非法或记忆库不可访问时，整个请求失败。
> - 每个记忆库最多保存 2000 条记忆。
>
> **处理结果**
>
> - 批次通过整体校验后，各条目独立处理。响应中的 `results` 与请求 `items` 按顺序一一对应；单条路径、内容或冲突校验失败时，请求仍返回 200，并在对应的 `results[].error` 中给出错误。
> - 成功条目的 `results[].memory` 不返回记忆正文（`content`）。需要正文时，调用查询记忆详情接口。
>
> **重试**
>
> - 重试前先核对各条结果。使用默认 `overwrite` 重试成功条目会再次更新其当前版本标识。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**memory_store_id** `string` `必选` | 记忆库 ID

用于指定目标记忆库，以 `memstore-` 开头。传入创建或查询记忆库接口返回的完整 ID，不要自行拼接。

### Body 参数

**items** `object[]` `必选` | 记忆列表

本次批量创建的记忆条目。

> **注意**
>
> 单批包含 1–100 条记忆。批内 `path` 不得重复；重复时整个请求返回 400 `InvalidParameter`。

**content** `string` `必选` | 记忆内容

`items.content`

写入记忆文件的正文。

> **注意**
>
> 记忆内容必须是有效的 UTF-8 文本，单条不得超过 102400 字节（100 KiB）。

**path** `string` `必选` | 记忆路径

`items.path`

记忆在记忆库中的文件路径。

> **注意**
>
> 路径必须以 `/` 开头，以 `.md` 或 `.txt` 结尾，UTF-8 编码后不得超过 1024 字节，且不得包含控制字符、`%`、`;` 或 `?`；路径段不得为空、`.` 或 `..`。

**on_conflict** `string` `默认值 overwrite` | 冲突策略

指定目标 `path` 已存在同名记忆时的处理方式：

- `overwrite`：用新内容覆盖已有记忆，并更新其当前版本标识。
- `fail`：保留已有记忆，该条目返回冲突错误，其他条目继续处理。

## 响应参数

**results** `object[]` | 创建结果

各条记忆的创建结果，与请求 `items` 顺序一一对应。成功时返回 `memory`，失败时返回 `error`。

**path** `string` | 记忆路径

`results.path`

对应请求中的 `items[].path`，用于关联输入条目和创建结果。

**error** `object` | 错误信息

`results.error`

该条记忆失败时的错误信息；成功时不返回。

**message** `string` | 错误描述

`results.error.message`

该条记忆失败的原因说明，用于定位并修正输入。

**type** `string` | 错误类型

`results.error.type`

错误类型标识，用于分类该条记忆的失败原因。

**memory** `object` | 记忆详情

`results.memory`

成功创建或覆盖后的记忆详情；该条记忆失败时不返回。

**content_sha256** `string` | 内容摘要

`results.memory.content_sha256`

记忆正文的 SHA-256 摘要，以小写十六进制字符串表示，可用于校验内容完整性。

**content_size_bytes** `integer` | 内容字节数

`results.memory.content_size_bytes`

记忆正文采用 UTF-8 编码后的字节数。

**created_at** `string` | 创建时间

`results.memory.created_at`

记忆创建时间，采用 RFC 3339 UTC 格式。

**created_by** `object` | 创建者

`results.memory.created_by`

创建该记忆的操作者信息。

**type** `string` | 操作者类型

`results.memory.created_by.type`

操作者类型。`user_actor` 表示通过用户身份写入，`session_actor` 表示会话中的智能体写入。

**session_id** `string` | 会话 ID

`results.memory.created_by.session_id`

写入该记忆的会话 ID，仅 `type` 为 `session_actor` 时返回。

**user_id** `string` | 用户 ID

`results.memory.created_by.user_id`

写入该记忆的用户 ID，仅 `type` 为 `user_actor` 时返回。

**id** `string` | 记忆 ID

`results.memory.id`

服务端生成的记忆 ID，以 `mem-` 开头。后续查询、更新或删除记忆时，作为 `memory_id` 路径参数传入。

**memory_store_id** `string` | 记忆库 ID

`results.memory.memory_store_id`

该记忆所属的记忆库 ID。

**memory_version_id** `string` | 版本 ID

`results.memory.memory_version_id`

记忆条目的当前版本标识。内容或路径成功更新后，该值会变化。

**path** `string` | 记忆路径

`results.memory.path`

记忆在记忆库中的文件路径。

**type** `string` | 对象类型

`results.memory.type`

对象类型，固定为 `memory`。

**updated_at** `string` | 更新时间

`results.memory.updated_at`

记忆最后更新时间，采用 RFC 3339 UTC 格式。


## 代码示例

## 批量创建记忆

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories/batch_create" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "items": [
    {
      "path": "/notes/2026/q3-plan.md",
      "content": "Q3 目标：完成托管智能体接口全量上线。"
    },
    {
      "path": "/notes/2026/q3-owners.md",
      "content": "接口 owner：接口团队；文档 owner：文档团队。"
    }
  ],
  "on_conflict": "fail"
}
EOF
```

#### Response

```
{
  "results": [
    {
      "path": "/notes/2026/q3-plan.md",
      "memory": {
        "id": "mem-<VALUE_1>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-plan.md",
        "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
        "content_size_bytes": 54,
        "memory_version_id": "<MEMORY_VERSION_ID_1>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    },
    {
      "path": "/notes/2026/q3-owners.md",
      "memory": {
        "id": "mem-<VALUE_2>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-owners.md",
        "content_sha256": "76a3fc07c4ab54fd1ce11d962dc31d256ad364628e84df5ee9a43b75a7d3cc28",
        "content_size_bytes": 60,
        "memory_version_id": "<MEMORY_VERSION_ID_2>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    }
  ]
}
```

### Python


#### Request

```python
import json
import os
import urllib.request

body = {
    "items": [
        {"path": "/notes/2026/q3-plan.md", "content": "Q3 目标：完成托管智能体接口全量上线。"},
            {"path": "/notes/2026/q3-owners.md", "content": "接口 owner：接口团队；文档 owner：文档团队。"},
    ],
    "on_conflict": "fail",
}
req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories/batch_create",
    headers={
        "Authorization": f"Bearer {os.environ['ARK_API_KEY']}",
        "Content-Type": "application/json",
    },
    data=json.dumps(body, ensure_ascii=False).encode(),
    method="POST",
)

with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
```

#### Response

```
{
  "results": [
    {
      "path": "/notes/2026/q3-plan.md",
      "memory": {
        "id": "mem-<VALUE_1>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-plan.md",
        "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
        "content_size_bytes": 54,
        "memory_version_id": "<MEMORY_VERSION_ID_1>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    },
    {
      "path": "/notes/2026/q3-owners.md",
      "memory": {
        "id": "mem-<VALUE_2>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-owners.md",
        "content_sha256": "76a3fc07c4ab54fd1ce11d962dc31d256ad364628e84df5ee9a43b75a7d3cc28",
        "content_size_bytes": 60,
        "memory_version_id": "<MEMORY_VERSION_ID_2>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    }
  ]
}
```

### Java


#### Request

```java
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class Main {
    public static void main(String[] args) throws Exception {
        String body = "{\"items\":["
                + "{\"path\":\"/notes/2026/q3-plan.md\","
                + "\"content\":\"Q3 目标：完成托管智能体接口全量上线。\"},"
                + "{\"path\":\"/notes/2026/q3-owners.md\","
                + "\"content\":\"接口 owner：接口团队；文档 owner：文档团队。\"}"
                + "],\"on_conflict\":\"fail\"}";
        Request req = new Request.Builder()
                .url("https://ark.cn-beijing.volces.com/api/v3"
                        + "/memory_stores/<MEMORY_STORE_ID>/memories/batch_create")
                .addHeader("Authorization", "Bearer " + System.getenv("ARK_API_KEY"))
                .post(RequestBody.create(
                        MediaType.parse("application/json"), body))
                .build();
        try (Response resp = new OkHttpClient().newCall(req).execute()) {
            String responseBody = resp.body() == null ? "" : resp.body().string();
            if (!resp.isSuccessful()) {
                throw new IllegalStateException(
                        "HTTP " + resp.code() + ": " + responseBody);
            }
            System.out.println(responseBody);
        }
    }
}
```

#### Response

```
{
  "results": [
    {
      "path": "/notes/2026/q3-plan.md",
      "memory": {
        "id": "mem-<VALUE_1>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-plan.md",
        "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
        "content_size_bytes": 54,
        "memory_version_id": "<MEMORY_VERSION_ID_1>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    },
    {
      "path": "/notes/2026/q3-owners.md",
      "memory": {
        "id": "mem-<VALUE_2>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-owners.md",
        "content_sha256": "76a3fc07c4ab54fd1ce11d962dc31d256ad364628e84df5ee9a43b75a7d3cc28",
        "content_size_bytes": 60,
        "memory_version_id": "<MEMORY_VERSION_ID_2>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    }
  ]
}
```

### Go


#### Request

```go
package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	ctx := context.Background()
	body := []byte(`{
  "items": [
    {"path": "/notes/2026/q3-plan.md", "content": "Q3 目标：完成托管智能体接口全量上线。"},
    {"path": "/notes/2026/q3-owners.md", "content": "接口 owner：接口团队；文档 owner：文档团队。"}
  ],
  "on_conflict": "fail"
}`)
	req, _ := http.NewRequestWithContext(ctx, "POST",
		"https://ark.cn-beijing.volces.com/api/v3/memory_stores/<MEMORY_STORE_ID>/memories/batch_create",
		bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ARK_API_KEY"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		responseBody, _ := io.ReadAll(resp.Body)
		panic(fmt.Sprintf("HTTP %d: %s", resp.StatusCode, responseBody))
	}
	if _, err := io.Copy(os.Stdout, resp.Body); err != nil {
		panic(err)
	}
	fmt.Println()
}
```

#### Response

```
{
  "results": [
    {
      "path": "/notes/2026/q3-plan.md",
      "memory": {
        "id": "mem-<VALUE_1>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-plan.md",
        "content_sha256": "e774ea541686b734b4d19d3460264bc350ecaebef7f45e7ca2bc31a712b2a694",
        "content_size_bytes": 54,
        "memory_version_id": "<MEMORY_VERSION_ID_1>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    },
    {
      "path": "/notes/2026/q3-owners.md",
      "memory": {
        "id": "mem-<VALUE_2>",
        "type": "memory",
        "memory_store_id": "<MEMORY_STORE_ID>",
        "path": "/notes/2026/q3-owners.md",
        "content_sha256": "76a3fc07c4ab54fd1ce11d962dc31d256ad364628e84df5ee9a43b75a7d3cc28",
        "content_size_bytes": 60,
        "memory_version_id": "<MEMORY_VERSION_ID_2>",
        "created_by": {"type": "user_actor", "user_id": "<USER_ID>"},
        "created_at": "2026-09-17T16:02:50Z",
        "updated_at": "2026-09-17T16:02:50Z"
      }
    }
  ]
}
```
