---
source: https://docs.bigmodel.cn/cn/managed-agents/protocol-versions
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 协议版本与兼容

当前新接入请直接复制下面这组请求头；不要把日期改成“看起来更新”的值。只有平台发布新的兼容组合时，才按兼容说明一起升级。

```bash theme={null}
BASE_URL=https://agent-api.bigmodel.cn/api/agent/managed
curl -sS "$BASE_URL/v1/agents?limit=20" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

## 为什么两个头的日期不一样

它们不是同一个“最新版本”字段，而是两层兼容控制：

| 请求头 | 当前值 | 负责什么 | 能不能互相替代 |
| - | - | - | - |
| `zai-version` | `2026-05-26` | API 入口要求的基础协议标识，当前固定为此值 | 不能 |
| `zai-beta` | `managed-agents-2026-09-22` | 声明 Managed Agents Beta 协议，并选择返回字段与兼容行为的版本 | 不能 |

因此，新接入必须同时携带两个头：`zai-version` 满足基础协议校验，`zai-beta` 选择 Beta 协议的兼容形态。只写其中一个，不能通过另一项替代。旧客户端也可使用 `2026-05-26` 与 `managed-agents-2026-05-26` 这组已支持的组合。

当前推荐组合是 **`zai-version: 2026-05-26` + `zai-beta: managed-agents-2026-09-22`**。存量客户端可以在兼容期继续使用旧 Beta 值，但新代码应按本文示例接入。

## 两种 Beta 协议有什么区别

| 项目 | 2026-05-26 | 2026-09-22 |
| - | - | - |
| `agent.thinking` | 进度信号，不含思考文本 | 可含 `content` 文本块；订阅后可收到 Thinking delta |
| 工具结果图片 | 内置与 MCP 工具结果仅返回文本 | 可返回图片块，使用有效期 24 小时的 URL |
| `model.effort` 响应 | `"max"` 等字符串 | `{"type":"max"}` 等对象 |
| Skill 对象 | `display_title`、字符串 `source`、`latest_version` | `display_name`、`source:{type}`、`latest_version_id` |
| SkillVersion 对象 | 含 `version`、`directory` | `id` 是版本 ID；`name` 是目录名，省略旧字段 |
| Skill `latest` | 会话每次启动时解析 | 创建 Session 时固定；Deployment 每次触发时固定 |
| Agent 列表 | 缺省包含已归档 Agent | 缺省排除；可显式传 `include_archived=true` |
| Files 列表 | `data/has_more/first_id/last_id` | `data/next_page` |
| File 对象 | 无 `expires_at` | `expires_at:null`，当前不设文件过期 |
| Thread | `stats/usage` 按旧形态输出 | 尚未运行的 `stats/usage` 可为 null；`workflow_run_id:null` |
| Idle 事件 | 无 `stop_details` | `stop_details:null` |
| 创建成功状态码 | 使用 201 的创建接口仍回 201 | 这些接口回 200；按 2xx 判断成功 |
| Memory 冲突错误 | 通用 `conflict_error` | 可为 `memory_path_conflict_error` / `memory_precondition_failed_error` |

输入仍兼容字符串 effort，也接受 `{"type":"max"}`。新协议里 `web_fetch` 的 `url_sources:null` 是响应字段，不代表支持配置 URL 来源限制。

## 升级客户端

1. 将 `zai-beta` 切换为 `managed-agents-2026-09-22`。`zai-version` 保持 **2026-05-26**。
2. 按上表更新读取字段；列表循环使用 `next_page`，不要只读取第一页。
3. 对新字段与尚无用量的 null 值采用可选解析。创建请求按 2xx 判断成功。
4. 使用一个小 Session 验证事件、审批、产物与用量，再切换实际业务。

同时声明两种可识别的 beta 值时取较新版本。存量事件不会被重写；加密历史中的密文不能按旧版本删字段，解密后的客户端应容忍未知字段。

版本兼容不改变 Agent 的版本快照，也不等于获得账号尚未开放的能力。可用模型与计费资格仍按账号判断。


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.