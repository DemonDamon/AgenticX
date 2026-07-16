# 数据库方言回退 Runbook

适用于 Enterprise Portal / Admin / Gateway 在 `postgresql` ↔ `mysql` 之间切换后的回退决策。

## 原则

1. **三端必须同方言、同库**：Portal、Admin、Gateway 的 `DATABASE_DIALECT` 与 `DATABASE_URL` 必须一致。
2. **有写入后再回切 = 数据分叉**：只有在目标库尚未接受业务写时，才能无损回退。
3. **默认方言仍是 PostgreSQL**：未设置 `DATABASE_DIALECT` 且 URL 为 `postgres(ql)://` 时行为与历史版本一致。

## 场景 A：MySQL 割接后、用户流量打开前

此时 MySQL 仅用于内网 smoke，PostgreSQL 仍是权威数据。

1. 停止 Portal / Admin / Gateway（或摘流量）。
2. 将三端环境改回：
   ```env
   DATABASE_DIALECT=postgresql
   DATABASE_URL=postgresql://...
   ```
3. 重启三端；确认 `/readyz` 的 `checks.database.detail` 含 `dialect=postgresql`。
4. 再跑登录 / 聊天 / 策略 smoke。
5. MySQL 实例可保留作复盘，或销毁后下次重新 migrate。

## 场景 B：MySQL 已接受用户写

**禁止**把流量静默切回旧 PostgreSQL。

可选路径（均需新的维护窗口与显式数据损失评估）：

- 从 MySQL 备份恢复到新环境，并规划反向迁移（当前首期工具仅提供 PG→MySQL）
- 接受丢失 MySQL 窗口内增量，从 PostgreSQL 备份恢复并重新上线 PG
- 人工导表 + checksum 核验后的定制回退方案

## 场景 C：误配方言 / URL

启动应 fail-fast。处置：修正 env，重启；不要依赖应用层“猜 scheme”。

本地开发：

```bash
# 切回 PostgreSQL 开发栈
bash scripts/start-dev-with-infra.sh --db=postgresql

# 或 MySQL
bash scripts/start-dev-with-infra.sh --db=mysql
```

## 检查清单

- [ ] 三端 env 一致
- [ ] `/readyz` database 检查通过
- [ ] 登录密码验的是**当前库** `users.password_hash`（改 `.env.local` 不会自动改库，需 `db:seed` 或管理端重置）
- [ ] 策略快照路径与 gateway 读取路径一致（与方言无关，但回退后易漏）
