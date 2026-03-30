# IM 远程指令网关 — 部署与配置

Author: Damon Li

本文说明如何部署 `agx gateway`、配置飞书/企业微信回调，以及在本机 `agx serve` 上启用网关客户端。

## 依赖

- **网关解密（飞书/企微加密事件）**：需要安装 `cryptography`：

  ```bash
  pip install cryptography
  ```

- **本机客户端 WebSocket**：已包含在 `agenticx` 依赖中的 `websockets`。

## 1. 启动网关服务（公网可达）

1. 复制 `docs/gateway/gateway_config.example.yaml` 为 `gateway_config.yaml` 并填写密钥。
2. 运行：

   ```bash
   agx gateway --config gateway_config.yaml
   ```

3. 将飞书事件订阅 URL 设为：`https://<你的域名>/webhook/feishu`
4. 将企业微信回调 URL 设为：`https://<你的域名>/webhook/wecom`

## 2. 飞书开放平台

1. 创建企业自建应用，启用「机器人」。
2. 权限：`im:message`、`im:message:send_as_bot`、接收消息事件。
3. 事件订阅：`im.message.receive_v1`。
4. 将 **Encrypt Key**、**Verification Token**、**App ID**、**App Secret** 填入 `gateway_config.yaml` 的 `adapters.feishu`。

## 3. 企业微信

1. 管理后台创建自建应用，记录 **AgentId**、**Secret**。
2. 接收消息：API 接收，配置 **Token**、**EncodingAESKey**、回调 URL。
3. 将 **CorpID**、**AgentId**、**Secret**、**Token**、**EncodingAESKey** 填入 `adapters.wecom`。

## 4. 本机 Machi / agx serve

在 `~/.agenticx/config.yaml` 增加（或通过 Machi **设置 → 服务器连接 → 远程指令** 保存）：

```yaml
gateway:
  enabled: true
  url: "https://your-gateway.example.com"
  device_id: "my-macbook"
  token: "与 gateway_config.yaml 中 devices.auth_tokens 一致"
  studio_base_url: ""   # 留空则使用 http://127.0.0.1:<AGX_SERVE_PORT>
```

启动本机服务：

```bash
agx serve --gateway
# 或设置 gateway.enabled: true 后仅 agx serve
```

## 5. 首次绑定 IM 账号

在网关配置的 `devices.auth_tokens` 中为设备配置 `binding_code`（如 `882291`）。在飞书/企微中向机器人发送：

```text
绑定 882291
```

成功后即可直接发送自然语言指令。

### 5.1 扫码连接（Machi 桌面）

在 **设置 → 服务器连接 → 远程指令** 中展开「高级配置」，填好网关基址、`device_id`、`token` 并保存后，可点击 **「扫码连接（飞书/企微）」**：

1. 桌面会向网关 `POST /api/connect/session`（使用当前设备的 `device_id` + `token` 鉴权），返回 `qr_url`（形如 `https://<网关>/connect/<session_id>`）。
2. 用手机扫描弹窗中的二维码，打开引导页，一键复制「绑定 &lt;绑定码&gt;」到飞书/企微机器人会话发送。
3. 弹窗轮询 `GET /api/connect/session/<session_id>`，状态依次为 `pending` → `scanned`（已打开引导页）→ `bound`（IM 侧绑定成功）。

**前提**：该设备在 `gateway_config.yaml` 的 `devices.auth_tokens` 中必须配置 **`binding_code`**，否则无法创建扫码会话。

**已绑定列表与解绑**（需设备 token）：

- `GET /api/device/<device_id>/bindings?token=<token>`
- `DELETE /api/device/<device_id>/bindings?token=<token>&platform=feishu&sender_id=<open_id>`

## 6. Siri / 快捷指令（HTTP）

向网关发送：

```http
POST /api/command
Content-Type: application/json
x-agx-command-secret: <command_api_secret 或与 token 相同>

{"device_id": "my-macbook", "text": "帮我总结桌面上的 notes.md"}
```

若未设置 `command_api_secret`，则使用 JSON 中的 `device_id` + `token`（与设备 token 一致）鉴权。

## 7. 多轮对话与指令

- 同一 IM 用户复用会话：`im-<平台>-<hash>`。
- 发送 `/新对话` 会删除该 IM 映射的会话并重新开始。
- `/状态`、`/取消` 见网关与客户端实现说明。
