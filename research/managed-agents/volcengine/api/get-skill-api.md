---
source: https://ark.volcengine.com/region:cn-beijing/docs/get-skill-api
fetched: 2026-10-24
title: 查询技能详情
---

# 查询技能详情

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`GET https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}`

查询指定技能的详细信息。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定要查询的技能。

## 响应参数

**created_at** `integer` | 创建时间

技能创建时间，为 Unix 时间戳，单位为秒。

**display_title** `string` | 展示名称

技能的展示名称。未配置时，服务端返回 `SKILL.md` 中的 `name`。

**id** `string` | 技能 ID

用于唯一标识技能。更新、删除技能或管理技能版本时需要使用该 ID。

* 自定义技能和方舟平台预置技能的 ID 以 `skill-` 开头。
* Skill Hub 技能的 ID 以 `s-` 开头。

**latest_version** `string` | 最新版本

表示技能的最新版本号。

**object** `string` | 资源类型

用于标识响应对象的资源类型，固定为 `skill`。

**protection_enabled** `boolean` | 内容保护开关

表示技能是否已启用内容保护。`true` 表示已启用，`false` 表示未启用。

**source** `string` | 技能来源

该字段表示技能来源：

* `custom` 表示上传或导入的自定义技能。
* `skill_hub` 表示来自 Skill Hub 的公共技能。
* `ark` 表示方舟平台预置技能。

**updated_at** `integer` | 技能更新时间

技能最后更新时间，为 Unix 时间戳，单位为秒。

**description** `string` | 技能描述

表示方舟平台从 `SKILL.md` 中解析出的技能描述。

**name** `string` | 技能名称

表示 `SKILL.md` 中定义的技能名称。


## 代码示例

## 查询技能详情

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

#### Response

```
{
  "id": "<SKILL_ID>",
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

skill = client.skills.retrieve("<SKILL_ID>")
print(skill)
```

#### Response

```
{
  "id": "<SKILL_ID>",
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

public class Main {
    public static void main(String[] args) throws Exception {
        ArkService service = ArkService.builder()
                .apiKey(System.getenv("ARK_API_KEY"))
                .baseUrl("https://ark.cn-beijing.volces.com/api/v3")
                .build();

        Skill skill = service.getSkill("<SKILL_ID>");
        System.out.println(skill);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "<SKILL_ID>",
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

	skill, err := client.GetSkill(ctx, "<SKILL_ID>")
	if err != nil {
		panic(err)
	}
	fmt.Println(skill)
}
```

#### Response

```
{
  "id": "<SKILL_ID>",
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
