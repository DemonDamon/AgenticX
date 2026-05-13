---
name: ""
overview: ""
todos: []
isProject: false
---

# Enterprise 公网部署：Vercel + Supabase + 外部 Gateway

> **Plan-Id**: `2026-05-12-enterprise-vercel-supabase-deployment`  
> **范围**: `enterprise/apps/web-portal` + `enterprise/apps/admin-console` 部署到 Vercel；`enterprise/apps/gateway` 部署到外部常驻平台（Fly.io / Railway / 自建 VM）；数据库改用 Supabase Postgres；域名 `app.agxbuilder.com` + `admin.agxbuilder.com`。  
> **目标**: 推送 `AgenticX` 仓库到 GitHub 后，Vercel 自动构建并发布两个 Next 应用；客户访问公网地址可登录前台和后台、可正常使用 AI 聊天。  
> **不在范围**: AgenticX-Website 营销站迁移、桌面端 `agxbuilder.com` 链接重定向（另起 plan）、Stripe/付费体系。

---

## 0. 现状基线（Why we need this）

| 模块 | 现状 | Vercel 上的问题 |
|---|---|---|
| `apps/admin-console/src/lib/model-providers-store.ts` | `writeFileSync` `enterprise/.runtime/admin/providers.json` | Vercel 函数 FS 只读 / 临时；多实例不共享；冷启动后丢失 |
| `apps/admin-console/src/lib/user-models-store.ts` | `writeFileSync` `user-models.json` | 同上 |
| `apps/admin-console/src/lib/token-quota-store.ts` | `writeFileSync` `quotas.json` | 同上 |
| `features/policy/src/snapshot/writer.ts` | `writeFile` `policy-snapshot.json`（带 `.lock` 目录锁） | 同上 + 锁机制不可用 |
| `apps/web-portal/src/lib/admin-providers-reader.ts` | `readFileSync` 上面两个 JSON | 路径走 `process.cwd() + '../../.runtime/admin'`，Vercel 上 cwd 不可控 |
| `features/metering/src/services/metering.ts` | PG 失败时回退读 `apps/gateway/.runtime/usage.jsonl` | 跨进程文件不可达，回退失效 |
| `apps/gateway`（Go） | 长驻 HTTP 服务，写多份 JSON/JSONL，监听 `:8088` | Vercel Functions 完全不能跑 Go 长驻 |
| `apps/web-portal/src/lib/auth-runtime.ts` | `InMemoryRefreshTokenStore`（来自 `@agenticx/auth`） | 多 region/instance 间 refresh token 不共享，令牌刷新会失败 |
| `packages/auth/src/services/jwt.ts` | 直接读 `process.env.AUTH_JWT_PRIVATE_KEY` / `_PUBLIC_KEY`（PEM 正文） | OK，但 `*_FILE` 注入路径在 Vercel 上不可用，需改成直接配 env |
| Drizzle schema | 17 张表已就绪（含 `policy_*`、`audit_events`、`gateway_audit_events`、`chat_*`、`sso_providers` 等） | 数据模型层不用从零重建 |
| 自动部署 | 当前无 CI/CD；本地 `start-dev.sh` 手动起 | 需要：push → Vercel 自动构建发布 |

---

## 1. 关键决策（已与用户确认）

| 决策点 | 选择 |
|---|---|
| AI 聊天是否要 | **要** → 必须部署 Go gateway 到外部平台 |
| Supabase 角色 | **只用 Postgres**；enterprise 自带的 IAM/JWT/SSO 全保留，不用 Supabase Auth |
| 域名规划 | **拆子域**：`app.agxbuilder.com`（前台）+ `admin.agxbuilder.com`（后台），均挂 Vercel；`gateway.agxbuilder.com` 走 CNAME 指外部网关 |
| 自动部署 | **push 到默认分支自动触发 Production；其他分支自动 Preview**（Vercel 默认行为） |

---

## 2. 总体架构（部署后）

```
                         Cloudflare/阿里云 DNS
                                 │
    ┌────────────────────────────┼────────────────────────────┐
    │                            │                            │
app.agxbuilder.com    admin.agxbuilder.com         gateway.agxbuilder.com
    │                            │                            │
    ▼                            ▼                            ▼
Vercel Project A          Vercel Project B           Fly.io / Railway / VM
(web-portal)              (admin-console)            (Go gateway, 常驻)
    │                            │                            │
    └──────┬─────────────────────┴────────────────────────────┘
           │                                                  │
           ▼                                                  ▼
   Supabase Postgres                              Supabase Postgres（同一库）
   (drizzle migrations)                           读模型/策略/配额表
```

---

## 3. 分阶段实施

### Phase 0：基础设施开通（1 天，纯配置，无代码）

#### FR
- **FR-0.1**：开通 Supabase 项目，拿到 `DATABASE_URL`（Direct connection + `?sslmode=require`）。
- **FR-0.2**：在 Supabase 跑 `enterprise/packages/db-schema` 现有迁移（17 张表）+ `db-seed`，admin 账号能跑通。
- **FR-0.3**：开通 GitHub → Vercel 关联（已有 AgenticX 仓库 push 权限）。
- **FR-0.4**：选定 Go 网关托管平台（推荐 Fly.io，免费档够 PoC），开通账号。
- **FR-0.5**：在 DNS 服务商加 3 条记录：`app` / `admin` 各一条 CNAME 指 Vercel；`gateway` 一条 CNAME 指 Fly.io。

#### AC
- [ ] `psql $DATABASE_URL -c "\dt"` 看到 17 张表。
- [ ] `db-seed` 后，PG 里能查到 `admin@agenticx.local` 用户和 `super_admin` 角色绑定。
- [ ] DNS 三条 CNAME 解析正常（`dig app.agxbuilder.com` 返回 Vercel 的 IP）。

---

### Phase 1：消除文件系统依赖（核心改造，3–5 天）

> 这是计划中**最大一块**改造。所有 admin-console 写入 `.runtime/*.json` 的逻辑全部改成 Drizzle PG 读写；前台 `admin-providers-reader` 改成同一个 PG 表。

#### FR

- **FR-1.1 模型供应商表**：在 `packages/db-schema/src/schema/` 新增 `model_providers` 表（id/tenant_id/provider_id/name/base_url/api_key_encrypted/enabled/created_at/updated_at）。
  - `apps/admin-console/src/lib/model-providers-store.ts` 改成纯 Drizzle CRUD，删除 `writeFileSync`/`readFileSync`。
  - **`api_key`** 用对称加密（`AGX_PROVIDER_SECRET_KEY` env，AES-256-GCM）后入库；读取时解密。
- **FR-1.2 用户可见模型表**：新增 `user_visible_models`（user_id/tenant_id/model_id/visible/updated_at）。
  - `user-models-store.ts` 改 PG。
  - Portal 的 `admin-providers-reader.ts` 改成 PG join 查询。
- **FR-1.3 Token 配额表**：新增 `token_quotas`（id/tenant_id/scope_type/scope_id/model_id/period/limit/action）。
  - `token-quota-store.ts` 改 PG。
- **FR-1.4 策略快照表**：新增 `policy_snapshots`（tenant_id/version/snapshot_jsonb/published_at/published_by），按 `tenant_id` 唯一约束 + 版本号。
  - `features/policy/src/snapshot/writer.ts` 改成 PG `upsert`，删除 `.lock` 目录与 `rename` 逻辑。
  - **暴露 `GET /api/internal/policy-snapshot?tenant_id=...`** 给 gateway 拉取（带 service token 鉴权）。
- **FR-1.5 全局清理**：`grep -r ".runtime" enterprise/apps enterprise/features enterprise/packages | grep -v test` 在 Phase 1 结束后应该返回 0 行（除测试与脚本注释）。

#### AC

- [ ] `enterprise/.runtime/` 目录在 Phase 1 后**不再被任何运行时代码读写**（仅本地 dev 仍可用，但不再是数据源）。
- [ ] admin-console 上配置一个 provider → 重启进程 → 数据仍在（因为在 PG）。
- [ ] portal 用户登录后能看到 admin 配置的 provider 模型清单（来自 PG）。
- [ ] 策略发布后，`SELECT * FROM policy_snapshots WHERE tenant_id=...` 能查到最新版本。
- [ ] 现有 `tests/` 全绿（含 `features/policy/tests/snapshot-writer.test.ts` 改用 PG fixture）。

---

### Phase 2：Auth/Session 适配 serverless（2 天）

#### FR

- **FR-2.1 Refresh Token 持久化**：把 `InMemoryRefreshTokenStore` 替换为 PG-backed 实现（新表 `refresh_tokens` 或复用现有 session 表）。
  - 多 region/多实例下 refresh 不丢失。
- **FR-2.2 JWT key 直读 env**：移除任何 `AUTH_JWT_PRIVATE_KEY_FILE` 路径回退（保留兼容但 prod 不用），文档明确写「Vercel 上必须把 PEM 正文粘进 env」。
- **FR-2.3 Admin session secret**：`ADMIN_CONSOLE_SESSION_SECRET` 在 Vercel 环境变量配置，强制生产环境必填（已有校验，确认仍生效）。
- **FR-2.4 Cookie domain**：login/logout/session 路由设置 `Domain=.agxbuilder.com`（可选），让 admin/portal 共享识别——也可不共享，按各自域独立鉴权（更安全，**推荐独立**）。
- **FR-2.5 SSO 回调 URL**：把所有 `SSO_OIDC_*_REDIRECT_URI` env 改成 `https://app.agxbuilder.com/api/auth/sso/oidc/callback` / `admin` 同理；在 IdP 控制台同步加白名单。

#### AC

- [ ] 在 Vercel 上登录 `app.agxbuilder.com`，等 access token 过期（默认 ~15min），自动用 refresh token 续期成功（PG 落库验证）。
- [ ] 同一用户可以同时登录 `app.` 和 `admin.`，两个 session 互不干扰。
- [ ] OIDC SSO 走通：浏览器 `app.agxbuilder.com/api/auth/sso/oidc/start?provider=...` → IdP → 回 callback → 落 cookie → 重定向到 `/workspace`。

---

### Phase 3：Go Gateway 单独部署（1–2 天）

#### FR

- **FR-3.1 选择平台**：默认 Fly.io（容器友好、免费档够、有持久卷）。备选：Railway / 自建 VM。
- **FR-3.2 Dockerfile**：在 `enterprise/apps/gateway/` 新增 `Dockerfile`（multi-stage：`golang:1.22 as builder` → `alpine` 运行）。
- **FR-3.3 配置改造**：网关读策略快照的方式改为 **HTTP 拉 admin-console** `GET /api/internal/policy-snapshot`（带 service token），缓存 30s；不再读本地文件。
  - `quotas.json` 同理改为读 admin-console `GET /api/internal/quotas`。
  - `providers.json` 同理。
  - **新增 internal 路由**到 admin-console，service token 鉴权（env `GATEWAY_INTERNAL_TOKEN`）。
- **FR-3.4 审计/usage 回写**：网关把 audit/usage 直接写 Supabase PG（已有 `gateway_audit_events`、`usage_records` 表），删除本地 JSONL fallback（或保留 best-effort 但仅作崩溃恢复用途）。
- **FR-3.5 部署 Fly.io**：`fly launch` → 配 env（`DATABASE_URL`、`AUTH_JWT_PUBLIC_KEY`、`GATEWAY_INTERNAL_TOKEN`、`POLICY_SNAPSHOT_URL`、`PROVIDERS_URL`、`QUOTAS_URL`） → `fly deploy`。
- **FR-3.6 域名**：Fly.io 给的子域走 CNAME → `gateway.agxbuilder.com`，Fly 自动签证书。
- **FR-3.7 web-portal 配置**：Vercel 上 `GATEWAY_COMPLETIONS_URL=https://gateway.agxbuilder.com/v1/chat/completions`。

#### AC

- [ ] `curl https://gateway.agxbuilder.com/healthz` 200。
- [ ] portal 上发起一次聊天，PG `gateway_audit_events` 表能查到这条审计；`usage_records` 能看到 token 计数。
- [ ] admin 上发布一条策略，10s 内 portal 上发该类违规消息能被拦截（验证策略快照 HTTP 拉取生效）。

---

### Phase 4：Vercel 项目创建 + 环境变量（半天）

#### FR

- **FR-4.1 创建 Vercel Project A（web-portal）**：
  - **Root Directory**: `enterprise/apps/web-portal`
  - **Framework Preset**: Next.js
  - **Install Command**: `cd ../.. && pnpm install --frozen-lockfile`
  - **Build Command**: `cd ../.. && pnpm exec turbo run build --filter=@agenticx/app-web-portal`
  - **Output Directory**: `enterprise/apps/web-portal/.next`（Vercel 会自动识别）
  - **Node Version**: 20
- **FR-4.2 创建 Vercel Project B（admin-console）**：同上换 filter 为 `@agenticx/app-admin-console`，Root 换 `enterprise/apps/admin-console`。
- **FR-4.3 环境变量清单**（两个 project 都要配，少数 admin 独有）：

  通用（两个 project 都要）：
  - `DATABASE_URL`（Supabase 连接串）
  - `AUTH_JWT_PRIVATE_KEY`（PEM 正文，含 `-----BEGIN`/`-----END`，多行）
  - `AUTH_JWT_PUBLIC_KEY`（同上）
  - `DEFAULT_TENANT_ID`、`DEFAULT_DEPT_ID`
  - `NEXT_PUBLIC_SSO_PROVIDERS`、各 IdP 的 `SSO_OIDC_DEFAULT_*`
  - `SSO_STATE_SIGNING_SECRET`、`SSO_PROVIDER_SECRET_KEY`
  - `AGX_PROVIDER_SECRET_KEY`（FR-1.1 的加密密钥）

  仅 web-portal：
  - `GATEWAY_COMPLETIONS_URL=https://gateway.agxbuilder.com/v1/chat/completions`
  - `AUTH_DEV_OWNER_PASSWORD`（仅当还需要 JIT bootstrap，建议生产关掉 `ENABLE_DEV_BOOTSTRAP`）

  仅 admin-console:
  - `ADMIN_CONSOLE_SESSION_SECRET`
  - `ADMIN_CONSOLE_LOGIN_PASSWORD`（生产建议改用真实账号 + RBAC）
  - `GATEWAY_INTERNAL_TOKEN`（FR-3.3）
  - `GATEWAY_BASE_URL=https://gateway.agxbuilder.com`

- **FR-4.4 Git 关联**：两个 project 都连 `damonkv/AgenticX`（或你的实际仓库），默认分支 `main`。
- **FR-4.5 Ignored Build Step**（可选）：每个 project 配 `git diff HEAD^ HEAD --quiet -- enterprise/apps/web-portal enterprise/features enterprise/packages`，无关改动跳过构建（节省构建分钟）。

#### AC

- [ ] 两个 project 都能在 Vercel 默认子域（如 `agenticx-web-portal.vercel.app`）上访问到登录页。
- [ ] `admin@agenticx.local` 能在 admin 默认子域登录进去看到仪表盘。
- [ ] Push 一个无关 commit 到 main，**两个 project 都自动构建**（如果配了 ignored build step，则只动到对应目录的会构建）。

---

### Phase 5：域名绑定 + SSO + 端到端验证（半天）

#### FR

- **FR-5.1 Vercel 域名绑定**：
  - Project A → Add Domain → `app.agxbuilder.com`
  - Project B → Add Domain → `admin.agxbuilder.com`
- **FR-5.2 DNS 记录**：在域名服务商加：
  - `app  CNAME  cname.vercel-dns.com.`
  - `admin  CNAME  cname.vercel-dns.com.`
  - `gateway  CNAME  <fly-app>.fly.dev.`
- **FR-5.3 IdP 回调地址同步**：把 SSO 提供方控制台里的 redirect URL 加白：`https://app.agxbuilder.com/api/auth/sso/oidc/callback` 和 admin 同理。
- **FR-5.4 端到端冒烟脚本**：写一个 `enterprise/scripts/smoke-prod.ts`，跑：登录 → 列模型 → 发一条聊天 → 验证 PG 有 audit & usage 记录 → 退出登录。

#### AC

- [ ] 浏览器访问 `https://app.agxbuilder.com` 看到登录页，HTTPS 正常。
- [ ] 浏览器访问 `https://admin.agxbuilder.com` 同上。
- [ ] 用 `admin@agenticx.local` 登录 admin，能创建一个 provider，再登录 portal 能看到这个模型并完成一次聊天。
- [ ] `pnpm tsx scripts/smoke-prod.ts` 全绿。
- [ ] **客户拿到链接 + 临时账号即可访问体验。**

---

## 4. 自动部署机制说明

完成 Phase 4 之后，**push 自动部署是 Vercel 默认行为**，不需要任何 GitHub Actions：

| 操作 | 结果 |
|---|---|
| `git push origin main` | 两个 Vercel Project 各自构建并发布到 Production（`app.` / `admin.`） |
| `git push origin feature/xxx` | 各自生成 Preview URL（如 `agenticx-web-portal-git-feature-xxx-yourorg.vercel.app`），方便 demo |
| 在 PR 上 | Vercel 自动评论 Preview 链接 |
| 改了 `enterprise/apps/gateway/**` | Vercel **不会**触发构建（gateway 在 Fly.io），需要单独 `fly deploy`（可加 GitHub Actions 自动化） |

> **Gateway 的自动部署**是另一个 plan，建议简单做法：在 `.github/workflows/deploy-gateway.yml` 里加 `on: push: paths: ['enterprise/apps/gateway/**']` + `flyctl deploy`。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Phase 1 PG 改造期间生产无法用 | Phase 1 全程在本地完成 + 测试，最后一次性合入 main |
| Supabase 免费档限制（500MB 库 / 2GB 出口） | PoC 够用；客户量起来升 Pro $25/mo |
| Vercel 免费档函数执行 10s 超时 | 聊天走 SSE 流式，单次调用应该 < 10s；超时的长任务（如 RAG 入库）不要放 Vercel，要放 gateway 或独立 worker |
| Fly.io 免费档资源不够 | gateway 实测内存 ~150MB，免费档 256MB 够；起量后升 shared-cpu-1x 起 $1.94/mo |
| Cookie 跨子域问题 | 默认每个子域独立 cookie，**这是更安全的做法**；不强求 SSO |
| 客户 demo 期间偶发冷启动慢 | Vercel Hobby 无 always-on；如果 demo 当天可以提前 warm 一次 |

**完整回滚路径**：保留本地 docker-compose 路径作为 fallback，任意 Phase 卡壳都可以临时回到 VPS 部署（仓库代码兼容）。

---

## 6. 关键里程碑（建议节奏）

| Milestone | 工时 | 累计 |
|---|---|---|
| M0：Phase 0 完成（Supabase + DNS + Vercel/Fly 账号就位） | 1 天 | 1 天 |
| M1：Phase 1 完成（`.runtime` 文件依赖全部消灭） | 3–5 天 | 4–6 天 |
| M2：Phase 2 完成（refresh token + JWT + SSO callback） | 2 天 | 6–8 天 |
| M3：Phase 3 完成（gateway 上 Fly + 拉 PG） | 1–2 天 | 7–10 天 |
| M4：Phase 4 完成（Vercel 双 project 上线，默认域可访问） | 0.5 天 | 7.5–10.5 天 |
| M5：Phase 5 完成（自定义子域 + SSO + 冒烟） | 0.5 天 | **8–11 天给客户体验地址** |

---

## 7. 实施期间的 commit 约定

每个 Phase 拆若干 commit，每个 commit 必须：
- 包含 `Plan-Id: 2026-05-12-enterprise-vercel-supabase-deployment`
- 包含 `Plan-File: .cursor/plans/2026-05-12-enterprise-vercel-supabase-deployment.plan.md`
- 包含 `Made-with: Damon Li`
- Subject 写清属于哪个 Phase 的哪条 FR（如 `feat(enterprise): FR-1.1 model_providers PG store`）

按 `/commit --spec=.cursor/plans/2026-05-12-enterprise-vercel-supabase-deployment.plan.md` 自动注入 trailer。

---

## 8. 不在本 plan 范围

- AgenticX-Website 营销站迁移 / 下架旧 `/auth` `/agents`（另起 plan）
- 桌面端 `https://www.agxbuilder.com` 硬编码链接的更新（`desktop/electron/main.ts` 的 `AGX_ACCOUNT_WEB_BASE_DEFAULT` 等）
- 计费 / 订阅 / Stripe
- 多租户 onboarding 自助流程
- Knowledge Base / RAG 文件存储到 Supabase Storage（如有需要单独 plan）
- 完整 RBAC scope 加固（已有 `2026-05-04-enterprise-iam-full-buildout` plan 在跟进）