# Vercel 环境变量清单（复制到 `.local-secrets` 后再填）

> **不要**把填好真实值的副本提交 Git。请在本地创建：  
> `enterprise/.local-secrets/vercel-env-values.local.md`，把下面整块复制进去再替换 `<…>`。

## Vercel 项目设置摘要

| Project | Root Directory |
| --- | --- |
| web-portal | `enterprise/apps/web-portal` |
| admin-console | `enterprise/apps/admin-console` |

| 字段 | Install Command |
| --- | --- |
| 两端相同 | `cd ../.. && pnpm install --frozen-lockfile` |

| 字段 | Build Command |
| --- | --- |
| web-portal | `cd ../.. && pnpm exec turbo run build --filter=@agenticx/app-web-portal` |
| admin-console | `cd ../.. && pnpm exec turbo run build --filter=@agenticx/app-admin-console` |

Framework: **Next.js** · Node: **20**。

---

## 两项目共通（Production / Preview 均建议配置）

在 **web-portal 与 admin-console** 两套 Vercel Project 里都加同名变量：

| 变量名 | 说明 |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres 直连串，通常带 `?sslmode=require` |
| `AUTH_JWT_PRIVATE_KEY` | PEM 全文（含 `BEGIN/END`，多行） |
| `AUTH_JWT_PUBLIC_KEY` | PEM 全文 |
| `DEFAULT_TENANT_ID` | 默认租户 |
| `DEFAULT_DEPT_ID` | 默认部门 |
| `NEXT_PUBLIC_SSO_PROVIDERS` | 如：`id:显示名`，多个逗号分隔 |
| `SSO_STATE_SIGNING_SECRET` | OIDC state 签名 |
| `SSO_PROVIDER_SECRET_KEY` | 与 SSO 会话/加密相关的密钥（按仓库实际约定填写） |
| `AGX_PROVIDER_SECRET_KEY` | Admin 写入 provider Key 的对称加密密钥（AES-GCM），须与文档/实现一致 |

各 IdP 的 `SSO_OIDC_*` 按控制台要求一并配置（两台若都要 SSO，就都配）。

---

## 仅 web-portal

| 变量名 | 示例 |
| --- | --- |
| `GATEWAY_COMPLETIONS_URL` | `https://gateway.<你的域名>/v1/chat/completions` |

按需（不建议生产长期使用）：

| 变量名 | 说明 |
| --- | --- |
| `AUTH_DEV_OWNER_PASSWORD` | 开发/引导用 |
| `ENABLE_DEV_BOOTSTRAP` | 生产建议关闭 |

---

## 仅 admin-console

| 变量名 | 说明 |
| --- | --- |
| `ADMIN_CONSOLE_SESSION_SECRET` | 管理台 session，生产必填 |
| `ADMIN_CONSOLE_LOGIN_PASSWORD` | 管理台密码登录（生产建议过渡到真实账号 RBAC） |
| `GATEWAY_INTERNAL_TOKEN` | 提供给 **gateway** `GATEWAY_INTERNAL_TOKEN`，拉 internal 快照/配额/供应商 |
| `GATEWAY_BASE_URL` | 如 `https://gateway.<你的域名>`（无尾随 `/v1`） |

若 internal 路由为绝对 URL，按需增加管理台侧的 base URL env（以实现为准）。

---

## Gateway（Fly/Railway/VM）侧应对齐（非 Vercel）

网关在别处部署时至少需与 admin 约定的：

| 变量名 | 说明 |
| --- | --- |
| `DATABASE_URL` | 与 Supabase 相同库（audit/usage 等） |
| `AUTH_JWT_PUBLIC_KEY` | 与前台签发 access JWT 一致 |
| `GATEWAY_INTERNAL_TOKEN` | 与 admin `GATEWAY_INTERNAL_TOKEN` 一致 |
| `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` | GET，Bearer 同上 |
| `GATEWAY_REMOTE_PROVIDERS_URL` | GET，Bearer 同上 |
| `GATEWAY_REMOTE_QUOTA_CONFIG_URL` | GET，Bearer 同上 |

具体路径以实现仓库中 admin `internal/*` API 为准。

---

## `.local-secrets` 可复制骨架（填空后仅存本地）

以下为骨架，可复制到 `enterprise/.local-secrets/vercel-env-values.local.md`：

```markdown
# Vercel 填值草稿（请勿提交）

## web-portal
DATABASE_URL=<…>
AUTH_JWT_PRIVATE_KEY=
（多行 PEM）
AUTH_JWT_PUBLIC_KEY=
DEFAULT_TENANT_ID=<…>
DEFAULT_DEPT_ID=<…>
NEXT_PUBLIC_SSO_PROVIDERS=<…>
SSO_STATE_SIGNING_SECRET=<…>
SSO_PROVIDER_SECRET_KEY=<…>
AGX_PROVIDER_SECRET_KEY=<…>
GATEWAY_COMPLETIONS_URL=https://gateway.<…>/v1/chat/completions

## admin-console
（同上共通项再填一遍）

ADMIN_CONSOLE_SESSION_SECRET=<…>
ADMIN_CONSOLE_LOGIN_PASSWORD=<…>
GATEWAY_INTERNAL_TOKEN=<…>
GATEWAY_BASE_URL=https://gateway.<…>
```
