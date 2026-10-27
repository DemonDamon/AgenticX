---
source: https://ark.volcengine.com/region:cn-beijing/docs/scan-github-skills-api
fetched: 2026-10-24
title: 扫描 GitHub 技能
---

# 扫描 GitHub 技能

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/skills/github/scan`

扫描 GitHub 仓库中的 `SKILL.md`，返回技能候选项及校验结果。响应中 `valid` 为 `true` 的候选技能可通过导入 GitHub 技能接口导入。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**input** `string` `必选` | 仓库地址

用于指定待扫描的 GitHub 仓库。支持传入完整的仓库 URL 或 `owner/repo` 格式的仓库标识。

## 响应参数

**candidates** `object[]` | 技能候选项

包含本次扫描发现的技能候选项。

**name** `string` | 技能名称

`candidates.name`

表示方舟平台从候选目录的 `SKILL.md` 中解析出的技能名称。

**path** `string` | 技能路径

`candidates.path`

表示 `SKILL.md` 所在目录相对于仓库根目录的路径。仓库根目录本身是技能目录时，该值为空字符串。

**valid** `boolean` | 校验结果

`candidates.valid`

表示候选技能是否通过 `SKILL.md` 格式校验。`true` 表示校验通过，可以导入。`false` 表示校验失败，具体原因由 `error` 字段返回。

**error** `string` | 校验错误

`candidates.error`

候选技能未通过校验时，返回具体的错误原因。

**existing_skill_id** `string` | 已有技能 ID

`candidates.existing_skill_id`

当前账号已从相同仓库路径导入技能时，返回对应技能的 ID。

**has_update** `boolean` | 是否有更新

`candidates.has_update`

表示已导入技能是否存在更新。最新版本对应的提交与本次扫描的提交不同时，服务端返回 `true`。两次提交相同时，不返回该字段。

**repo** `object` | 仓库信息

包含本次扫描对应的仓库和提交信息。

**commit_sha** `string` | 提交 SHA

`repo.commit_sha`

表示本次扫描对应的 Git 提交 SHA。调用导入接口时，必须原样传入该值。

**html_url** `string` | 仓库地址

`repo.html_url`

提供 GitHub 仓库的网页地址。

**name** `string` | 仓库名称

`repo.name`

表示 GitHub 仓库名称。

**owner** `string` | 仓库所有者

`repo.owner`

表示 GitHub 仓库所有者。


## 代码示例

## 默认

### cURL


#### Request

```Bash
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/skills/github/scan" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": "anthropics/skills"}'
```

#### Response

```
{
  "repo": {
    "owner": "anthropics",
    "name": "skills",
    "commit_sha": "<COMMIT_SHA>",
    "html_url": "https://github.com/anthropics/skills"
  },
  "candidates": [
    {
      "path": "skills/pdf",
      "name": "pdf",
      "valid": true
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
    "/skills/github/scan",
    cast_to=object,
    body={
        "input": "anthropics/skills"
    },
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "repo": {
    "owner": "anthropics",
    "name": "skills",
    "commit_sha": "<COMMIT_SHA>",
    "html_url": "https://github.com/anthropics/skills"
  },
  "candidates": [
    {
      "path": "skills/pdf",
      "name": "pdf",
      "valid": true
    }
  ]
}
```
