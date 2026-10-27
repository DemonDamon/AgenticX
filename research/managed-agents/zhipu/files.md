---
source: https://docs.bigmodel.cn/cn/managed-agents/files
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 文件

Files API 覆盖两类用法：**输入**（把材料送进会话给 Agent 读）和**产物**（把 Agent 写出来的结果拿回来）。底层都是同一个 File 对象，差别在来源、沙箱路径和能不能被编目下载。

| | 输入 | 产物 |
| - | - | - |
| 用途 | 给 Agent 读的材料：表格、文档、附件 | Agent 做完要交给你的文件：报告、图表、导出结果 |
| 怎么来 | 你 **POST /v1/files** 上传，再挂到会话 | Agent 写入 **/mnt/session/outputs**，平台自动编目 |
| 沙箱路径 | **/mnt/session/uploads**，对 Agent **只读** | **/mnt/session/outputs**，**读写** |
| 怎么取回 | 你本来就持有源文件 | **GET /v1/files?scope\_id=\$SESSION\_ID** 列出，再下载 content |

写在 **/workspace** 的中间文件不会被编目，也无法通过 Files API 取回。需要交给调用方的文件产物，应写到 **/mnt/session/outputs**（始终跨轮保留）。**/workspace** 的跨轮保留见[创建会话](create-session.md#跨轮保留沙箱文件)。

## 控制台操作

进入 **Managed Agents → 文件** 上传输入材料，在列表中复制文件 ID、下载或删除文件。上传完成后，还需在创建会话时选择该文件作为资源，或在会话资源面板挂载；检查实际路径后再让 Agent 读取。

在会话中检查文件产物并下载验收。需要可下载产物时，要求 Agent 写入 `/mnt/session/outputs`。输入资源的文件挂载与消息附件引用不同，详见[会话调试](session-debugging.md)。

## 输入：上传并挂载

**POST /v1/files**，multipart 形式：

```bash theme={null}
file=$(curl -sS "$BASE_URL/v1/files" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -F "file=@sales_data.csv;type=text/csv")

FILE_ID=$(jq -r '.id' <<< "$file")
```

```json theme={null}
{
  "type": "file",
  "id": "file_xxxxxxxxxxxx",
  "filename": "sales_data.csv",
  "mime_type": "text/csv",
  "size_bytes": 182044,
  "downloadable": false,
  "created_at": "2026-08-28T08:00:00.000Z"
}
```

上传文件的 **downloadable** 为 **false**，不能再用 Files API 下载；只有写入 **/mnt/session/outputs** 后编目的会话产物可下载。

约束：单文件默认上限 500 MB；文件名 1–255 字符，不得为 . 或 ..，不得含控制字符及小于号、大于号、冒号、双引号、竖线、问号、星号、斜杠、反斜杠；省略 MIME 类型时按 application/octet-stream 处理；组织总配额默认 500 GB。文件类型不限——任何格式都可以上传，是否能被处理取决于沙箱内的工具。

创建会话时通过 **resources** 数组挂载。文件会出现在 **/mnt/session/uploads** 下，对 Agent **只读**：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "resources": [
    { "type": "file", "file_id": "$FILE_ID", "mount_path": "/data/sales_data.csv" }
  ]
}
EOF
```

挂载路径规则：

* **mount\_path** 可写相对形式（/data/sales\_data.csv）或完整形式（/mnt/session/uploads/data/sales\_data.csv），都归一化到 uploads 目录下。
* 省略或 null 时默认为 `/mnt/session/uploads/<源 File 的 file_id>`。
* 路径会折叠 . 段与多余斜杠、拒绝 .. 越界，结果 ≤1024 UTF-8 字节；多个 File Resource 的路径之间不得重叠。
* 实际生效路径以响应 **resources\[].mount\_path** 的返回值为准。

一个会话最多挂载 500 个 File Resource。挂载时服务端会把源 File 复制为会话范围（scope）的 File，因此响应中的 **file\_id** 可能与你传入的不同。

会话创建后也可以追加挂载：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/resources" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d "{
    \"type\": \"file\",
    \"file_id\": \"$FILE_ID\",
    \"mount_path\": \"/data/extra.csv\"
  }"
```

配套接口：**GET /v1/sessions/:id/resources**（列出，limit 1–1000）、**GET .../resources/:resourceId**（详情）、**DELETE .../resources/:resourceId**（卸载）。File Resource 当前不支持更新（POST 返回 400）；已归档会话不可增删资源。

常见输入：表格与原始数据、需要 Agent 阅读的文档、用户上传的附件。系统提示词里写清挂载路径，例如「输入数据在 /mnt/session/uploads/data/sales\_data.csv」。

## 将图片交给模型

上传图片后，可在消息中使用 `{"type":"image","source":{"type":"file","file_id":"file_example"}}`，由模型直接理解图片，无需先挂载为沙箱文件。图片仍需满足[图片输入](events.md#图片输入)的格式、大小与模型要求；Files 的 500 MB 上传上限不等于模型图片输入上限。

需要 Agent 通过代码处理图片时，仍按上文挂载 File Resource。输入文件的 `downloadable:false` 不妨碍在有权访问时作为图片来源。

## 产物：列出并下载

Agent 把要交给你的文件写入 **/mnt/session/outputs**（读写）。平台会把该目录中的文件编目为会话范围的 File，之后即可列出并下载：

```bash theme={null}
curl -sS "$BASE_URL/v1/files?scope_id=$SESSION_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

```bash theme={null}
curl -sS -L "$BASE_URL/v1/files/$FILE_ID/content" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -o report.xlsx
```

会话范围的 File 在 list/get 响应中带 **scope** 字段（`{"type": "session", "id": "sess_..."}`）；组织级上传的 File 无 scope。列表分页用 **before\_id** / **after\_id** 游标（互斥），limit 默认 20、最大 1000。

> [!TIP]
>
> 在系统提示词或用户消息里写明产出路径，例如：「把最终报告保存到 /mnt/session/outputs/report.xlsx」。写在 /workspace 的中间文件不会被编目，下载不到。

常见产物：分析报告、导出表格、图表与文档。等到 **session.status\_idle** 再列出 outputs，避免文件还在写入。

## 文件接口一览

| 接口 | 说明 |
| - | - |
| POST /v1/files | 上传文件（multipart），用作输入 |
| GET /v1/files | 列出文件；**scope\_id** 过滤某个会话的产物 |
| GET /v1/files/:fileId | 获取文件元数据 |
| GET /v1/files/:fileId/content | 下载文件内容（仅 **downloadable** 为 true 的会话产物） |
| DELETE /v1/files/:fileId | 删除文件（返回 `{id, type: "file_deleted"}`） |

## 新协议的列表分页

新协议返回 data 和 next\_page；将 next\_page 原样放进下一请求的 page，保留 scope\_id 与 limit。before\_id/after\_id 为兼容入口；与 page 同时发送时，page 优先（SDK 翻页会保留原参数）。ids/ids\[] 可按 ID 批量查询，去重后最多 100 项，不能与 page/limit/before\_id/after\_id 同用。旧协议仍返回 has\_more/first\_id/last\_id。File 新协议带 expires\_at:null，当前无自动过期。

Session resources 是 file / memory\_store / github\_repository 的联合列表；File Resource 的 POST 更新仍不支持，仓库同一路径的 POST 只支持 token 轮换。运行产物可在 Session idle 后做有限等待，不要把一次空列表当作输出文件永远丢失。

## 下一步

> **[创建会话](create-session.md)**
>
> resources 数组的完整字段

> **[预装沙箱环境](sandbox-reference.md)**
>
> uploads / outputs / workspace 目录契约

> **[最佳实践](examples.md)**
>
> 数据分析场景里如何接输入与产物

> **[本页对应 OpenAPI](api-reference.md#files)**
>
> File：上传、列出、下载


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.