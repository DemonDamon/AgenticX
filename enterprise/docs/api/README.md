# Enterprise API 总览

Enterprise 暴露三类 HTTP API：

| 类别 | 基址 | 认证 | 文档 |
|---|---|---|---|
| Web Portal | `http://localhost:3000` | JWT Cookie / Bearer | [web-portal.md](./web-portal.md) |
| Admin Console | `http://localhost:3001` | Admin Session + RBAC | [admin-console.md](./admin-console.md) |
| AI Gateway | `http://localhost:8088` | JWT Bearer | [gateway.md](./gateway.md) |
| Internal（Gateway 专用） | admin `:3001/api/internal/*` | `GATEWAY_INTERNAL_TOKEN` | [internal-api.md](./internal-api.md) |

---

## 约定

### 认证

- **Portal JWT**：登录/SSO 后写入 httpOnly cookie；API Route 从 session 读取 claims
- **Admin Session**：独立 cookie，由 `ADMIN_CONSOLE_SESSION_SECRET` 签名
- **Gateway**：`Authorization: Bearer <portal_jwt>`，公钥 `AUTH_JWT_PUBLIC_KEY`
- **Internal**：`Authorization: Bearer <GATEWAY_INTERNAL_TOKEN>`

### 错误格式

Next.js API 通常返回：

```json
{ "error": "error_code", "message": "human readable" }
```

Gateway 业务错误使用 `9xxxx` 系列（策略拦截、配额超限等），与上游 OpenAI 错误区分。

### 多租户

几乎所有写操作隐式绑定 JWT 中的 `tenant_id`。Internal API 返回当前部署单租户或全量配置（由 store 实现决定）。

---

## 路由统计

| App | 页面路由 | API 路由 |
|---|---|---|
| web-portal | 3 | 14 |
| admin-console | 15 | 49+ |
| gateway | — | 4 |

---

## OpenAI 兼容面

前台聊天最终打到 Gateway：

```
POST /v1/chat/completions   # 含 SSE stream
POST /v1/embeddings
GET  /healthz
GET  /internal/channel-stats  # 需 internal token
```

Portal 不直接暴露 OpenAI API，而是 `/api/chat/completions` 代理并注入审计所需 headers。

---

## 代码位置

| App | API 源码根 |
|---|---|
| web-portal | `apps/web-portal/src/app/api/` |
| admin-console | `apps/admin-console/src/app/api/` |
| gateway | `apps/gateway/internal/server/` |
| internal client（Go） | `apps/gateway/internal/gatewayinternal/` |
| internal auth（TS） | `apps/admin-console/src/lib/gateway-internal-auth.ts` |

类型契约见 `packages/core-api/`。

环境变量总表：[../configuration/env-vars.md](../configuration/env-vars.md)。
