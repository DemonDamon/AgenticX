# Web Portal API

> 源码根：`apps/web-portal/src/app/api/`  
> 页面根：`apps/web-portal/src/app/`

基址：`http://localhost:3000`（生产替换为实际域名）

---

## 页面路由

| 路径 | 说明 |
|---|---|
| `/` | 有 session → `/workspace`，否则 → `/auth` |
| `/auth` | 登录 / 注册 / SSO |
| `/workspace` | 主聊天工作区 |

---

## Auth

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 邮箱密码登录 |
| POST | `/api/auth/register` | 注册（若启用） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/session` | 当前 session / claims |

### SSO — OIDC

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/sso/oidc/start?provider=<id>` | 302 跳转 IdP |
| GET | `/api/auth/sso/oidc/callback` | 回调换票、写 session |

### SSO — SAML

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/sso/saml/start?provider=<id>` | 跳转 IdP |
| POST | `/api/auth/sso/saml/callback` | ACS 回调 |

SSO 按钮由 `NEXT_PUBLIC_SSO_PROVIDERS=id:显示名` 控制。配置见 [runbooks/sso-oidc-setup.md](../runbooks/sso-oidc-setup.md)。

---

## 聊天

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/chat/completions` | 代理至 Gateway，支持 SSE |
| GET | `/api/chat/sessions` | 当前用户会话列表 |
| POST | `/api/chat/sessions` | 新建会话 |
| PATCH | `/api/chat/sessions/:sessionId` | 更新标题等 |
| DELETE | `/api/chat/sessions/:sessionId` | 软删除 |
| GET | `/api/chat/sessions/:sessionId/messages` | 消息列表 |
| POST | `/api/chat/sessions/:sessionId/messages` | 追加消息（持久化） |

### completions 请求要点

- 需有效 portal session（`workspace:chat` scope）
- Body：OpenAI chat completions 格式（`model`, `messages`, `stream` 等）
- 环境变量 `GATEWAY_COMPLETIONS_URL` 默认 `http://127.0.0.1:8088/v1/chat/completions`
- 策略 **block** 时 UI 须与正常模型回复视觉区分（合规拦截样式）

---

## 用户模型

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me/models` | 当前用户可见模型列表（admin 分配后） |

数据来源：`enterprise_runtime_user_visible_models` + provider 配置。

---

## 管理辅助

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/users` | 受限场景下创建用户（需 manage scope） |

---

## 关键环境变量

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | PG |
| `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY` | JWT |
| `AUTH_DEV_OWNER_PASSWORD` | 开发 owner 密码 |
| `ENABLE_DEV_BOOTSTRAP` | 非生产自动引导 |
| `DEFAULT_TENANT_ID` / `DEFAULT_DEPT_ID` | 默认租户/部门 |
| `GATEWAY_COMPLETIONS_URL` | Gateway 转发地址 |
| `NEXT_PUBLIC_SSO_PROVIDERS` | SSO 按钮列表 |

完整清单见 `enterprise/.env.local.example` 与 [deployment/vercel-env-checklist.md](../deployment/vercel-env-checklist.md)。
