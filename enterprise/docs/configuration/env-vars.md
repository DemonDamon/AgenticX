# 环境变量总表

> 最后更新：2026-05-21  
> 模板：`enterprise/.env.local.example`

按消费组件分类。标 ✅ 为必填，🟡 为生产/部署强烈建议，⚪ 可选。

---

## 1. 共用

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres 连接串；portal / admin / gateway 共用 |
| `REDIS_URL` | ⚪ | 当前 portal/admin 主要落 PG，Redis 仅本地 compose 起 |
| `AUTH_JWT_PRIVATE_KEY` | ✅ | RS256 私钥 PEM（portal/admin 签发） |
| `AUTH_JWT_PUBLIC_KEY` | ✅ | RS256 公钥（gateway 校验） |
| `AUTH_JWT_PRIVATE_KEY_FILE` | ⚪ | `.env.local` 习惯写 `*_FILE`，`start-dev.sh` 展开为内容 |
| `AUTH_JWT_PUBLIC_KEY_FILE` | ⚪ | 同上 |
| `DEFAULT_TENANT_ID` | 🟡 | 默认租户 ULID（seed 之后） |
| `DEFAULT_DEPT_ID` | ⚪ | 默认部门 ULID |
| `AGX_AUTO_DB_MIGRATE` | ⚪ | `start-dev.sh` 仅在 localhost DB 下自动 migrate；`=0` 关闭 |

---

## 2. web-portal（`:3000`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `AUTH_DEV_OWNER_PASSWORD` | 🟡 dev | 开发态 owner@agenticx.local 密码 |
| `ENABLE_DEV_BOOTSTRAP` | ⚪ | 非生产自动引导 seed |
| `GATEWAY_COMPLETIONS_URL` | 🟡 | 默认 `http://127.0.0.1:8088/v1/chat/completions` |
| `NEXT_PUBLIC_SSO_PROVIDERS` | ⚪ | `id:显示名` 逗号分隔，控制 SSO 按钮 |
| `SSO_<id>_ISSUER` | OIDC | IdP issuer URL |
| `SSO_<id>_CLIENT_ID` | OIDC | OIDC client_id |
| `SSO_<id>_CLIENT_SECRET` | OIDC | OIDC client_secret |
| `SSO_<id>_REDIRECT_URI` | OIDC | 回调 URI |
| `SSO_<id>_SCOPES` | ⚪ | 默认 `openid profile email` |
| `SSO_<id>_SAML_ENTRY_POINT` | SAML | SAML IdP SSO URL |
| `SSO_<id>_SAML_ISSUER` | SAML | SP entityID |
| `SSO_<id>_SAML_CERT` | SAML | IdP 公钥证书 |

完整 SSO 变量见 [runbooks/sso-oidc-setup.md](../runbooks/sso-oidc-setup.md) 与 [runbooks/sso-saml-setup.md](../runbooks/sso-saml-setup.md)。

---

## 3. admin-console（`:3001`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_CONSOLE_LOGIN_EMAIL` | 🟡 | 管理台账号；默认 `admin@agenticx.local` |
| `ADMIN_CONSOLE_LOGIN_PASSWORD` | ✅ | 管理台密码登录 |
| `ADMIN_CONSOLE_SESSION_SECRET` | ✅ | 管理台 session 签名 |
| `GATEWAY_BASE_URL` | 🟡 | 管理台健康检查目标（默认 `http://127.0.0.1:8088`） |
| `GATEWAY_INTERNAL_TOKEN` | ✅ Vercel 分体 | Gateway 拉取 internal API 的 Bearer |
| `GATEWAY_INTERNAL_BASE_URL` | ⚪ | Channel 健康聚合；注意区分 gateway 8088 vs internal mgmt 端口 |
| `AGX_PROVIDER_SECRET_KEY` | ✅ | Provider API Key AES-256-GCM 密钥（32 字节 base64） |
| `SSO_PROVIDER_SECRET_KEY` | ✅ | SSO client_secret AES-256-GCM 密钥 |
| `NEXT_PUBLIC_SSO_PROVIDERS` | ⚪ | 同 portal，控制 admin SSO 入口 |

---

## 4. apps/gateway（`:8088`）

### 4.1 基础

| 变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_HTTP_ADDR` | `:8088` | 监听地址 |
| `GATEWAY_CONFIG_PATH` | — | YAML 配置路径（模型路由） |
| `AUTH_JWT_PUBLIC_KEY` | — | JWT 校验（必填） |
| `DATABASE_URL` | — | 审计 / 计量 PG 双写 |

### 4.2 上游 Key 解析（按顺序）

| 变量 | 说明 |
|---|---|
| `<PROVIDER>_API_KEY` | provider 名大写、`-` → `_`，如 `DEEPSEEK_API_KEY` |
| `LLM_API_KEY` | 通用兜底 |
| 未配置 | mock 回退（策略 / 审计 / 计量仍执行） |

> 优先级：**PG `api_key_cipher`** > `<PROVIDER>_API_KEY` > `LLM_API_KEY` > mock

### 4.3 远程配置（Vercel 分体推荐）

| 变量 | 对应 admin internal 路由 |
|---|---|
| `GATEWAY_INTERNAL_TOKEN` | Bearer（与 admin 一致） |
| `GATEWAY_REMOTE_PROVIDERS_URL` | `/api/internal/providers` |
| `GATEWAY_REMOTE_QUOTA_CONFIG_URL` | `/api/internal/quotas` |
| `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` | `/api/internal/policy-snapshot` |
| `GATEWAY_REMOTE_CHANNELS_URL` | `/api/internal/channels` |

### 4.4 本地文件回退

| 变量 | 用途 |
|---|---|
| `GATEWAY_ADMIN_PROVIDERS_FILE` | providers.json |
| `GATEWAY_QUOTA_CONFIG_FILE` | quotas.json |
| `GATEWAY_QUOTA_USAGE_FILE` | quota usage 本地落盘 |
| `GATEWAY_POLICY_SNAPSHOT_FILE` | 已发布策略快照 |
| `GATEWAY_POLICY_OVERRIDE_FILE` | 本地策略覆盖（调试） |
| `GATEWAY_USAGE_LOG` | 无 PG 时计量 jsonl 路径 |

### 4.5 审计

| 变量 | 默认 | 说明 |
|---|---|---|
| `GATEWAY_AUDIT_BACKFILL_DAYS` | `7` | 启动回灌 `.pg-pending` 窗口 |

### 4.6 流式加固

| 变量 | 说明 |
|---|---|
| `GATEWAY_STREAM_IDLE_TIMEOUT` | SSE 空闲切断 |
| `GATEWAY_STREAM_SCANNER_MAX_BUFFER_MB` | 单 chunk 缓冲上限 |

### 4.7 Channel 中继

| 变量 | 说明 |
|---|---|
| `GATEWAY_CHANNEL_REGISTRY` | `on` 启用 |

---

## 5. 密钥生成与轮换

```bash
# RSA-2048（JWT）
openssl genrsa -out auth_private.pem 2048
openssl rsa -in auth_private.pem -pubout -out auth_public.pem

# AES-256-GCM 密钥（32 字节 base64）
openssl rand -base64 32
```

轮换 `AGX_PROVIDER_SECRET_KEY` / `SSO_PROVIDER_SECRET_KEY` 需重新加密所有现存 cipher 行，建议运维脚本批处理。

---

## 6. 部署清单交叉引用

- [deployment/vercel-env-checklist.md](../deployment/vercel-env-checklist.md) — Vercel Project 必填项
- [deployment/README.md](../deployment/README.md) — `.local-secrets/` 约定
- [../../scripts/README.md](../../scripts/README.md) — bootstrap / start-dev env 处理

---

## 7. 常见误区

| 现象 | 原因 |
|---|---|
| 改了 SSO env 无效 | Next.js 不热加载 SSO env，需**完整重启** portal / admin |
| Gateway 看不到 admin Provider | `GATEWAY_INTERNAL_TOKEN` 两端不一致 |
| Token chip 永远 0 | gateway 与 portal `DATABASE_URL` 不同库 |
| 策略已发布不拦截 | `GATEWAY_POLICY_SNAPSHOT_FILE` 路径错（指错 `.runtime` 根） |
| `chat history operation failed` | PG 未起或 `DATABASE_URL` 错 |

详见 [development/troubleshooting.md](../development/troubleshooting.md)。
