# Machi / AgenticX 错误码体系

本文档定义 **面向用户/support 的公开错误码**（`AGX-AUTH-*`）与 **官网 HTTP API 返回的机器可读字段**（`error`）之间的对应关系，便于客服、运维与研发对齐。

**适用范围（当前已落地）：**

- Machi **桌面端**：设置 → **账号** →「使用官网账号登录」流程（轮询 `agxbuilder.com` 设备绑定接口）。
- **AgenticX-Website**：`/api/auth/device/init`、`/api/auth/device/confirm`、`/api/auth/device/poll`。

**版本：** 2026-04-14（后续新增码在本表续写，勿复用已分配编号）。**增补：** `database_schema_missing` 等细分错误与 **AGX-AUTH-105～108**。

---

## 1. 命名与分层

| 层级 | 形式 | 说明 |
|------|------|------|
| **用户可见码** | `AGX-AUTH-NNN` | 仅出现在 Machi 桌面弹窗、客服话术、对外文档；**不向终端用户暴露** Vercel、SQL 路径、环境变量名等部署细节。 |
| **API 机器字段** | JSON 中的 `error`（snake_case） | 供客户端与日志检索；桌面端在映射后展示用户码。 |
| **HTTP 状态码** | `4xx` / `5xx` | 与 REST 语义一致；与 `error` 组合可唯一定位问题。 |

**编号段预留：**

| 段 | 用途 |
|----|------|
| `AGX-AUTH-1xx` | 桌面端：官网 `/init` 失败（无法开始浏览器登录） |
| `AGX-AUTH-2xx` | 桌面端：纯客户端状态（如等待超时） |
| `AGX-AUTH-3xx` | 预留：官网 `/confirm` / `/poll` 等 API 若未来需在桌面直接展示 |
| `AGX-AUTH-9xx` | 兜底 / 未归类（常附带原始子串） |

---

## 2. 用户可见码（桌面端已实现）

以下由 [`desktop/src/components/AccountTab.tsx`](../desktop/src/components/AccountTab.tsx) 在弹窗中展示。

| 用户码 | 用户主文案（摘要） | 典型触发 |
|--------|-------------------|----------|
| **AGX-AUTH-101** | 官网账号服务暂不可用，请稍后再试；若多次出现请联系支持。 | 云端未配置或未连通 `DATABASE_URL`，`/api/auth/device/init` 返回 `database_not_configured`（HTTP 503）。 |
| **AGX-AUTH-102** | 账号系统暂不可用，请稍后再试；若多次出现请联系支持。 | 云端未配置 Supabase 管理端密钥或 URL，`/api/auth/device/confirm` 等返回 `supabase_not_configured`（HTTP 503）。 |
| **AGX-AUTH-103** | 网络或服务异常，请检查网络后重试。 | `/init` 非 2xx（映射为 `init_http_<status>`）。 |
| **AGX-AUTH-104** | 服务暂时繁忙，无法开始登录。请稍后再试。 | `/init` 返回 `server_error`（HTTP 500），多为未单独归类的服务端异常；须对照 Vercel 日志。 |
| **AGX-AUTH-105** | 账号服务尚未完成初始化，无法开始登录。 | 库中缺少 `device_auth_requests` 或相关枚举等（`database_schema_missing`，HTTP 503）。**常见原因：未在 Supabase 执行** `AgenticX-Website/drizzle/0000_device_auth_requests.sql`。 |
| **AGX-AUTH-106** | 无法连接到账号数据库。 | 连接被拒绝、DNS、超时等（`database_connection_failed`，HTTP 503）。Vercel Serverless 建议对 Supabase 使用 **Transaction pooler** 连接串（端口 **6543**），避免直连会话模式在边缘函数下不稳定。 |
| **AGX-AUTH-107** | 与账号服务的安全连接异常。 | SSL / 证书校验失败（`database_ssl_error`，HTTP 503）。核对 `DATABASE_URL` 是否含 `sslmode=require` 等与托管方文档一致。 |
| **AGX-AUTH-108** | 账号数据库鉴权失败。 | 密码错误、`pg_hba` 拒绝等（`database_auth_failed`，HTTP 503）。核对连接串中的用户/密码是否为当前库凭证。 |
| **AGX-AUTH-199** | 无法开始官网账号登录。请稍后再试。 | 其它未知 `error` 或无法解析的响应。 |
| **AGX-AUTH-201** | 未在有效时间内完成官网登录确认。 | 桌面端轮询超时（约 6 分钟内未完成浏览器侧确认）。 |

---

## 3. 官网 API：`error` 字段与 HTTP 状态

### 3.1 `POST /api/auth/device/init`

| `error`（机器） | HTTP | 运维排查要点 |
|-----------------|------|--------------|
| `invalid device_id` | 400 | 请求体 `device_id` 非合法 UUID（桌面端应始终发 UUID）。 |
| `invalid_json_body` | 400 | 请求体非合法 JSON。 |
| `database_not_configured` | 503 | 未设置 `DATABASE_URL`（`getDb()` 抛错）。 |
| `database_schema_missing` | 503 | 表/枚举未创建；在目标库执行 `AgenticX-Website/drizzle/0000_device_auth_requests.sql`。 |
| `database_connection_failed` | 503 | 无法连上 Postgres（网络、池化、防火墙）。 |
| `database_ssl_error` | 503 | TLS/证书与库要求不一致。 |
| `database_auth_failed` | 503 | 凭据或 `pg_hba` 拒绝。 |
| `server_error` | 500 | 未归入上述类别的异常；查 Vercel 日志 `[auth/device/init]`。 |

### 3.2 `POST /api/auth/device/confirm`

| `error`（机器） | HTTP | 运维排查要点 |
|-----------------|------|--------------|
| `missing_bearer_token` | 401 | 缺少 `Authorization: Bearer <access_token>`。 |
| `invalid device_id` | 400 | 同上。 |
| `invalid_session` | 401 | Token 无效或过期；检查 Supabase 会话与浏览器登录态。 |
| `unknown_device` | 404 | 未先调用 `init` 或 `device_id` 与库中记录不一致。 |
| `expired` | 410 | 超过 TTL（当前 5 分钟）未完成确认；需从桌面重新发起登录。 |
| `invalid_json_body` | 400 | 请求体非合法 JSON。 |
| `database_not_configured` | 503 | 同 init。 |
| `database_schema_missing` 等 | 503 | 同 init 数据库类 `error`。 |
| `supabase_not_configured` | 503 | 配置 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`（及 anon 供前端）。 |
| `server_error` | 500 | 查日志 `[auth/device/confirm]`。 |

### 3.3 `GET /api/auth/device/poll`

| 响应形态 | HTTP | 说明 |
|----------|------|------|
| `{ ok: true, status: "unknown" }` | 200 | 尚无该 `device_id` 记录（可能尚未 init 或已被消费删除）。 |
| `{ ok: true, status: "pending" }` | 200 | 等待用户在浏览器完成登录与 confirm。 |
| `{ ok: true, status: "expired" }` | 200 | 已过期，需重新发起桌面登录。 |
| `{ ok: true, status: "completed", ... }` | 200 | 成功；响应中含 token，**仅应被桌面主进程拉取一次**（服务端随后删除行）。 |
| `error: "invalid device_id"` | 400 | 查询参数非法。 |
| `error: "database_not_configured"` | 503 | 同 init。 |
| `error: "database_schema_missing"` 等 | 503 | 同 init。 |
| `error: "server_error"` | 500 | 查日志 `[auth/device/poll]`。 |

---

## 4. 用户码 ↔ API 机器码（快速对照）

| 用户码 `AGX-AUTH-*` | 主要对应的 API `error` 或条件 |
|---------------------|-------------------------------|
| 101 | `database_not_configured` |
| 102 | `supabase_not_configured` |
| 103 | `init_http_*`（非 2xx） |
| 104 | `server_error` |
| 105 | `database_schema_missing` |
| 106 | `database_connection_failed` |
| 107 | `database_ssl_error` |
| 108 | `database_auth_failed` |
| 199 | 其它 / 未映射 |
| 201 | 客户端轮询超时（无独立 API `error`） |

---

## 5. 新增错误码流程（规范）

1. **先**在本文档分配 `AGX-AUTH-NNN` 与 API `error` 字符串（若涉及 HTTP）。  
2. **再**改 [`desktop/src/components/AccountTab.tsx`](../desktop/src/components/AccountTab.tsx) 的 `formatAgxLoginInitError`（或其它展示层）。  
3. **再**改 [`AgenticX-Website/src/app/api/auth/device/`](../AgenticX-Website/src/app/api/auth/device/) 下对应路由的 JSON 与 HTTP 状态。  
4. 客服知识库仅同步 **用户码 + 一句话用户说明**；运维使用 **机器 `error` + HTTP + 本文档 §3**。

---

## 6. 相关文件

| 路径 | 职责 |
|------|------|
| [`desktop/src/components/AccountTab.tsx`](../desktop/src/components/AccountTab.tsx) | 用户可见文案与用户码映射 |
| [`desktop/electron/main.ts`](../desktop/electron/main.ts) | `agx-account-login-start`、轮询、`agx_account` 写入 `config.yaml` |
| [`AgenticX-Website/src/app/api/auth/device/`](../AgenticX-Website/src/app/api/auth/device/) | 设备绑定 API 与机器 `error` |
| [`AgenticX-Website/src/lib/device-auth-errors.ts`](../AgenticX-Website/src/lib/device-auth-errors.ts) | 设备绑定 API 异常 → 机器 `error` 分类 |
| [`AgenticX-Website/.env.example`](../AgenticX-Website/.env.example) | 云端必填环境变量清单 |
