---
source: https://ark.volcengine.com/region:cn-beijing/docs/create-dream-api
fetched: 2026-10-24
title: 创建 Dream
---

# 创建 Dream

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

`POST https://ark.cn-beijing.volces.com/api/v3/dreams`

创建一个异步记忆整理任务。每个任务读取一个已有 Memory Store 和 1～100 个历史 Session，生成一个新的 Memory Store，不修改输入 Memory Store。

输出 Memory Store 会与任务一起创建，但在任务处于 `pending` 或 `running` 状态时不可挂载、读取或修改。任务最长执行 48 小时。

## 鉴权

本接口支持鉴权方式如下，详情请参见 [Base URL 及鉴权](https://ark.volcengine.com/docs/base-url-and-authentication)。

* API Key 鉴权，请在 [API Key 管理](https://ark.volcengine.com/region:cn-beijing/apiKey) 页面，获取长效 API Key。

---

<span id="request-parameters"></span>
## 请求参数

### Body 参数

**inputs** `object[]` `必选` | 任务输入

任务输入，必须恰好包含一个 `memory_store` 输入和一个 `sessions` 输入。

源记忆库输入 `object`

指定一个源 Memory Store。

**memory_store_id** `string` `必选` | 源记忆库 ID

`inputs.memory_store_id`

源 Memory Store ID，不能仅包含空白字符。

**type** `string` `必选` | 输入类型

`inputs.type`

输入类型，固定为 `memory_store`。

历史会话输入 `object`

指定一组历史 Session。

**session_ids** `string[]` `必选` | 历史会话 ID

`inputs.session_ids`

历史 Session ID 列表，需包含 1～100 个不重复且不能仅包含空白字符的 ID。

**type** `string` `必选` | 输入类型

`inputs.type`

输入类型，固定为 `sessions`。

**model** `string` `必选` | 模型 ID

执行记忆整理任务的模型 ID。模型必须已在当前项目中开通。

**output_memory_store_name** `string` `必选` | 输出记忆库名称

输出 Memory Store 的名称，长度为 1～64 个 Unicode 字符，不能仅包含空白字符。

**instructions** `string` | 整理指令

记忆整理要求，例如主题筛选、隐私信息剥离和归档规则。最多包含 4096 个 Unicode 字符。

**output_memory_store_description** `string` | 输出记忆库描述

输出 Memory Store 的描述，最多包含 300 个 Unicode 字符。省略时使用空描述。

## 响应参数

**created_at** `string` | 创建时间

任务创建时间，RFC 3339 格式。

**id** `string` | Dream ID

Dream 任务的唯一标识符，格式为 `drm-` 开头的字符串。

**inputs** `object[]` | 任务输入

创建任务时保存的输入快照。

源记忆库输入 `object`

创建任务时保存的源 Memory Store 输入。

**memory_store_id** `string` | 源记忆库 ID

`inputs.memory_store_id`

源 Memory Store ID。

**type** `string` | 输入类型

`inputs.type`

输入类型，固定为 `memory_store`。

历史会话输入 `object`

创建任务时保存的历史 Session 输入。

**session_ids** `string[]` | 历史会话 ID

`inputs.session_ids`

创建任务时保存的历史 Session ID 列表。

**type** `string` | 输入类型

`inputs.type`

输入类型，固定为 `sessions`。

**model** `object` | 模型信息

执行记忆整理任务的模型信息。

**id** `string` | 模型 ID

`model.id`

执行记忆整理任务的模型 ID。

**outputs** `object[]` | 任务输出

Dream 创建的输出 Memory Store。访问时机和内容完整性由 `status` 表示。

**memory_store_id** `string` | 输出记忆库 ID

`outputs.memory_store_id`

Dream 创建的输出 Memory Store ID。

**type** `string` | 输出类型

`outputs.type`

输出类型，固定为 `memory_store`。

**status** `string` | 任务状态

Dream 任务状态。创建成功后通常为 `pending`。

- `pending`：任务已受理，正在等待执行，输出 Memory Store 尚不可访问。
- `running`：任务正在执行，输出 Memory Store 尚不可访问。
- `completed`：任务已完成，输出 Memory Store 可以使用。
- `failed`：任务执行失败，输出 Memory Store 可以访问，但内容可能为空或不完整；可通过 `error` 查看原因。
- `canceled`：任务已取消，输出 Memory Store 可以访问，但内容可能为空或不完整。

**type** `string` | 对象类型

对象类型，固定为 `dream`。

**ended_at** `string` | 结束时间

任务进入终态的时间，RFC 3339 格式。任务未结束时为 `null`。

**error** `object` | 失败信息

任务异步执行失败的信息。任务未失败时为 `null`。

**message** `string` | 错误信息

`error.message`

Dream 执行失败的原因，用于定位任务失败问题。

**type** `string` | 错误类型

`error.type`

错误类型。`timeout` 表示任务超时；`internal_error` 表示任务执行期间发生内部错误。

**instructions** `string` | 整理指令

创建任务时传入的记忆整理要求。未传入时为 `null`。

**running_time** `number` | 累计运行时长

Dream 排除空闲间隔后的累计运行时长，单位为秒。暂未获得时为 `null`。

**usage** `object` | 用量统计

任务的 Token 用量。值为 `null` 时表示用量未知，不能解释为零消耗。

**cache_creation_input_tokens** `integer` | 缓存创建 Token 数

`usage.cache_creation_input_tokens`

写入缓存的输入 Token 数。

**cache_read_input_tokens** `integer` | 缓存读取 Token 数

`usage.cache_read_input_tokens`

从缓存读取的输入 Token 数。

**input_tokens** `integer` | 输入 Token 数

`usage.input_tokens`

本次 Dream 执行消耗的输入 token 数。

**output_tokens** `integer` | 输出 Token 数

`usage.output_tokens`

本次 Dream 执行生成的输出 token 数。


## 代码示例

## 创建 Dream

### cURL


#### Request

```bash
dream=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/dreams" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "inputs": [
    {
      "type": "memory_store",
      "memory_store_id": "$INPUT_MEMORY_STORE_ID"
    },
    {
      "type": "sessions",
      "session_ids": [
        "$SESSION_ID_1",
        "$SESSION_ID_2"
      ]
    }
  ],
  "model": "$MODEL_ID",
  "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
  "output_memory_store_name": "dream-curated-memory",
  "output_memory_store_description": "Dream 整理后的长期记忆"
}
EOF
)

printf '%s\n' "$dream"

DREAM_ID=$(jq -er '.id' <<<"$dream")
OUTPUT_MEMORY_STORE_ID=$(
  jq -er '.outputs[] | select(.type == "memory_store") | .memory_store_id' <<<"$dream"
)

export DREAM_ID OUTPUT_MEMORY_STORE_ID
printf 'Dream ID: %s\n' "$DREAM_ID"
printf 'Output Memory Store ID: %s\n' "$OUTPUT_MEMORY_STORE_ID"
```

#### Response

```
{
  "type": "dream",
  "id": "drm-20260924143000-a1b2c",
  "status": "pending",
  "inputs": [
    {
      "type": "memory_store",
      "memory_store_id": "memstore-20260920100000-source"
    },
    {
      "type": "sessions",
      "session_ids": [
        "sesn-20260921100000-a1b2c",
        "sesn-20260922100000-d3e4f"
      ]
    }
  ],
  "outputs": [
    {
      "type": "memory_store",
      "memory_store_id": "memstore-20260924143000-output"
    }
  ],
  "model": {
    "id": "<MODEL_ID>"
  },
  "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
  "created_at": "2026-09-24T06:30:00Z",
  "ended_at": null,
  "usage": null,
  "running_time": null,
  "error": null
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
    "/dreams",
    cast_to=object,
    body={
        "inputs": [
            {
                "type": "memory_store",
                "memory_store_id": "<INPUT_MEMORY_STORE_ID>"
            },
            {
                "type": "sessions",
                "session_ids": [
                    "<SESSION_ID_1>",
                    "<SESSION_ID_2>"
                ]
            }
        ],
        "model": "<MODEL_ID>",
        "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
        "output_memory_store_name": "dream-curated-memory",
        "output_memory_store_description": "Dream 整理后的长期记忆"
    },
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

#### Response

```
{
  "type": "dream",
  "id": "drm-20260924143000-a1b2c",
  "status": "pending",
  "inputs": [
    {
      "type": "memory_store",
      "memory_store_id": "memstore-20260920100000-source"
    },
    {
      "type": "sessions",
      "session_ids": [
        "sesn-20260921100000-a1b2c",
        "sesn-20260922100000-d3e4f"
      ]
    }
  ],
  "outputs": [
    {
      "type": "memory_store",
      "memory_store_id": "memstore-20260924143000-output"
    }
  ],
  "model": {
    "id": "<MODEL_ID>"
  },
  "instructions": "保留稳定偏好和已验证结论；删除重复、过期和包含个人身份的信息；按主题组织结果。",
  "created_at": "2026-09-24T06:30:00Z",
  "ended_at": null,
  "usage": null,
  "running_time": null,
  "error": null
}
```
