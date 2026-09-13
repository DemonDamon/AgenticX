# Enterprise 部署说明

部署有两条路径，按场景选择。Helm chart **尚未提供**。

| 路径 | 适用 | 先看 |
|------|------|------|
| **本地化 / 私有化（Docker 自托管）** | 自有服务器或内网；Docker 起 Postgres/Redis，跑前台 + 后台 + Gateway | [local-selfhost.md](./local-selfhost.md) |
| **Vercel 托管 + 外部 Gateway** | portal/admin 上 Vercel；Go 网关自建或其它主机 | [vercel-env-checklist.md](./vercel-env-checklist.md) · [vercel-git-autodeploy.md](./vercel-git-autodeploy.md) |

本地开发（不是生产部署）走 `enterprise/scripts/start-dev.sh` / `start-dev-with-infra.sh`，见 [development/local-dev.md](../development/local-dev.md)。

---

## 明文密钥放哪里（不入库）

- **真实 PEM、Token、DATABASE_URL** 只允许写在：`enterprise/.local-secrets/`
- 该目录已在 `enterprise/.gitignore` 中忽略（与 `.env*.local` 同类），**不要提交远端**
- 建议本地自建：`enterprise/.local-secrets/vercel-env-values.local.md`，从 [vercel-env-checklist.md](./vercel-env-checklist.md) 复制表格后逐项填值

Gateway 上游 Key 用环境变量或 Channel `api_key_cipher`，不要写进文档仓库。PAT 明文只在创建时看一次，见 [gateway/api-tokens.md](../gateway/api-tokens.md)。

## 数据库

- 迁移：`pnpm --filter @agenticx/db-schema db:migrate`
- 若使用外部 Postgres（含托管实例）：[supabase-migration-guide.md](./supabase-migration-guide.md)
- Seed TLS 坑：[2026-05-12-supabase-seed-tls-pitfall.md](./2026-05-12-supabase-seed-tls-pitfall.md)

## 可参考

- [vercel-env-checklist.md](./vercel-env-checklist.md)：双 Project 环境变量清单
- [runbooks/](../runbooks/)：SSO、审计回灌、策略回滚、隧道 demo

Made-with: Damon Li
