# Admin Console API

> 源码根：`apps/admin-console/src/app/api/`  
> 页面根：`apps/admin-console/src/app/`

基址：`http://localhost:3001`

所有 `/api/admin/*`、`/api/policy/*`、`/api/audit/*`、`/api/metering/*` 路由需 admin session 且通过 RBAC scope 校验。

---

## 页面路由

| 路径 | 模块 |
|---|---|
| `/login` | 登录 |
| `/dashboard` | 概览 |
| `/iam`, `/iam/users`, `/iam/departments`, `/iam/roles`, `/iam/bulk-import` | 身份权限 |
| `/audit` | 网关审计 |
| `/metering`, `/metering/quota` | Token 用量 / 配额 |
| `/policy` | 策略规则中心 |
| `/admin/models` | 模型服务 |
| `/admin/channels` | Gateway Channel |
| `/settings/sso` | SSO Provider |

---

## Auth

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 管理台密码登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/session` | 当前 session |
| GET/POST | `/api/auth/sso/oidc/*`, `/api/auth/sso/saml/*` | SSO（同 portal） |

---

## IAM

| 方法 | 路径 | Scope 示例 |
|---|---|---|
| GET | `/api/admin/users` | `user:read` |
| POST | `/api/admin/users` | `user:create` |
| GET/PATCH/DELETE | `/api/admin/users/:id` | `user:read/update/delete` |
| POST | `/api/admin/users/:id/reset-password` | `user:manage` |
| GET/PUT | `/api/admin/users/:id/models` | `model:manage` — 可见模型分配 |
| GET/POST | `/api/admin/departments` | `dept:*` |
| GET/PATCH/DELETE | `/api/admin/departments/:id` | |
| GET/POST | `/api/admin/roles` | `role:*` |
| PATCH/DELETE | `/api/admin/roles/:id` | |
| GET | `/api/admin/roles/:id/users` | |
| POST | `/api/admin/iam/bulk-import` | CSV 批量导入 |

---

## 模型服务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/providers` | Provider 列表 / 创建 |
| GET/PATCH/DELETE | `/api/admin/providers/:id` | |
| POST | `/api/admin/providers/:id/test` | 连通性探活 |
| POST | `/api/admin/providers/:id/models` | 添加模型 |
| PATCH/DELETE | `/api/admin/providers/:id/models/:modelName` | 启用/禁用模型 |

Provider API Key 以 AES-GCM 加密存 `api_key_cipher`（密钥 `AGX_PROVIDER_SECRET_KEY`）。

---

## Gateway Channel

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/channels` | Channel CRUD |
| GET/PUT/DELETE | `/api/admin/channels/:id` | |
| GET | `/api/admin/channels/health` | 聚合 Channel 健康 |
| GET | `/api/gateway/health` | Gateway 进程探活 |

---

## 策略规则中心

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/policy/packs` | 规则包 |
| PATCH/DELETE | `/api/policy/packs/:code` | |
| GET/POST | `/api/policy/rules` | 规则（draft/active） |
| PATCH/DELETE | `/api/policy/rules/:id` | 软删除 → 灰显 + 恢复 |
| POST | `/api/policy/publish` | 发布快照 |
| GET | `/api/policy/publishes` | 发布历史 |
| POST | `/api/policy/publishes/:id/rollback` | 回滚 |
| POST | `/api/policy/test` | 样本测试（合并表单预览） |

---

## 审计

| 方法 | 路径 | Scope |
|---|---|---|
| POST | `/api/audit/query` | `audit:read:all` 或 `audit:read:dept` |
| POST | `/api/audit/export` | `audit:export` |
| GET | `/api/audit/chain-verify` | `audit:read:all` — checksum 链校验 |

---

## 计量

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/metering/query` | 四维查询 |
| POST | `/api/metering/export` | 导出 |
| GET/PUT | `/api/metering/quota` | 租户配额读写 |

---

## SSO Provider 管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/sso/providers` | Provider CRUD |
| PATCH/DELETE | `/api/admin/sso/providers/:id` | |
| POST | `/api/admin/sso/providers/:id/test` | 配置测试 |
| POST | `/api/admin/sso/providers/:id/health` | 健康检查 |
| GET | `/api/admin/sso/providers/stats` | 统计 |

Client secret 加密密钥：`SSO_PROVIDER_SECRET_KEY`。

---

## Internal API（Gateway 拉取）

见 [internal-api.md](./internal-api.md)。路径前缀 `/api/internal/`。

---

## 关键环境变量

| 变量 | 用途 |
|---|---|
| `ADMIN_CONSOLE_LOGIN_EMAIL` / `ADMIN_CONSOLE_LOGIN_PASSWORD` | 密码登录 |
| `ADMIN_CONSOLE_SESSION_SECRET` | Session 签名 |
| `GATEWAY_BASE_URL` | Gateway 健康检查 |
| `GATEWAY_INTERNAL_TOKEN` | Internal API Bearer |
| `GATEWAY_INTERNAL_BASE_URL` | Channel 健康聚合（注意与 gateway 8088 区分） |
| `AGX_PROVIDER_SECRET_KEY` | Provider Key 加密 |
| `SSO_PROVIDER_SECRET_KEY` | SSO secret 加密 |
