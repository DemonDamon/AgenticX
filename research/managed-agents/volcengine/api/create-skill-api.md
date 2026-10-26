---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-skill-api
fetched: 2026-10-24
title: 创建技能
---

# 创建技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/skills`

上传技能文件并创建自定义技能。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**display_title** `string` | 展示名称

用于设置技能的展示名称。省略时，服务端使用 `SKILL.md` 中的 `name`。

**files** `file[]` | 技能文件

使用 `files` 字段名上传技能文件。`files[]` 是兼容字段名，两者表示同一组技能文件。

`files` 与 `files[]` 至少传入一项。任选一种字段名即可；同时传入时，服务端会合并处理文件。

该字段支持以下上传方式：

* 单个 ZIP 文件。
* 单个 `SKILL.md` 文件。
* 重复传入该字段，上传保留相对路径的多个文件。

上传内容必须满足以下限制：

* 每次请求最多上传 500 个文件，所有上传文件的原始大小合计不超过 30 MiB。
* 上传 ZIP 文件时，解压后单个文件不超过 30 MiB，所有文件总大小不超过 120 MiB。
* ZIP 文件或多文件目录只能包含一个顶层目录，且该目录下必须直接包含且只能包含一个 `SKILL.md`。
* `SKILL.md` 的 YAML frontmatter 必须包含非空的 `name` 和 `description`。
* `name` 去除首尾空白后长度为 1～64 个字符，只能包含小写英文字母、数字和连字符（`-`），不能以连字符开头或结尾，也不能包含连续连字符。

**files[]** `file[]` | 技能文件

`files` 的兼容字段名。上传方式和校验规则与 `files` 相同。

重复传入 `files[]` 时，每个文件的 `filename` 需要保留相对于技能目录的路径。同时传入两个字段时，服务端会合并处理文件。

**protection_enabled** `boolean` `默认值 false` | 内容保护开关

用于控制是否为技能启用内容保护。

* `true`：方舟平台在运行技能时注入保护指令，降低技能内容被直接输出的风险。
* `false`：方舟平台不启用该保护。

## 响应参数

**created_at** `integer` | 创建时间

技能创建时间，为 Unix 时间戳，单位为秒。

**display_title** `string` | 展示名称

技能的展示名称。未配置时，服务端返回 `SKILL.md` 中的 `name`。

**id** `string` | 技能 ID

用于唯一标识新建的技能，值以 `skill-` 开头。后续查询、更新、删除技能和管理技能的不同版本时需要使用该 ID。

**latest_version** `string` | 最新版本

表示新建技能的版本号，固定为 `1`。

**object** `string` | 资源类型

用于标识响应对象的资源类型，固定为 `skill`。

**protection_enabled** `boolean` | 内容保护开关

表示技能是否已启用内容保护。`true` 表示已启用，`false` 表示未启用。

**source** `string` | 技能来源

表示技能来源，固定为 `custom`。该值表示当前账号上传的自定义技能。

**updated_at** `integer` | 技能更新时间

技能最后更新时间，为 Unix 时间戳，单位为秒。创建技能时，该值与 `created_at` 相同。

**description** `string` | 技能描述

表示方舟平台从 `SKILL.md` 中解析出的技能描述。

**name** `string` | 技能名称

表示 `SKILL.md` 中定义的技能名称。


## 代码示例

## 创建技能

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "display_title=文档抽取助手" \
  -F "files=@./skill-doc-extractor.zip;type=application/zip"
```

#### Response

```
{
  "id": "skill-20260922102030-a1b2c",
  "object": "skill",
  "created_at": 1790072430,
  "description": "从 PDF/DOCX 中抽取结构化字段并输出 JSON",
  "latest_version": "1",
  "display_title": "文档抽取助手",
  "source": "custom",
  "updated_at": 1790072430,
  "name": "document-extractor",
  "protection_enabled": false
}
```

### Python


#### Request

```python
import os

from arkruntime import Ark

client = Ark(
    api_key=os.environ["ARK_API_KEY"],
    base_url="https://ark.cn-beijing.volces.com/api/v3",
)

with open("./skill-doc-extractor.zip", "rb") as file:
    skill = client.skills.create(
        files=file,
        display_title="文档抽取助手",
    )
print(skill)
```

#### Response

```
{
  "id": "skill-20260922102030-a1b2c",
  "object": "skill",
  "created_at": 1790072430,
  "description": "从 PDF/DOCX 中抽取结构化字段并输出 JSON",
  "latest_version": "1",
  "display_title": "文档抽取助手",
  "source": "custom",
  "updated_at": 1790072430,
  "name": "document-extractor",
  "protection_enabled": false
}
```

### Java


#### Request

```java
// pom.xml 依赖：
//   <dependency>
//     <groupId>com.volcengine</groupId>
//     <artifactId>ark-runtime</artifactId>
//     <version>0.9.0</version>
//   </dependency>
import com.volcengine.ark.runtime.models.skill.Skill;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import java.io.File;

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        File file = new File("./skill-doc-extractor.zip");
        MultipartBody.Part filePart = MultipartBody.Part.createFormData(
                "files", file.getName(),
                RequestBody.create(MediaType.parse("application/zip"), file));
        Skill skill = service.createSkill(filePart, "文档抽取助手");
        System.out.println(skill);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "skill-20260922102030-a1b2c",
  "object": "skill",
  "created_at": 1790072430,
  "description": "从 PDF/DOCX 中抽取结构化字段并输出 JSON",
  "latest_version": "1",
  "display_title": "文档抽取助手",
  "source": "custom",
  "updated_at": 1790072430,
  "name": "document-extractor",
  "protection_enabled": false
}
```

### Go


#### Request

```go
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/volcengine/ark-runtime-go/arkruntime"
)

func main() {
	ctx := context.Background()
    client := arkruntime.NewClientWithApiKey(
		os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
	)

	f, err := os.Open("./skill-doc-extractor.zip")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	skill, err := client.CreateSkill(ctx, f, "skill-doc-extractor.zip", "文档抽取助手")
	if err != nil {
		panic(err)
	}
	fmt.Println(skill)
}
```

#### Response

```
{
  "id": "skill-20260922102030-a1b2c",
  "object": "skill",
  "created_at": 1790072430,
  "description": "从 PDF/DOCX 中抽取结构化字段并输出 JSON",
  "latest_version": "1",
  "display_title": "文档抽取助手",
  "source": "custom",
  "updated_at": 1790072430,
  "name": "document-extractor",
  "protection_enabled": false
}
```
