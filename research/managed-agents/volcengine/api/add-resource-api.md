---
source: https://ark.volcengine.com/region:cn-beijing/docs/add-resource-api
fetched: 2026-10-24
title: 添加会话资源
---

# 添加会话资源

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/sessions/{session_id}/resources`

将 Files API 中的文件添加到已有会话的托管运行环境。当前仅支持 `file`，并以只读方式挂载。

添加成功后，请使用响应中的 `file_id` 查询或引用该文件。本接口仅适用于绑定托管运行环境的会话。

> **说明**
>
> 挂载后，智能体通过 `mount_path` 读取文件；未指定该字段时，路径为 `/mnt/session/uploads/<filename>`。若还需要将同一文件传入模型上下文，请在 `user.message` 的 `content[]` 中引用响应中的 `file_id`。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**session_id** `string` `必选` | 会话 ID

填写要添加资源的会话 ID，形如 `sesn-...`。

### Body 参数

**file_id** `string` `必选` | 文件 ID

要挂载到会话的文件 ID，通过 Files API 上传文件后获得。

> **说明**
>
> 文件不能超过 100 MiB。通过 Files API 上传文件时，`purpose` 必须为 `user_data` 或 `agent`；文件 ID 格式需匹配 `^[A-Za-z0-9_-]{1,128}$`。

**type** `string` `必选` | 资源类型

要添加的资源类型，固定为 `file`，表示通过 Files API 上传的文件。

**mount_path** `string` | 挂载路径

文件在托管运行环境中的路径。省略或传入空值时，使用文件上传时的原始文件名，最终路径为 `/mnt/session/uploads/<filename>`。

> **说明**
>
> 路径开头的 `/` 会自动移除。路径不得包含独立的 `..` 或 `.` 路径段，例如 `a/../b` 和 `a/./b` 均不合法；也不得包含反斜杠、连续的 `//` 或控制字符，且不能以 `/` 结尾。

## 响应参数

**access** `string` | 访问模式

会话对文件的访问权限，固定为 `read_only`，表示智能体可以读取文件，但不能修改。

**type** `string` | 资源类型

已挂载资源的类型，固定为 `file`，表示通过 Files API 上传的文件。

**created_at** `string` | 创建时间

文件挂载到会话的时间，采用 RFC 3339 格式。

**file_id** `string` | 文件 ID

当前可用的文件 ID。该值可能与请求中提交的 `file_id` 不同；后续查询和引用请以响应值为准。

**id** `string` | 资源 ID

会话资源 ID，形如 `sesrsc-...`。

**mount_path** `string` | 挂载路径

文件在托管运行环境中的完整挂载路径。

> **说明**
>
> 指定 `mount_path` 时，返回值由 `/mnt/session/uploads/` 与规范化后的请求路径组成。例如传入 `data/report.pdf` 时，返回 `/mnt/session/uploads/data/report.pdf`。未指定时，返回 `/mnt/session/uploads/<filename>`。

**updated_at** `string` | 更新时间

会话资源信息最后更新的时间，采用 RFC 3339 格式。


## 代码示例

## 添加会话资源

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "type": "file",
  "file_id": "<FILE_ID>",
  "mount_path": "workspace/input.txt"
}
EOF
```

#### Response

```
{
  "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
  "type": "file",
  "file_id": "<FILE_ID>",
  "mount_path": "/mnt/session/uploads/workspace/input.txt",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
}
```

### Python


#### Request

```python
import json
import os
import urllib.request

payload = json.dumps(
    {
        "type": "file",
        "file_id": "<FILE_ID>",
        "mount_path": "workspace/input.txt",
    }
).encode()
req = urllib.request.Request(
    "https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources",
    data=payload,
    method="POST",
    headers={
        "Authorization": f"Bearer {os.environ['ARK_API_KEY']}",
        "Content-Type": "application/json",
    },
)

with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
```

#### Response

```
{
  "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
  "type": "file",
  "file_id": "<FILE_ID>",
  "mount_path": "/mnt/session/uploads/workspace/input.txt",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
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
        String body = "{\"type\":\"file\","
                + "\"file_id\":\"<FILE_ID>\","
                + "\"mount_path\":\"workspace/input.txt\"}";
        Request req = new Request.Builder()
                .url("https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources")
                .addHeader("Authorization", "Bearer " + System.getenv("ARK_API_KEY"))
                .post(RequestBody.create(
                        MediaType.parse("application/json"), body))
                .build();
        try (Response resp = new OkHttpClient().newCall(req).execute()) {
            String responseBody = resp.body() == null ? "" : resp.body().string();
            if (!resp.isSuccessful()) {
                throw new RuntimeException(
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
  "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
  "type": "file",
  "file_id": "<FILE_ID>",
  "mount_path": "/mnt/session/uploads/workspace/input.txt",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
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
  "type": "file",
  "file_id": "<FILE_ID>",
  "mount_path": "workspace/input.txt"
}`)
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://ark.cn-beijing.volces.com/api/v3/sessions/<SESSION_ID>/resources",
		bytes.NewReader(body),
	)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ARK_API_KEY"))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		errorBody, _ := io.ReadAll(resp.Body)
		panic(fmt.Sprintf("HTTP %d: %s", resp.StatusCode, errorBody))
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
  "id": "sesrsc-01hx3z9r0w8n3p5q6s7t8v9x20",
  "type": "file",
  "file_id": "<FILE_ID>",
  "mount_path": "/mnt/session/uploads/workspace/input.txt",
  "created_at": "2026-07-15T08:30:20.000Z",
  "updated_at": "2026-07-15T08:30:20.000Z"
}
```
