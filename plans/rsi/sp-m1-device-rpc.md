# SP-M1 — 设备 RPC 通道（device WS 结构化 request/reply）

## 背景与动机

device WS（`/ws/device/{device_id}`）目前只承载 `im_message`/`im_reply` 纯文本回合
（`gateway/app.py:415-454`，`gateway/client.py:152-220`）。手机 APP 需要结构化数据面
（会话列表、消息拉取、审批查询/响应），必须先有一条通用 RPC 通道。

## 方案

### 协议扩展（gateway/app.py + device_manager.py）

- Gateway→桌面：`{"type": "device_rpc", "correlation_id": cid, "method": "...", "params": {...}}`
- 桌面→Gateway：`{"type": "rpc_reply", "correlation_id": cid, "ok": true, "data": {...}}`
  或 `{"ok": false, "error": "..."}`
- `DeviceManager` 增加通用等待/唤醒：`wait_for_rpc_reply(cid, timeout) -> Optional[dict]`
  与 `resolve_rpc_reply(cid, payload)`（与现有 GatewayReply 等待器平行，互不干扰，
  参考 `device_manager.py:91-108` 现有实现模式）。
- `ws_device` 循环（`app.py:447`）增加 `rpc_reply` 分支。

### 桌面端方法分发（gateway/client.py）

`GatewayClient._consume_loop` 增加 `device_rpc` 分支 → `_handle_device_rpc(ws, cid, method, params)`
→ 方法表：

| method | 实现 | 返回 |
|---|---|---|
| `sessions.list` | GET `{studio}/api/sessions` | 会话数组（原样透传） |
| `session.messages` | GET `{studio}/api/session/messages?session_id=` | 消息数组（原样透传） |
| `session.send` | 重构后的 `_execute_chat_turn`（见下） | `{reply, progress, pending_confirm}` |
| `confirm.pending` | `_PENDING_CONFIRMS.list_for_sender(sender_key)` | 待确认数组 |
| `confirm.respond` | `_handle_confirm_command` 逻辑复用 | `{ok, message}` |

sender_key 约定：`mobile:{install_id}`（install_id 由 RPC params 传入），
与 IM 的 `{source}:{sender_id}` 完全同构，PendingConfirmStore 零改动。

### `_execute_turn` 重构（唯一有回归风险点）

把 `client.py:222-367` 的 SSE 采集核心抽成 `_execute_chat_turn(msg) -> TurnResult`
（dataclass：`text`、`progress_lines`、`pending_confirm`），`_execute_turn`（IM 用）
与 `session.send`（RPC 用）都调它。IM 侧输出格式（进度块拼接、待确认 hint 文本）
保持逐字节不变。

## 验收标准

- 新增契约测试（fake studio server + fake device WS，不联网）：
  - `sessions.list` / `session.messages` 透传正确
  - `session.send` 正常回合 → reply + progress；`confirm_required` 回合 → pending_confirm
  - `confirm.pending` / `confirm.respond` 往返
  - 未知 method → `ok:false` + error，不炸连接
- IM 回归：现有 gateway 相关测试全绿；`_execute_turn` 文本输出与重构前一致（对照测试）。
- `pytest agenticx/gateway -x` 全绿；提交 AgenticX main。

## 非目标

- 流式输出（RPC reply 一次性返回整回合）
- 手机鉴权（M2 做）
