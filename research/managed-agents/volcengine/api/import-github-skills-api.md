---
source: https://ark.volcengine.com/region:cn-beijing/docs/import-github-skills-api
fetched: 2026-10-24
title: 导入 GitHub 技能
---

# 导入 GitHub 技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/skills/github/import`

导入 GitHub 技能前，先调用扫描 GitHub 技能接口，获取可导入的技能及本次扫描对应的仓库信息。

服务端将所选技能与当前已有技能对比后，分别处理：

- 所选技能尚未导入时，服务端创建技能。
- 所选技能已导入，但本次扫描的提交与最新版本对应的提交不同时，服务端创建新版本。
- 所选技能已导入，且两次提交相同时，服务端跳过该项。

请求成功不表示每项都导入成功。调用后，检查 `items[].status` 获取每项导入结果。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**repo** `object` `必选` | 仓库信息

传入扫描接口返回的仓库信息。`commit_sha` 必须使用扫描接口返回的原始值。

**commit_sha** `string` `必选` | 提交 SHA

`repo.commit_sha`

表示扫描接口返回的 Git 提交 SHA。导入请求必须原样传入该值。

**html_url** `string` `必选` | 仓库地址

`repo.html_url`

提供 GitHub 仓库的网页地址。

**name** `string` `必选` | 仓库名称

`repo.name`

表示 GitHub 仓库名称。

**owner** `string` `必选` | 仓库所有者

`repo.owner`

表示 GitHub 仓库所有者。

**selected** `object[]` `必选` | 待导入技能

用于指定要导入的技能路径，至少传入一项。

**path** `string` `必选` | 技能路径

`selected.path`

用于指定要导入的技能。传入扫描接口返回的 `candidates[].path`，即 `SKILL.md` 所在目录相对于仓库根目录的路径。导入仓库根目录中的技能时，传入空字符串。

**protection_enabled** `boolean` `默认值 false` | 内容保护开关

`selected.protection_enabled`

控制服务端在新建技能时是否启用内容保护。

* `true`：运行技能时，方舟平台会注入保护指令，降低技能内容被直接输出的风险。
* `false`：方舟平台不启用内容保护。

该字段仅在所选路径尚未导入、服务端创建新技能时生效。所选路径已导入时，不修改已有技能的内容保护设置。

## 响应参数

**items** `object[]` | 导入结果

返回每个所选技能的导入结果。请求成功不表示每项都导入成功。调用后，检查每个 `items[].status`。

**path** `string` | 技能路径

`items.path`

表示本条导入结果对应的 `selected[].path`。

**status** `string` | 导入状态

`items.status`

该字段表示导入状态：

* `ok` 表示服务端已创建新技能。
* `updated` 表示服务端已为已有技能创建新版本。
* `skipped_duplicate` 表示已有技能的当前版本与扫描提交相同，服务端未重复导入。
* `failed` 表示该技能导入失败。

**error_code** `string` | 错误码

`items.error_code`

导入失败时返回的错误码。

**error_message** `string` | 错误信息

`items.error_message`

导入失败时返回的错误信息。

**skill_id** `string` | 技能 ID

`items.skill_id`

服务端创建技能、更新技能或跳过重复项时，返回对应技能的 ID。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/github/import" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": {
      "owner": "anthropics",
      "name": "skills",
      "commit_sha": "<COMMIT_SHA>",
      "html_url": "https://github.com/anthropics/skills"
    },
    "selected": [
      {
        "path": "skills/pdf",
        "protection_enabled": true
      }
    ]
  }'
```

#### Response

```
{
  "items": [
    {
      "path": "skills/pdf",
      "status": "ok",
      "skill_id": "skill-20260922102030-a1b2c"
    }
  ]
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

result = client.post(
    "/skills/github/import",
    cast_to=object,
    body={
        "repo": {
            "owner": "anthropics",
            "name": "skills",
            "commit_sha": "<COMMIT_SHA>",
            "html_url": "https://github.com/anthropics/skills"
        },
        "selected": [
            {
                "path": "skills/pdf",
                "protection_enabled": True
            }
        ]
    },
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "items": [
    {
      "path": "skills/pdf",
      "status": "ok",
      "skill_id": "skill-20260922102030-a1b2c"
    }
  ]
}
```
