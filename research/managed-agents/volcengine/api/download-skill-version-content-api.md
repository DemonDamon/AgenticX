---
source: https://ark.volcengine.com/region:cn-beijing/docs/download-skill-version-content-api
fetched: 2026-10-24
title: 下载指定版本的技能
---

# 下载指定版本的技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}/versions/{version}/content`

获取指定版本的技能 ZIP 包下载地址。服务端返回 HTTP 302 响应，并在 `Location` 响应头中提供有效期为 1 小时的下载地址。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定要下载版本内容的技能。

**version** `string` `必选` | 版本号

用于指定要下载的版本号。

## 响应参数

**Location** `string` | 下载地址

表示指定版本的技能 ZIP 包下载地址，有效期为 1 小时。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body --include \
  "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>/versions/<VERSION>/content" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
HTTP/1.1 302 Found
Location: <PRE_SIGNED_DOWNLOAD_URL>
```

### Python


#### Request

```python
import os

import httpx
from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

response = client.get(
    "/skills/<SKILL_ID>/versions/<VERSION>/content",
    cast_to=httpx.Response,
)
response.raise_for_status()

output_path = "./document-helper.zip"
with open(output_path, "wb") as file:
    file.write(response.content)
print(output_path)
```

#### Response

```
HTTP/1.1 302 Found
Location: <PRE_SIGNED_DOWNLOAD_URL>
```

### Java


#### Request

```java
import com.volcengine.ark.runtime.service.ArkApi;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.OkHttpClient;
import okhttp3.ResponseBody;
import retrofit2.Response;
import retrofit2.Retrofit;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Collections;

public class Main {
    public static void main(String[] args) throws Exception {
        OkHttpClient httpClient = ArkService.defaultApiKeyClient(
                System.getenv("ARK_API_KEY"),
                Duration.ofSeconds(30));
        Retrofit retrofit = ArkService.defaultRetrofit(
                httpClient,
                ArkService.defaultObjectMapper(),
                "https://ark.cn-beijing.volces.com/api/v3/",
                Runnable::run);
        ArkApi api = retrofit.create(ArkApi.class);

        Response<ResponseBody> response = api.openSkillContent(
                "<SKILL_ID>",
                "<VERSION>",
                Collections.emptyMap()).execute();
        if (!response.isSuccessful() || response.body() == null) {
            throw new IllegalStateException(
                    "Download failed with HTTP " + response.code());
        }
        try (ResponseBody body = response.body()) {
            Files.copy(
                    body.byteStream(),
                    Paths.get("./document-helper.zip"),
                    StandardCopyOption.REPLACE_EXISTING);
        }
        System.out.println("./document-helper.zip");
    }
}
```

#### Response

```
HTTP/1.1 302 Found
Location: <PRE_SIGNED_DOWNLOAD_URL>
```

### Go


#### Request

```go
package main

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/volcengine/ark-runtime-go/arkruntime"
)

func main() {
	client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
		arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)
	content, err := client.DownloadSkillVersionContent(
		context.Background(),
		"<SKILL_ID>",
		"<VERSION>",
	)
	if err != nil {
		panic(err)
	}
	defer content.Body.Close()

	output, err := os.Create("./document-helper.zip")
	if err != nil {
		panic(err)
	}
	defer output.Close()

	if _, err = io.Copy(output, content.Body); err != nil {
		panic(err)
	}
	fmt.Println(output.Name())
}
```

#### Response

```
HTTP/1.1 302 Found
Location: <PRE_SIGNED_DOWNLOAD_URL>
```
