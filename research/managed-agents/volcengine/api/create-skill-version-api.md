---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-skill-version-api
fetched: 2026-10-24
title: 创建新版本的技能
---

# 创建新版本的技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/skills/{skill_id}/versions`

为已有自定义技能上传文件并创建新版本。创建成功后，该技能的 `latest_version`、`name` 和 `description` 更新为新版本内容。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Path 参数

**skill_id** `string` `必选` | 技能 ID

用于指定需要创建新版本的技能。

### Body 参数

**display_title** `string` | 展示名称

用于设置新版本的展示名称。省略时，服务端使用 `SKILL.md` 中的 `name`。

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

## 响应参数

**created_at** `string` | 创建时间

该版本的创建时间，采用 RFC 3339 格式。

**display_title** `string` | 展示名称

表示该版本的展示名称。

**id** `string` | 版本 ID

用于唯一标识本次创建的版本，值以 `skillver-` 开头。

**skill_id** `string` | 技能 ID

表示该版本所属技能的 ID。

**type** `string` | 资源类型

用于标识响应对象的资源类型，固定为 `skill_version`。

**version** `string` | 版本号

表示新建版本的版本号。服务端在当前最大版本号的基础上加 `1`，并以字符串形式返回新版本号。

**description** `string` | 技能描述

表示方舟平台从该版本的 `SKILL.md` 中解析出的技能描述。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/<SKILL_ID>/versions" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -F "display_title=文档处理" \
  -F "files=@./document-helper.zip;type=application/zip"
```

#### Response

```
{
  "id": "skillver-20260922102510-b2c3d",
  "type": "skill_version",
  "skill_id": "<SKILL_ID>",
  "version": "2",
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

with open("./document-helper.zip", "rb") as file:
    version = client.post(
        "/skills/<SKILL_ID>/versions",
        cast_to=object,
        body={"display_title": "文档处理"},
        files={
            "files": (
                "document-helper.zip",
                file,
                "application/zip",
            )
        },
        options={"headers": {"Content-Type": "multipart/form-data"}},
    )

print(json.dumps(version, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "id": "skillver-20260922102510-b2c3d",
  "type": "skill_version",
  "skill_id": "<SKILL_ID>",
  "version": "2",
  "display_title": "文档处理",
  "description": "提取文档中的结构化信息",
  "created_at": "2026-09-22T10:25:10Z"
}
```

### Java


#### Request

```java
import com.volcengine.ark.runtime.models.skill.SkillVersion;
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

        File file = new File("./document-helper.zip");
        MultipartBody.Part filePart = MultipartBody.Part.createFormData(
                "files",
                file.getName(),
                RequestBody.create(
                        MediaType.parse("application/zip"),
                        file));
        SkillVersion version = service.createSkillVersion(
                "<SKILL_ID>", filePart, "文档处理");
        System.out.println(version);

        service.shutdownExecutor();
    }
}
```

#### Response

```
{
  "id": "skillver-20260922102510-b2c3d",
  "type": "skill_version",
  "skill_id": "<SKILL_ID>",
  "version": "2",
  "display_title": "文档处理",
  "description": "提取文档中的结构化信息",
  "created_at": "2026-09-22T10:25:10Z"
}
```
