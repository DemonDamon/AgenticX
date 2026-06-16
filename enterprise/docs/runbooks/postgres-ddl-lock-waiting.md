# PostgreSQL `CREATE TABLE waiting` 进程堆积排查 Runbook

## 适用场景

客户或运维在测试 / POC 服务上看到大量类似进程：

```text
postgres: <db_user> <database> <client_ip>(<port>) CREATE TABLE waiting
```

典型来源是 PostgreSQL 的 `ps` / `top` / `htop` 进程列表。这里每一行不是一个独立的业务应用进程，而是 PostgreSQL 为某个客户端连接派生的后端连接进程。

如果进程名里出现 `CREATE TABLE waiting`，说明该连接正在执行建表类 DDL，但当前处于等待状态，通常是在等锁。

## 快速结论

这类现象通常不是「Postgres 自己异常起了很多进程」，而是某个客户端正在重复或并发执行数据库迁移 / 建表脚本。

在 AgenticX Enterprise 场景中，优先排查是否有以下行为：

- 多个服务副本同时启动时都执行了 `db:migrate`。
- 部署脚本或守护进程把 `bootstrap.sh` 当成应用启动命令反复执行。
- 测试服务重启策略不断拉起初始化脚本，导致迁移重复进入。
- 多人或 CI 同时对同一套测试库运行迁移。
- 某个迁移事务卡住后，后续迁移连接都排队等待锁。

## 影响判断

### 低风险迹象

- 只有 1 个迁移进程，等待时间很短。
- 部署正在进行中，数秒到数十秒后自动消失。
- 应用访问正常，数据库连接数未接近上限。

### 高风险迹象

- 同一 `client_addr` 出现很多条 `CREATE TABLE waiting`。
- 等待时间持续数分钟以上。
- 连接数持续上涨，接近 `max_connections`。
- 应用接口开始报连接池耗尽、超时、登录失败或 500。
- `pg_blocking_pids(pid)` 能看到同一个阻塞源 pid。
- 客户的启动脚本 / systemd / docker compose / CI 正在循环执行迁移命令。

## 第一阶段：确认当前等待和阻塞关系

在目标 PostgreSQL 上执行：

```sql
SELECT
  pid,
  usename,
  datname,
  client_addr,
  application_name,
  state,
  wait_event_type,
  wait_event,
  now() - backend_start AS backend_age,
  now() - query_start AS query_age,
  pg_blocking_pids(pid) AS blocking_pids,
  left(query, 500) AS query
FROM pg_stat_activity
WHERE query ILIKE '%CREATE TABLE%'
   OR wait_event_type = 'Lock'
ORDER BY query_start NULLS LAST;
```

重点看：

- `client_addr`：是不是同一台应用 / 测试服务器反复发起。
- `query_age`：等待了多久。
- `blocking_pids`：是否被某个 pid 阻塞。
- `application_name`：如果客户端设置了名称，可直接定位来源。
- `query`：具体卡在哪条迁移 SQL。

继续查看阻塞源：

```sql
WITH blocked AS (
  SELECT
    pid AS blocked_pid,
    unnest(pg_blocking_pids(pid)) AS blocker_pid
  FROM pg_stat_activity
  WHERE cardinality(pg_blocking_pids(pid)) > 0
)
SELECT
  blocked.blocked_pid,
  blocker.pid AS blocker_pid,
  blocker.usename,
  blocker.datname,
  blocker.client_addr,
  blocker.application_name,
  blocker.state,
  blocker.wait_event_type,
  blocker.wait_event,
  now() - blocker.query_start AS blocker_query_age,
  left(blocker.query, 800) AS blocker_query
FROM blocked
JOIN pg_stat_activity blocker ON blocker.pid = blocked.blocker_pid
ORDER BY blocker.query_start NULLS LAST;
```

如果大量等待进程都被同一个 `blocker_pid` 卡住，先定位并处理阻塞源，不要盲目重启所有服务。

## 第二阶段：判断是不是迁移并发

查看迁移相关连接：

```sql
SELECT
  pid,
  client_addr,
  application_name,
  state,
  wait_event_type,
  wait_event,
  now() - query_start AS query_age,
  left(query, 500) AS query
FROM pg_stat_activity
WHERE query ILIKE '%CREATE TABLE%'
   OR query ILIKE '%ALTER TABLE%'
   OR query ILIKE '%drizzle%'
   OR query ILIKE '%__drizzle_migrations%'
ORDER BY query_start;
```

查看当前库的连接分布：

```sql
SELECT
  client_addr,
  usename,
  datname,
  application_name,
  state,
  count(*) AS connections
FROM pg_stat_activity
GROUP BY client_addr, usename, datname, application_name, state
ORDER BY connections DESC;
```

如果同一个应用服务器 IP 有大量 `CREATE TABLE` 或 `idle in transaction` 连接，基本可以判断是该服务器上的启动 / 部署流程在重复执行迁移。

## 第三阶段：现场止血

### 1. 先停止继续制造新连接

优先在应用侧停止重复迁移来源，例如：

- 暂停 CI / 发布任务。
- 停止重复拉起的 systemd service。
- 停止正在循环重启的容器。
- 临时将应用副本数降到 0 或 1。
- 确认服务启动命令不是初始化脚本。

不要先只杀数据库进程。如果应用侧还在循环执行迁移，杀掉后会马上重新堆积。

### 2. 识别是否可以终止阻塞源

先看阻塞源在做什么。如果阻塞源是长时间空闲事务或已确认异常卡住，可以由 DBA 执行：

```sql
SELECT pg_terminate_backend(<blocker_pid>);
```

如果只是终止等待中的重复迁移连接：

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE query ILIKE '%CREATE TABLE%'
  AND wait_event_type = 'Lock'
  AND pid <> pg_backend_pid();
```

注意：生产库上终止连接前必须确认业务影响。DDL / 迁移中断后，需要重新执行一次完整迁移确认 schema 状态。

### 3. 单实例重跑迁移

止血后，只保留一个迁移执行者，手动跑一次迁移：

```bash
cd enterprise
pnpm --filter @agenticx/db-schema db:migrate
```

如果迁移失败，查看迁移日志或终端完整错误，不要并发重试。

## AgenticX Enterprise 相关排查点

### 迁移入口

当前 Enterprise 里有两个常见入口会触发迁移：

- `scripts/bootstrap.sh`：初始化 / 首次部署脚本，会执行 `db:migrate`、`db:seed`、`migrate:legacy-runtime`。
- `scripts/start-dev.sh`：本地开发启动脚本；当 `AGX_AUTO_DB_MIGRATE=1` 且 `DATABASE_URL` 指向 `localhost` / `127.0.0.1` 时会自动跑迁移。

`bootstrap.sh` 不应作为长期运行服务的启动命令，也不应被多副本同时执行。

### 推荐部署原则

生产或客户测试环境建议遵循：

1. 迁移作为独立发布步骤执行一次。
2. 迁移成功后再启动 / 滚动更新应用服务。
3. 应用服务启动命令只启动应用，不执行 `bootstrap.sh`。
4. 多副本部署时，不允许每个副本启动都执行 `db:migrate`。
5. 如必须自动迁移，应加分布式锁或平台级单实例 job，不能让多个 pod / 容器同时执行。

### 本地开发脚本注意事项

`start-dev.sh` 面向本地开发环境，不建议直接用于客户测试服务的常驻启动。

如果临时使用，至少确认：

```bash
export AGX_AUTO_DB_MIGRATE=0
```

然后由运维单独执行一次：

```bash
pnpm --filter @agenticx/db-schema db:migrate
```

## 常见根因与修复

### 根因 1：把 `bootstrap.sh` 配成了服务启动命令

现象：

- 每次容器 / 服务重启都会重新执行 `db:migrate`。
- 多个服务副本同时启动时，数据库出现多条 `CREATE TABLE waiting`。

修复：

- 将 `bootstrap.sh` 从应用启动命令中移除。
- 只在首次初始化或人工维护窗口执行。
- 服务启动命令改为实际应用启动命令。

### 根因 2：多副本同时执行迁移

现象：

- 部署时短时间出现多个来源相同的 `CREATE TABLE waiting`。
- 等待连接数与副本数或重启次数相关。

修复：

- 将迁移放到 CI/CD 的单独 job。
- 应用副本启动前等待迁移 job 完成。
- 不要在每个应用容器 entrypoint 中执行迁移。

### 根因 3：上一次迁移卡在事务里

现象：

- 有一个 `idle in transaction` 或长时间运行的 blocker。
- 后续 DDL 都在等它释放锁。

修复：

- 查清 blocker 查询来源。
- 确认可中断后 `pg_terminate_backend(blocker_pid)`。
- 重新单实例执行迁移。

### 根因 4：Drizzle 迁移失败后被部署系统循环重试

现象：

- 部署日志里反复出现 `db:migrate`。
- 数据库中等待进程持续新增。
- 终端可能只显示摘要错误，缺少底层 PostgreSQL 错误。

修复：

- 先暂停重试。
- 查看 `enterprise/.runtime/logs/db-migrate-*.log` 或部署平台日志。
- 修复真实迁移错误后，再单实例重跑。

## 建议客户回传的信息

请客户一次性回传以下信息，避免来回猜测：

1. PostgreSQL 上述两段 SQL 的输出。
2. 应用服务器上当前启动命令 / systemd unit / docker compose / Kubernetes manifest。
3. 部署时是否执行过 `bootstrap.sh`、`start-dev.sh` 或 `pnpm --filter @agenticx/db-schema db:migrate`。
4. 是否有多个副本、多个容器或 CI 任务同时连接同一数据库。
5. `db:migrate` / bootstrap 的完整日志。
6. 数据库连接数上限与当前连接数：

```sql
SHOW max_connections;

SELECT count(*) AS current_connections
FROM pg_stat_activity;
```

## 预防清单

- 迁移脚本只允许一个执行者。
- 应用启动路径不得默认执行建表 / 迁移。
- 测试环境和生产环境都应把迁移纳入发布流程，而不是运行时自发执行。
- 部署平台开启失败重试时，迁移失败必须 fail fast，不要无限循环。
- 监控 PostgreSQL `waiting` / `Lock` / 连接数 / 长事务。
- 对 `idle in transaction` 设置合理告警。
- 客户现场交付文档里明确区分「初始化命令」和「服务启动命令」。

## 推荐沟通口径

可以这样向客户解释：

> 截图里这些不是业务应用起了很多异常进程，而是 PostgreSQL 为客户端连接派生的连接进程。`CREATE TABLE waiting` 表示有连接正在执行建表 / 迁移 SQL，但在等待数据库锁。结合现象，优先怀疑测试服务上有部署脚本或多个服务副本在重复、并发执行数据库迁移。建议先暂停重复启动 / 部署任务，查询阻塞源 pid，确认后终止异常阻塞连接，再用单实例方式执行一次完整迁移。

