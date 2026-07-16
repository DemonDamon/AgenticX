# MySQL 8.0 部署 Runbook

同一套 Portal / Admin / Gateway 镜像可通过环境变量在 PostgreSQL 与 MySQL 之间切换。本页覆盖 **全新 MySQL 安装**（非存量迁移）。

## 前置条件

- MySQL **8.0.x**（CI 钉死 `8.0.36`；生产建议同小版本）
- 字符集 `utf8mb4` / 排序规则 `utf8mb4_unicode_ci`
- 会话时区 UTC（`default-time-zone=+00:00`）
- `sql_mode` 含 `STRICT_TRANS_TABLES`
- Portal、Admin、Gateway 使用**同一组** `DATABASE_DIALECT` + `DATABASE_URL`

## 环境变量

```env
DATABASE_DIALECT=mysql
DATABASE_URL=mysql://agenticx:********@db-host:3306/agenticx
```

冲突（例如 `DATABASE_DIALECT=mysql` 配 `postgresql://...`）必须启动 fail-fast，禁止静默纠正。

## 空库初始化

```bash
cd enterprise
export DATABASE_DIALECT=mysql
export DATABASE_URL=mysql://...

pnpm --filter @agenticx/db-schema db:migrate
pnpm --filter @agenticx/db-schema db:seed   # 仅开发 / 演示；生产按安全规范决定是否 seed
```

迁移链目录：`packages/db-schema/drizzle-mysql/`（与 PostgreSQL 的 `drizzle/` 独立）。

## 本地 Compose

```bash
bash scripts/start-dev-with-infra.sh --db=mysql
# 或
bash scripts/bootstrap.sh --db=mysql
```

容器：`agenticx-mysql-dev`（profile `mysql`）。默认账号见 `deploy/docker-compose/dev.yml`。

## 就绪检查

- Gateway：`GET /readyz` → `checks.database.status=ok`，`detail` 含 `dialect=mysql`
- `checks.postgres` 为兼容字段（deprecated），不要再作为 sole source of truth
- Portal / Admin 登录、聊天历史读写、策略发布、配额递增各跑一遍 smoke

## 相关文档

- [postgresql-to-mysql-offline-migration.md](./postgresql-to-mysql-offline-migration.md)
- [database-dialect-rollback.md](./database-dialect-rollback.md)
- [../database/cutover-runbook.md](../database/cutover-runbook.md)
- [../database/dialect-compatibility-matrix.md](../database/dialect-compatibility-matrix.md)
