---
source: https://docs.bigmodel.cn/cn/managed-agents/webhooks
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Webhook 通知

> 在控制台订阅资源变化，在业务系统中接收并处理通知。

Webhook 将资源的重要变化发送到你的 HTTPS 接收服务，例如会话等待审批、定时任务未能启动，或 OAuth 凭据刷新失败。你在控制台配置订阅，接收服务负责验签、去重、回查资源和后续业务处理。

需要展示 Agent 的逐步输出和工具调用时，使用[事件与流式输出](events.md)。Webhook 通知覆盖 Session、Agent、Deployment、Vault 等资源，与 Session 事件流使用不同的事件名。

## 在控制台配置

在控制台进入 **Managed Agents → Webhooks**，创建并管理接收端点。

**1. 创建端点**

点击创建，填写服务的 HTTPS 接收地址，可选填名称和描述。接收地址必须使用 443 端口和公网可解析的域名，不接受 IP、localhost、内部保留域名、用户名密码或 fragment。

**2. 选择订阅事件**

按业务需要选择至少一种事件，例如在会话停下来时通知业务系统，选择 `session.status_idled`。事件选择器按资源分类，只会投递已订阅的类型；保存前检查所选清单。

**3. 保存签名密钥**

创建后端点立即启用。复制弹窗中显示的 `whsec_` 签名密钥，安全保存并配置到接收器。密钥只在创建或轮换时显示，关闭弹窗后不能再次查看。

**4. 验证接收**

配置好接收器后，再触发一次已订阅的业务操作，例如发起新的会话执行。确认接收器收到通知、验签通过并可靠保存后，再接入实际业务。

**接收地址创建后不能修改。** 服务地址变化时，按[迁移接收地址](#迁移接收地址)创建新端点并验证，再删除旧端点。

### 管理已有端点

| 操作 | 控制台方式 |
| - | - |
| 编辑订阅 | 打开端点详情，点击编辑，重新勾选事件类型并保存；保存后的清单替换原订阅。名称和描述也可在这里修改 |
| 禁用与启用 | 在端点操作菜单选择禁用或启用；禁用期间不接收新通知，重新启用不补发历史事件 |
| 轮换签名密钥 | 在端点操作菜单选择轮换，立即复制新密钥并同步接收器；没有新旧密钥并行生效的宽限期 |
| 删除端点 | 在端点操作菜单选择删除，确认删除目标；不再需要的端点删除后释放数量额度 |

每租户默认最多 10 个端点，可由平台调整。达到上限时，控制台会提示无法继续创建；禁用仍占额度，删除后释放。订阅覆盖本租户所选类型；如只处理特定 Session 或 Agent，在接收器中按资源 ID 筛选。

先配置订阅，再触发业务。平台不补历史通知；Session 执行链启动时读取订阅配置，中途修改不保证影响已启动的执行。同一地址可注册多个端点，各自使用独立密钥，订阅重叠时会分别投递。创建端点只校验地址格式，投递时才检查 DNS 是否解析到公网地址。

## 接收通知

平台以 **HTTPS POST** 发送 `application/json`。接收服务需要读取原始请求体，验证以下请求头，再解析事件：

| 请求头 | 含义 |
| - | - |
| `webhook-id` | 与请求体顶层 `id` 相同的事件 ID |
| `webhook-timestamp` | 本次投递的 Unix 秒级时间戳 |
| `webhook-signature` | `v1,` 加上 Base64 编码的 HMAC-SHA256 摘要 |

### 通知内容

```json theme={null}
{
  "type": "event",
  "id": "whe_example",
  "created_at": "2026-10-19T08:00:00.000Z",
  "data": {
    "type": "session.status_idled",
    "id": "sess_example",
    "organization_id": "customer_example",
    "workspace_id": "customer_example"
  }
}
```

| 字段 | 接收器如何使用 |
| - | - |
| 顶层 `id` | 标识事件，用于去重；同一事件的重试保持该值不变 |
| `created_at` | 事件发生时间，不是本次投递时间 |
| `data.type` | 判断事件类型，分派到对应业务处理逻辑 |
| `data.id` | 发生变化的资源 ID，用于回查资源 |

通知不含完整资源。回查得到的是**当前状态**，可能与事件发生时不同；不要根据通知到达顺序推算当前状态。删除类事件发生后资源已无法回查，通知本身就是删除的依据。

### 验证签名

签名遵循 Standard Webhooks：移除密钥的 `whsec_` 前缀，将剩余部分按标准 Base64 解码为密钥字节，签名输入为 `webhook-id.webhook-timestamp.原始请求体`。**必须使用原始请求体字节**，不要先解析 JSON 再序列化。

下面的函数校验签名与 5 分钟时间戳容差，使用恒定时间比较摘要。密钥从接收器的安全配置读取；Node.js 传入原始 `Buffer`，Python 传入 `bytes`。在 Flask 中可用 `request.get_data()` 获取原始字节，`request.headers` 传给验签函数。

**Node.js**

```javascript theme={null}
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhook(rawBody, headers, secret) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (typeof id !== 'string' || typeof timestamp !== 'string' ||
      typeof signatures !== 'string' || !/^\d+$/.test(timestamp) ||
      !secret.startsWith('whsec_')) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.slice(6), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`).update(rawBody).digest();
  return signatures.split(/\s+/).some(part => {
    if (!part.startsWith('v1,')) return false;
    const supplied = Buffer.from(part.slice(3), 'base64');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
```

**Python**

```python theme={null}
import base64
import binascii
import hashlib
import hmac
import re
import time


def verify_webhook(raw_body: bytes, headers, secret: str) -> bool:
    headers = {name.lower(): value for name, value in headers.items()}
    event_id = headers.get("webhook-id")
    timestamp = headers.get("webhook-timestamp")
    signatures = headers.get("webhook-signature")
    if not all(isinstance(value, str)
               for value in (event_id, timestamp, signatures)):
        return False
    if not isinstance(secret, str) or not secret.startswith("whsec_"):
        return False
    if not re.fullmatch(r"[0-9]+", timestamp):
        return False
    try:
        if abs(int(time.time()) - int(timestamp)) > 300:
            return False
        key = base64.b64decode(secret[6:], validate=True)
    except (ValueError, binascii.Error):
        return False
    if not key:
        return False
    signed = f"{event_id}.{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(key, signed, hashlib.sha256).digest()
    for part in signatures.split():
        if not part.startswith("v1,"):
            continue
        try:
            supplied = base64.b64decode(part[3:], validate=True)
        except (ValueError, binascii.Error):
            continue
        if hmac.compare_digest(supplied, expected):
            return True
    return False
```

## 确认接收与幂等处理

1. **先验签。** 签名无效或时间戳过期时，返回 `400` 或 `401`，不执行事件中的业务动作。
2. **可靠保存后再确认。** 验签通过后解析 JSON，以顶层 `id`（也就是 `webhook-id`）为唯一键，将通知幂等地持久化或写入可靠队列，再尽快返回 `2xx`。若保存失败，不要提前确认接收，应返回失败状态让平台按规则重试。
3. **后台处理。** 资源回查、发送提醒等耗时操作在后台完成。平台只根据 HTTP 状态判断送达，不读取响应体，也不知道你的后台业务是否完成。

已可靠接收过的重复通知也应返回 `2xx`。去重记录与业务处理状态应能跨接收服务重启保留；仅在进程内记录事件 ID 不能保证幂等。

## 收到通知后如何处理

根据 `data.type` 选择处理方式。这里查询的是 Session、Thread、Run 或凭据等业务资源，相关接口见下列指南。

| 通知 | 建议处理 |
| - | - |
| `session.status_idled` | 回查 [Session](session-operations.md#获取会话) 当前状态，并查看对应一轮的[事件历史](events.md#集成事件)。通过 `session.status_idle.stop_reason` 区分等待审批或工具结果、重试耗尽、模型拒答；正常结束与用户中断还需结合消息和产物判断 |
| `session.thread_*` | `data.id` 是 Session ID，`data.session_thread_id` 是子线程 ID。通过 [Thread 接口](threads.md#五个接口)查看该子线程的详情和事件；单个子线程停下不等于整个任务完成 |
| `deployment_run.succeeded` | 回查 [Deployment Run](deployments.md#查看运行记录) 取得 `session_id`，继续跟踪 Session 的执行与产物；该通知仅表示成功创建会话 |
| `deployment_run.failed` | 回查 [Deployment Run](deployments.md#查看运行记录) 的错误详情，再触发告警或修正定时任务配置 |
| `vault_credential.refresh_failed` | 用 `data.id` 与 `data.vault_id` 定位凭据及所属 Vault，通知管理员检查 [OAuth 凭据](vaults.md#验证-mcp-oauth)，必要时重新授权或更新凭据 |
| `*.deleted` | 资源已经删除，直接依据通知清理本地引用或更新记录，不再等待资源查询成功 |

`session.status_idled` 不代表任务成功。停止原因在会话事件中，Session 详情不返回该字段；中断也会以 `end_turn` 收口，是否完成任务仍需结合消息、错误和产物判断。

## 支持的事件

当前支持以下 33 种事件，在控制台的事件选择器中按资源类型选择。Webhook 与 Session 事件流的名称不同，例如事件流的 `session.status_idle` 对应 `session.status_idled` 通知。

**Session 事件**

| 事件 | 何时通知 |
| - | - |
| `session.status_run_started` | 会话进入运行状态；同一会话可以多次触发。 |
| `session.status_idled` | 会话回到空闲，包括等待用户输入或审批；不表示业务任务一定成功。 |
| `session.status_terminated` | 会话被终止，例如归档或遇到不可恢复错误。 |
| `session.updated` | 会话属性发生更新。 |
| `session.deleted` | 会话被删除，通知本身作为删除依据。 |
| `session.thread_created` | 创建子线程，例如委派 Agent 或发起顾问咨询。 |
| `session.thread_idled` | 子线程回到空闲。 |
| `session.thread_terminated` | 子线程被终止，例如归档或顾问咨询结束。 |

Session 的开始和空闲表示所有线程的聚合变化，最后一个运行线程停下才发 Session 空闲通知。子线程事件额外包含 `data.session_thread_id`，`data.id` 仍为 Session ID；主线程不发这三种子线程通知。

**Vault 事件**

| 事件 | 何时通知 |
| - | - |
| `vault.created` | 创建 Vault。 |
| `vault.archived` | 归档 Vault，同时为下属凭据各发一条归档通知。 |
| `vault.deleted` | 删除 Vault，同时为下属凭据各发一条删除通知。 |
| `vault_credential.created` | 创建凭据。 |
| `vault_credential.archived` | 归档凭据，包括随 Vault 归档。 |
| `vault_credential.deleted` | 删除凭据，包括随 Vault 删除。 |
| `vault_credential.refresh_failed` | OAuth 刷新受到确定性拒绝，需要检查凭据或配置。 |

凭据事件额外包含 `data.vault_id`。暂时网络故障不触发 `refresh_failed`；同一份认证信息持续失败只通知一次，成功刷新或更新认证信息后可再次触发。通知不会自动归档凭据。

**Agent 事件**

| 事件 | 何时通知 |
| - | - |
| `agent.created` | 创建 Agent。 |
| `agent.updated` | 发布 Agent 新版本；未产生新版本的更新不触发。 |
| `agent.archived` | 归档 Agent；关联 Deployment 各自另发归档通知。 |

**Deployment 事件**

| 事件 | 何时通知 |
| - | - |
| `deployment.created` | 创建定时任务。 |
| `deployment.updated` | 更新定时任务属性，例如调度配置。 |
| `deployment.paused` | 暂停定时任务，包括主动暂停和不可恢复错误导致的自动暂停。 |
| `deployment.unpaused` | 恢复定时任务。 |
| `deployment.archived` | 归档定时任务，包括所属 Agent 归档引起的级联归档。 |

限流等可恢复失败不会因此自动暂停定时任务。

**Deployment Run 事件**

| 事件 | 何时通知 |
| - | - |
| `deployment_run.started` | 一次定时运行被触发。 |
| `deployment_run.succeeded` | 本次定时运行成功创建 Session。 |
| `deployment_run.failed` | 本次定时运行未能创建 Session。 |

仅定时触发发送这组通知，手动触发不发送。`succeeded` 不表示 Agent 已完成任务：查看 Run 关联的 Session，继续跟踪执行结果。同次运行的通知使用相同的 Run ID。

**Environment 事件**

| 事件 | 何时通知 |
| - | - |
| `environment.created` | 创建环境。 |
| `environment.updated` | 环境至少一个字段实际发生变化；提交相同内容不触发。 |
| `environment.archived` | 归档环境；重复归档不触发。 |
| `environment.deleted` | 删除环境。 |

**记忆存储事件**

| 事件 | 何时通知 |
| - | - |
| `memory_store.created` | 创建记忆存储。 |
| `memory_store.archived` | 归档记忆存储。 |
| `memory_store.deleted` | 删除记忆存储。 |

记忆存储的更新、单条 Memory 及 Memory Version 的变化不产生 Webhook。

## 投递行为

| 规则 | 平台行为 |
| - | - |
| 成功 | 任意 `2xx` 视为送达，不读取响应体；清空连续失败计时 |
| 超时 | 单次请求最多等待 15 秒 |
| 重试 | 除立即禁用的情形外，每个事件对每个端点最多尝试 3 次，含首次；两次重试分别等待约 5–10 秒、20–40 秒 |
| 重试内容 | 事件 ID、内容与 `created_at` 不变，每次重新生成投递时间戳与签名 |
| 积压保护 | 超过 20 分钟的待发通知会被放弃 |

通知可能重复、乱序或最终丢失。当前不提供测试投递、投递记录查询、手动补发或历史重放。Webhook 不作为持久化变更日志；需要完整状态核对的业务，应定期查询相关资源。

## 端点维护与排查

### 自动禁用与恢复

在控制台列表或详情中查看端点是否启用。端点被自动禁用时，可按下表检查接收服务；无法定位原因时，提供端点 ID 和发生时间联系支持人员。

| 自动禁用原因 | 触发条件 | 处理方式 |
| - | - | - |
| 接收服务返回重定向 | 收到 `3xx` 后立即禁用，不跟随跳转 | 让已注册地址直接接收 POST；地址迁移时创建新端点 |
| DNS 解析到不允许的地址 | 投递前发现非公网等不安全地址，立即禁用 | 修复域名解析和服务公网地址 |
| 持续投递失败 | 连续失败满 24 小时，在后续失败处理时触发 | 检查接收服务、验签配置和响应状态 |

单条通知三次失败不会立即造成“持续失败”禁用；一次成功投递会清空连续失败计时。修复问题后，在端点操作菜单中选择启用，会清空失败计时与自动禁用原因。恢复不会补发停用期间或已放弃的通知。

### 迁移接收地址

接收地址创建后不能修改。服务迁移时：

1. 在控制台创建使用新地址的端点，选择需要的事件。
2. 给新接收器配置该端点的签名密钥。
3. 触发一次订阅事件，验证新地址接收、验签与确认正常。
4. 再从控制台删除旧端点。

新旧端点同时启用且订阅重叠期间，两端都会收到通知。禁用或删除不能撤回已发出的请求。

### 轮换签名密钥

密钥丢失或需要替换时，在控制台的端点操作菜单中选择轮换，复制一次性显示的新密钥，并尽快更新接收器配置。

平台没有新旧密钥同时生效的宽限期。轮换后新准备的请求使用新密钥，已签名的在途请求仍可能使用旧密钥。轮换不会改变端点是否启用，也不会清空连续失败计时。

### 常见问题

| 问题 | 先检查 |
| - | - |
| 创建端点失败 | 接收地址是否符合 HTTPS、443 和公网域名要求；端点数量是否达到上限 |
| 没有收到通知 | 端点是否启用、事件是否已订阅；是否在订阅后才触发新的业务操作；接收服务与网络是否可用 |
| 验签失败 | 是否使用对应端点的密钥和原始请求体；是否做了 Base64 解码；接收器时钟是否准确；是否刚轮换密钥 |
| 重复收到通知 | 先比较顶层事件 ID，确认是否为重试或重叠订阅；已可靠保存的重复事件也返回 `2xx` |
| 收到通知但任务未完成 | 检查对应资源、事件历史与业务产物；不要把 idle、HTTP 确认或 Run 创建会话成功当成业务成功 |

如仍需排查，可在控制台详情中复制端点 ID，连同资源 ID 和发生时间提供给支持人员；不要提供签名密钥。

## 下一步

> **[定时任务](deployments.md)**
>
> 配置定时运行并通过通知跟踪结果

> **[事件与流式输出](events.md)**
>
> 实时查看 Agent 输出并处理审批


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.