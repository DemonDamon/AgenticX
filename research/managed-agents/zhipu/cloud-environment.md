---
source: https://docs.bigmodel.cn/cn/managed-agents/cloud-environment
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 配置运行环境

Environment 是会话沙箱的蓝图，不是一台正在跑的机器。你描述期望的预装包和出网策略，平台负责构建；创建一次即可在多个会话与定时部署里复用。

* **决定什么**：这个会话的沙箱里有哪些软件、能访问哪些外网。
* **你要做什么**：至少创建一份（会话必填 **environment\_id**）。大多数情况用默认即可：`cloud` + 无限制网络。只有要增装依赖或收紧出网时，才改 **packages** / **networking**。
* **改了谁受影响**：创建会话时配置被固化。之后改 Environment 只影响新会话，正在跑的不受影响。

必须引用你自己创建、未归档的 Environment。

## 控制台操作

进入 **Managed Agents → 环境**，创建环境并进入详情，配置软件包与网络策略。选择受限网络时填写允许访问的主机，并根据任务需要设置 MCP 与包管理器访问。

保存配置后，在新建会话时选择这个环境，运行一次真实依赖安装或外部访问任务验证。环境配置描述运行条件，不等于所有依赖均已验证可用；归档前检查是否仍被会话或定时任务引用。

## 创建 Environment

最简单的 Environment 只需要一个名字，配置全部取默认值（cloud 类型、无额外软件包、无限制网络）：

```bash theme={null}
environment=$(curl -sS "$BASE_URL/v1/environments" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "name": "default-env",
    "config": {
      "type": "cloud",
      "networking": {"type": "unrestricted"}
    }
  }')

ENVIRONMENT_ID=$(jq -r '.id' <<< "$environment")
```

响应中的 **config** 是规范化后的完整配置：**packages** 六个包管理器的列表都会出现（未声明为空数组），**networking** 回显生效的网络策略。

## 在会话中使用 Environment

创建会话时通过 **environment\_id** 引用：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d "{
    \"agent\": \"$AGENT_ID\",
    \"environment_id\": \"$ENVIRONMENT_ID\"
  }"
```

> [!TIP]
>
> **快照语义**：创建会话时，Environment 的当前配置会被固化为该会话的环境快照。此后对 Environment 的更新只影响之后创建的会话，不影响正在运行的会话。定时部署只保存引用，每次触发时按环境的当前配置固化进新会话。

## 配置选项

### 软件包（packages）

通过六个包管理器声明沙箱中要预装的软件包，服务端排序去重后按 **apt → cargo → gem → go → npm → pip** 的顺序安装：

```bash theme={null}
curl -sS "$BASE_URL/v1/environments" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "name": "data-analysis-env",
    "config": {
      "type": "cloud",
      "packages": {
        "apt": ["poppler-utils"],
        "pip": ["pandas", "matplotlib", "openpyxl"],
        "npm": ["typescript"]
      },
      "networking": {"type": "unrestricted"}
    }
  }'
```

约束：每个包管理器最多 200 项；每项最长 256 字符，不含空白或控制字符，不得以 **-** 开头。自定义 registry / source / index URL 与私有源凭据配置一律拒绝（400 Extra inputs are not permitted）。

### 网络（networking）

网络策略是二选一的 tagged union：

| 类型 | 行为 |
| - | - |
| **unrestricted** | 默认。可访问公网主机，但出站端口仍限 HTTP/HTTPS 80/443。 |
| **limited** | 只允许访问 **allowed\_hosts** 列出的主机；包管理器与 MCP 出网需单独放行。 |

```json theme={null}
{
  "type": "cloud",
  "packages": { "pip": ["requests"] },
  "networking": {
    "type": "limited",
    "allowed_hosts": ["api.example.com", "*.internal.example.com"],
    "allow_package_managers": true,
    "allow_mcp_servers": false
  }
}
```

limited 模式的字段：

* **allowed\_hosts**：最多 256 项；每项是主机名或 `*.example.com` 通配，不得带协议前缀、端口或路径（写 `github.com`，不要写 `https://github.com`）；服务端会小写化并排序去重。
* **allow\_package\_managers**：默认 false。limited 环境声明了 packages 时必须显式设为 true，否则返回 400。
* **allow\_mcp\_servers**：默认 false。是否放行 Remote MCP 服务器的出网连接。

unrestricted 模式下不得携带 limited 专属字段，未知字段一律 400。

## Environment 生命周期

| 操作 | 行为 |
| - | - |
| **更新** | POST /v1/environments/:id。**config** 整体替换（非深合并），metadata 键级合并。只影响之后创建的会话。已归档环境返回 400。 |
| **归档** | POST /v1/environments/:id/archive。阻止新的会话 / 部署绑定；仍引用它的会话在下一次消费环境的交互时被终止（不使用沙箱工具的纯模型会话豁免）。 |
| **删除** | DELETE /v1/environments/:id。不做引用计数：引用方在下一次使用时得到 not found，定时部署的下一次触发在创建会话阶段失败。删除前请确认没有活跃引用。 |

## 管理 Environment

```bash theme={null}
# 列出（分页，默认每页 20）
curl -sS "$BASE_URL/v1/environments" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"

# 查看单个
curl -sS "$BASE_URL/v1/environments/$ENVIRONMENT_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

## 预装运行时

无论是否声明 packages，云沙箱镜像都预装了常用的语言运行时与工具链（Python、Node.js、常见 CLI 工具等），完整清单见[预装沙箱环境](sandbox-reference.md)。packages 声明用于在这个基线之上增装依赖。

## 准备、缓存与能力边界

Environment 创建只是保存蓝图，state 为 active 不代表所有包已安装，也没有 ready 字段可轮询。首次使用时准备依赖，可复用包缓存；失败可能回退到基础环境并发 session.error，检查真实版本或目标任务再判断是否可用。常用依赖放 packages，临时安装不作为长期保证。

Multi Agent 使用同一 Session 的文件工作区，各线程执行上下文独立。Web Search/Fetch 由平台侧执行，不能把沙箱 allowed\_hosts 当作这两个工具已支持的域名过滤。GitHub 工作树与缓存边界见[访问 GitHub 仓库](github-repository.md)。

## 下一步

> **[预装沙箱环境](sandbox-reference.md)**
>
> 沙箱预装内容与目录结构

> **[创建会话](create-session.md)**
>
> 引用 Environment 启动会话

> **[定时任务](deployments.md)**
>
> 在定时任务中复用 Environment

> **[本页对应 OpenAPI](api-reference.md#environments)**
>
> Environment：创建、更新、归档


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.