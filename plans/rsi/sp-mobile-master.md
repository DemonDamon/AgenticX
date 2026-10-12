# SP-Mobile — Near 手机 APP（Android + iOS）Master Plan

## 背景与动机

用户需要一个手机 APP，远程查看/驱动 Near 桌面端的 agent 执行：会话列表、消息流、
审批（human-in-the-loop）、指令下发。参考对象 ccpocket（Flutter，MIT，交互可抄）、
happy（Expo，共享会话架构可抄）。

核心结论（已完成代码勘察）：**绑定与通信基础设施已全部存在**，手机端不需要新建底层协议：

| 已有设施 | 位置 | 现状 |
|---|---|---|
| 桌面→云端出站 WS | `agenticx/gateway/app.py:415` `/ws/device/{device_id}` | 桌面 `GatewayClient`（`client.py`）已连，天然穿透内网 |
| 指令下发+同步等回复 | `app.py:288` `/api/command`（IM 在用） | request/reply + 离线队列 |
| QR 扫码配对 | `app.py:345` `/api/connect/session` + `/connect/{sid}` 落地页；桌面 `QrConnectModal.tsx` | 闭环 |
| 用户↔设备绑定 | `user_device_map.py`（platform, sender_id → device_id） | 闭环 |
| 远程审批 | `im_confirm.py`（PendingConfirmStore）+ `client.py._handle_confirm_command` | IM 渠道在用 |
| 会话/消息 API | `studio/server.py`：`/api/sessions`(6154)、`/api/session/messages`(2168)、`/api/confirm`(2717)、`/api/chat`(2837) | 本地 REST，绑 127.0.0.1 |

**缺口只有一个**：现有 device WS 协议只有 `im_message`/`im_reply`（纯文本回合），
没有结构化 RPC（会话列表、消息拉取、审批查询），手机 APP 的数据面无从谈起。

## 技术选型（已定）

- **APP 框架：Expo（React Native）+ TypeScript 严格模式**。理由：开发主力是
  GLM 5.3 / Grok 4.7 级模型——TS/React 是语料密度最高的栈，模型错误被 Expo
  managed workflow 锁死在 JS 层；与 desktop/、enterprise/ 同栈，Gateway 协议
  TS 类型可直接复用。Flutter（用户口中的"Flute"）性能对 I/O 型 UI 无优势，
  Dart 语料薄，放弃。
- **目录**：新建 `mobile/`，与 `desktop/`、`enterprise/` 同级（用户指定）。
- **鉴权**：复用 device token + binding_code 体系，新增 mobile install token。
- **分发**：Android 自签 APK 直发；iOS 走 TestFlight（复用 DMG 已有的 Apple
  Developer 账号，新增 iOS Distribution 证书 + App ID，零新增年费）。

## 架构

```
手机 APP (mobile/, Expo)
   │  HTTPS: x-agx-mobile-token + install_id
   ▼
Gateway  /api/mobile/*          ← SP-M2 新增（鉴权 + 配对 + 桥接）
   │  device WS: device_rpc/rpc_reply   ← SP-M1 新增（结构化 RPC）
   ▼
Near 桌面端 GatewayClient → 本地 studio REST (127.0.0.1)
```

## SP 拆分与顺序

| SP | 内容 | 依赖 |
|---|---|---|
| SP-M1 | 设备 RPC 通道：device WS 协议扩展 + 桌面端方法分发（sessions/messages/send/confirm） | — |
| SP-M2 | Gateway `/api/mobile/*`：扫码绑定 + mobile token + RPC 桥接 | M1 |
| SP-M3 | `mobile/` Expo 工程骨架 + 扫码配对流程 | M2 |
| SP-M4 | 核心界面：会话列表 / 消息流 / 审批卡 / 指令输入 | M3 |
| SP-M5 | 打包发布：EAS + Android 自签 APK + iOS TestFlight | M4 |

## 全局验收与纪律

- 每个 SP：契约测试绿 + 不破坏 IM 链路（M1 特别要求：`_execute_turn` 重构后
  IM 行为零回归）+ 提交 AgenticX main。
- TypeScript 严格模式，不 eject、不手改原生层（managed workflow 纪律）。
- 模型可执行性优先：每步改动小、有测试护栏、失败可定位。

## 非目标（v1 明确不做）

- APNs/FCM 远程推送（审批提醒先靠 APP 内轮询；后续 SP-M6）
- 流式 token 输出（v1 发指令后等整回合回复，同 IM 语义）
- 企业多用户/权限模型、E2E 加密、多桌面设备管理 UI
