---
source: https://ark.volcengine.com/region:cn-beijing/docs/upload-and-mount-files
fetched: 2026-10-24
title: 上传与挂载文件
---

# 上传与挂载文件

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍如何在方舟 Managed Agents 中上传和挂载输入文件、在 Session 运行时管理文件资源，以及查询 Agent 生成的产物。

Managed Agents 支持挂载通过 [文件输入(Files API)](https://ark.volcengine.com/docs/file-api) 或 [TOS 对象存储](https://docs.volcengine.com/docs/6349/74820?lang=zh) 上传的文件，再将文件作为 Session 资源挂载到沙箱环境目录中。Agent 可以读取这些输入文件，并将最终产物写入 `/mnt/session/outputs/`。

> **注意**
>
> 挂载 TOS 文件前，需要确保 TOS 和 Managed Agents 在同一火山账号中。

## 上传文件

你可以使用 Files API 或 TOS 上传需要被 Agent 读取的文件。

- 使用 Files API：

    先将本地文件上传到 Files API。上传成功后，平台会返回 `file_id`，后续创建 Session 或向运行中的 Session 追加文件资源时都需要使用该 ID。

> **说明**
>
> 设置 `purpose=agent`，指定该文件供 Agent 使用。

    ```Bash
    file=$(
      curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/files" \
        -H "Authorization: Bearer $ARK_API_KEY" \
        -F 'purpose=agent' \
        -F 'file=@path/of/your/file'
    )

    FILE_ID=$(jq -er '.id' <<<"$file")

    echo "File ID: $FILE_ID"
    ```

- 使用 TOS 上传：

    以下示例使用 TOS Python SDK 上传本地文件，更多使用方式，请参考 [TOS 官方文档](https://docs.volcengine.com/docs/6349/74820?lang=zh)。

    ```python
    import os
    import tos

    ak = os.getenv("TOS_ACCESS_KEY")
    sk = os.getenv("TOS_SECRET_KEY")

    endpoint = "tos-cn-beijing.volces.com"
    region = "cn-beijing"

    bucket_name = "<BUCKET_NAME>"
    object_key = "<OBJECT_KEY>"   # The path of the uploaded file. For example: agent-files/skill.md
    file_name = "/path/of/your/file"  # Local file path

    try:
        client = tos.TosClientV2(ak, sk, endpoint, region)

        result = client.put_object_from_file(
            bucket_name,
            object_key,
            file_name,
        )

        print("upload success")
        print("request_id:", result.request_id)
        print("etag:", result.etag)

    except tos.exceptions.TosClientError as e:
        print("client error:", e.message)
        print("cause:", e.cause)

    except tos.exceptions.TosServerError as e:
        print("server error code:", e.code)
        print("request_id:", e.request_id)
        print("message:", e.message)
        print("status_code:", e.status_code)
        print("request_url:", e.request_url)

    except Exception as e:
        print("unknown error:", str(e))
    ```

## 在创建 Session 时挂载文件

创建 Session 时，在 `resources` 数组中声明需要挂载的文件。

> **说明**
>
> 你也可以在 [Sessions 页面](https://ark.volcengine.com/region:cn-beijing/managed-agents/sessions?projectName=default) 创建 Session。

- 通过 Files ID 挂载：

每个文件资源至少需要包含 `type` 和 `file_id`。
`mount_path` 可选。建议设置 `mount_path`，让 Agent 可以从稳定、可读的路径访问文件。如果不显式指定路径，请确保上传文件名足够清晰，便于 Agent 识别文件用途。

```bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "resources": [
    {
      "type": "file",
      "file_id": "$FILE_ID",
      "mount_path": "target/mounting/path/of/the/file"
    }
  ]
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")

echo "Session ID: $SESSION_ID"
```

> **说明**
>
> `mount_path` 为云端沙箱中的目标挂载路径，通过 `file_id` 传入的文件将按照指定路径挂载到 `/mnt/session/uploads/` 目录中。
> 挂载时如指定 `my-skills/skill-1.md` 路径，挂载文件路径为 `/mnt/session/uploads/my-skills/skill-1.md`。

挂载后，平台会为该 Session 内的文件实例生成新的 `file_id`。这些 Session 内副本不计入用户的文件存储额度。

- 从 TOS 挂载：

```bash
session=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "agent": "$AGENT_ID",
  "environment_id": "$ENVIRONMENT_ID",
  "resources": [
    {
      "type": "tos",
      "tos_bucket": "<BUCKET_NAME>",
      "tos_key": "path/of/the/tos/directory/"
    }
  ]
}
EOF
)

SESSION_ID=$(jq -er '.id' <<<"$session")

echo "Session ID: $SESSION_ID"
```

> **说明**
>
> - `tos_key` 需为 TOS 桶中的一个目录，且必须以 `/` 结尾。例如 `project-resources/`。
> - 文件将被挂载至云端沙箱的 `/mnt/session/storage/` 目录中。

## 挂载多个文件

如果一次任务需要多个输入文件，可以在 `resources` 中添加多个条目。单个 Session 最多支持挂载 100 个文件。

以 Files ID 为例：

```json
"resources": [
  { "type": "file", "file_id": "<FILE_ID_1>" },
  { "type": "file", "file_id": "<FILE_ID_2>" },
  { "type": "file", "file_id": "<FILE_ID_3>" }
]
```

## 在 Session 运行时管理文件

Session 创建后，可以通过 Session Resources API 继续添加文件，并查询当前已挂载的资源。

以下示例沿用前面创建 Session 后写入的 `$SESSION_ID`；添加 Files API 文件时也沿用上传步骤写入的 `$FILE_ID`。

### 添加文件资源

```bash
resource=$(
  curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID/resources" \
    -H "Authorization: Bearer $ARK_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "type": "file",
  "file_id": "$FILE_ID"
}
EOF
)

RESOURCE_ID=$(jq -er '.id' <<<"$resource")

echo "Resource ID: $RESOURCE_ID"
```

### 查询文件资源

```Bash
# List session resources
curl -sS --fail-with-body "https://ark.cn-beijing.volces.com/api/v3/sessions/$SESSION_ID/resources" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

<span id="query-session-output-files"></span>
## 获取 Session 运行时产物

Agent 将需要交付的文件写入 `/mnt/session/outputs/` 后，平台会将这些文件注册为当前 Session 下 `purpose=agent` 的文件。需要在你的服务中展示或下载报告、图片、视频、文档或代码等产物时，通过 Files API 获取：

1. 调用 `GET /files?scope_id=<session_id>&purpose=agent`，分页查询该 Session 的 Agent 产物。
2. 从列表响应中获取文件 ID、文件名、文件大小、MIME 类型和 `download_url`。
3. 使用 `download_url` 下载文件内容。

Seedance Managed Agent 生成的图片和视频也遵循相同规则。生成工具会将最终产物写入 `/mnt/session/outputs/` 并注册到 Files API，业务系统通过 Session ID 查询和下载产物。

```Bash
# List files associated with a session.
curl -sS --fail-with-body \
  "https://ark.cn-beijing.volces.com/api/v3/files?scope_id=$SESSION_ID&purpose=agent" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

> **说明**
>
> `scope_id` 只筛选当前 Session 下已注册为 `purpose=agent` 的输出产物，不包含通过 `resources` 挂载到 `/mnt/session/uploads/` 的输入文件副本，也不按 `/mnt/session/storage/` 中的用户 TOS 对象做目录扫描。查询挂载输入文件，调用 [查询会话资源列表](api/list-resources-api.md)。

列表响应中的 `download_url` 是服务端签发的预签名下载地址，具有时效性。

创建 Session 前，按产物的保留要求选择存储方式：

| 你的配置 | 产物位置 | 你需要做什么 |
| --- | --- | --- |
| 不配置 `config.tos` | 方舟公共 TOS | 在平台 TTL 到期前下载所需文件。删除 Session 时，平台会清理默认存储中的关联产物。 |
| 在 Environment 或 Session 覆写中配置 `config.tos` | 你的 TOS Bucket。平台从 outputs 目录注册产物时，Files API 写入前缀为 `{prefix}outputs/{env-id}/{session-id}/`；最终对象路径以响应中的 `tos.object_key` 为准 | 在 TOS 中管理对象生命周期。删除 Session 不会删除 Bucket 中的对象。 |

配置 Environment 产物存储及按 Session 临时覆写的方法，详情请参见 [配置产物存储](configure-cloud-environment.md#configure-output-storage) 和 [覆写产物存储](start-session.md#override-output-storage)。

> **说明**
>
> 需要保存 Agent 产物时配置 `config.tos`，对应 Files API 登记的输出产物存储位置。需要挂载输入或共享数据时配置 `resources` 中的 `type: tos`，对应沙箱内的 `/mnt/session/storage/`。

## 支持的文件类型

Agent 可以处理多种文件类型。常见类型包括：

- 源代码文件，例如 `.py`、`.js`、`.ts`、`.go`、`.rs` 等。
- 数据文件，例如 `.csv`、`.json`、`.xml`、`.yaml`。
- 文本文档，例如 `.txt`、`.md`。
- 归档文件，例如 `.zip`、`.tar.gz`；Agent 可以在沙箱中使用 bash 解压后处理。
- 二进制文件；是否能正确处理取决于沙箱内是否具备相应工具。

## 使用建议

- 挂载到沙箱中的文件是只读副本。Agent 可以读取这些文件，但不能直接修改原始上传文件。
- 如果任务需要产出修改后的版本，应将结果写入沙箱中的新路径。
- 需要回传的输出文件，应在任务说明中要求 Agent 写入 `/mnt/session/outputs/`。需要长期保存时，为 Environment 配置自己的 TOS Bucket，并在 TOS 中管理对象生命周期。
- 如果运行中的 Session 不再需要某个大文件，及时移除对应资源，减少后续工具调用的上下文干扰。
