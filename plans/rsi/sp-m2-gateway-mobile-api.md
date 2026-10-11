# SP-M2 — Gateway 移动端 API 面（配对 + 鉴权 + /api/mobile/* 桥接）

## 背景与动机

SP-M1 打通了 device RPC，但 gateway 现有对外接口只服务 IM/Siri。手机 APP 需要：
自己的身份（install token）、扫码绑定入口、以及一组移动友好的 REST。

## 方案

### 配对与身份

- APP 首启生成 `install_id`（UUID，持久化）。扫码（QR 内容 = 桌面端
  `QrConnectModal` 已生成的 `{gateway}/connect/{session_id}` URL）后调：

  `POST /api/mobile/bind` `{connect_session_id, install_id, device_meta?}`

  → 校验 connect session（`connect_sessions.get`，pending/scanned 均可）→
  取其 device_id + binding_code → 登记 `user_map`（platform=`"mobile"`，
  sender_id=install_id，复用 `user_device_map.py`）→ 生成 `mobile_token`
  （secrets.token_hex(32)，与 device token 同级存储于 gateway config 的
  `devices.auth_tokens` 旁路：内存/文件 `mobile_tokens.json`）→ 返回
  `{device_id, mobile_token, desktop_name}`。connect session 标记 bound。

- 鉴权中间件：`/api/mobile/*` 统一要求头 `x-agx-mobile-token: <mobile_token>` +
  `x-agx-install-id: <install_id>` → 查 `user_map.get_device("mobile", install_id)`
  得 device_id，token 不匹配即 401。多设备绑定（一机扫多桌面）v1 不做，
  bind 时若 install_id 已绑定其它 device 则拒绝（提示先解绑）。

### 端点（全部桥接 SP-M1 RPC，`wait_for_rpc_reply`）

| 端点 | method | 备注 |
|---|---|---|
| `GET /api/mobile/status` | — | device_manager.is_online |
| `GET /api/mobile/sessions` | sessions.list | |
| `GET /api/mobile/sessions/{sid}/messages` | session.messages | |
| `POST /api/mobile/sessions/{sid}/send` | session.send | body `{text}`；timeout 取 cfg.reply_timeout（长任务可到 600s） |
| `GET /api/mobile/confirms` | confirm.pending | APP 轮询（v1 无推送） |
| `POST /api/mobile/confirms/{request_id}` | confirm.respond | body `{approved, reason?}` |
| `DELETE /api/mobile/bindings` | — | 解绑 + 吊销 mobile_token |

- 设备离线 → 503 `{"detail": "device offline"}`（与 `/api/command` 语义一致）。
- send 与 confirm 轮询是并发安全的：RPC 走 device WS，不占 IM 信号量。

## 验收标准

- 契约测试（fake device WS 模拟桌面）：bind（含重复绑定拒绝/无效 connect session
  404）→ 全端点往返 → 解绑后 401。token 鉴权负路径全过。
- 不触碰 IM 端点行为；`pytest agenticx/gateway -x` 全绿；提交 AgenticX main。

## 非目标

- 推送（APNs/FCM）、多设备管理、token 过期轮换（后续 SP）
