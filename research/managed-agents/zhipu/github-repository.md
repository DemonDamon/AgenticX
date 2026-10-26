---
source: https://docs.bigmodel.cn/cn/managed-agents/github-repository
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 访问 GitHub 仓库

将 GitHub 仓库声明为 Session Resource，Agent 可以在云沙箱中读代码、修改工作树，并在凭据授权范围内执行 git 操作。仓库资源与 GitHub MCP 是两种接法：前者提供工作树，后者提供远程工具。

## 创建带仓库的 Session

创建前准备一个权限最小化的 GitHub PAT。即使访问公开仓库，当前资源字段也要求 authorization\_token。

```bash theme={null}
session=$(curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "agent":"$AGENT_ID","environment_id":"$ENVIRONMENT_ID",
  "resources":[{
    "type":"github_repository","url":"https://github.com/OWNER/REPO",
    "authorization_token":"$GITHUB_TOKEN","mount_path":"/workspace/project",
    "checkout":{"type":"branch","name":"main"}
  }]
}
EOF
)
SESSION_ID=$(jq -r '.id' <<< "$session")
```

先建立 SSE，再发“检查 /workspace/project 的 README 和测试，给出修改建议”。声明资源保存成功不等于 clone 成功；通过实际 Session 与 session.error 检查准备结果。

| 字段 | 要求 |
| - | - |
| url | `https://github.com/OWNER/REPO`；不带 `.git` 后缀，最长 2048 字符 |
| authorization\_token | 必填、最长 4096 字符；响应不回显 |
| mount\_path | 可省略，默认 /workspace/REPO；规范化后必须在 /workspace 内 |
| checkout | 可省略/null 使用默认分支；branch + name 或 commit + sha |

## 轮换凭据

仓库只能在创建 Session 时声明，不能通过 resources 新增接口追加。通过资源列表取实际 resource ID 后，可轮换 authorization\_token：

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/resources/$RESOURCE_ID" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{"authorization_token":"$NEW_GITHUB_TOKEN"}
EOF
```

POST 此路径仅支持仓库凭据轮换，File Resource 不支持更新。当前也不支持通过资源删除接口移除仓库；要改变仓库集合创建新 Session。已归档 Session 不允许轮换。Deployment resources 当前不接受 github\_repository。

## 工作树、Skills 与隔离

首个工作环境准备时 clone/fetch，之后尽量恢复 Session 自己的工作树。有仓库资源时 checkpoint 默认开启；显式 x-checkpoint:false 可关闭，但跨轮可能需要重新准备。深历史操作可能受浅克隆影响。

仓库内 .claude/skills 会按需发现；显式挂载的 Skill 可能覆盖同名目录。凭据不会以原文放进沙箱或响应，只在声明仓库的 git 出站路径中使用；不会自动授权 GitHub REST API 或其他仓库。

> [!WARNING]
>
> 仓库缓存按 customer 隔离，同 customer 的多个 Session 可复用含私有代码的缓存；重新 fetch 失败时已有工作树可能保留。不同终端用户共享同一个 API customer 时，不能把各自 PAT 权限当作缓存内容的隔离边界。需要隔离时使用不同 customer，并只声明本次授权的仓库。


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.