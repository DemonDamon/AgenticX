# Enterprise 数据库迁移技术指南

> **适用场景**：把 `enterprise/packages/db-schema` 的 Drizzle 迁移文件推送到 Supabase Postgres，建立所有业务表。  
> **目标读者**：开发者、运维人员、新同事。  
> **最后更新**：2026-05-12

---

## 一、背景与原理

### 什么是 Drizzle 迁移？

[Drizzle ORM](https://orm.drizzle.team/) 是一个 TypeScript ORM。它的工作方式是：

1. 你在 `packages/db-schema/src/schema/` 里用 TypeScript **描述表结构**（字段类型、索引、约束等）。
2. 运行 `pnpm db:generate` → Drizzle 对比当前 schema 与历史快照，**生成增量 `.sql` 迁移文件**（保存在 `drizzle/` 目录）。
3. 运行 `pnpm db:migrate` → Drizzle 读取 `drizzle/` 下尚未在数据库执行过的 `.sql` 文件，**按序推送到数据库**。

### Supabase 在这里的角色

Supabase 提供一个标准 Postgres 数据库（托管版）。  
我们**只用它的 Postgres**，不使用 Supabase Auth / Row Level Security / Realtime 等功能。  
它与本地 docker-compose Postgres 的区别仅在于连接串不同。

---

## 二、前置条件

| 条件 | 说明 |
|------|------|
| Node.js ≥ 20 | `node --version` 确认 |
| pnpm ≥ 9 | `pnpm --version` 确认 |
| 已建 Supabase 项目 | 登录 [app.supabase.com](https://app.supabase.com) 新建项目 |
| 本地克隆了仓库 | `enterprise/` 目录可访问 |

---

## 三、获取 Supabase 连接串

1. 登录 Supabase → 选择你的项目。
2. 左侧菜单 **Settings → Database**。
3. 找到 **Connection string** 区域，选择 **URI** 标签。
4. 选择 **Direct connection**（**不要选 Supabase Pooler**）。

> ⚠️ 为什么要用 Direct connection？  
> `drizzle-kit migrate` 使用 `SET LOCAL` 事务语句，这与连接池（Pooler/PgBouncer）的 transaction mode 不兼容，必须走 Direct connection（端口 5432）。  
> Vercel 运行时代码可以用 Pooler（端口 6543），但迁移工具不能。

连接串格式如下：

```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require
```

把 `[YOUR-PASSWORD]` 替换为你在 Supabase 创建项目时设置的数据库密码。

#### 备注
`PROJECT-REF` 是 Supabase 给你的项目分配的唯一 ID，就是一串随机字母数字，比如 `abcdefghijklmn`。

**在哪里找：**

两个地方都能看到：

**方法 1**：直接看浏览器地址栏  
打开你的 Supabase 项目，URL 长这样：
```
https://supabase.com/dashboard/project/abcdefghijklmn
```
最后那段 `abcdefghijklmn` 就是 PROJECT-REF。

**方法 2**：Settings → Database → Connection string  
复制那里的完整 URI，里面已经把 PROJECT-REF 填好了，**不需要你自己找**，直接复制整条用就行：
```
postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghijklmn.supabase.co:5432/postgres
```

---

所以**最省事的做法**是：

去 Supabase → **Settings → Database → Connection string → URI → Direct connection**，点复制按钮，只需要把 `[YOUR-PASSWORD]` 替换成你建项目时设的密码，其他不用改，末尾加上 `?sslmode=require` 就完整了。
---

## 四、执行迁移（Step by Step）

### 步骤 1：进入 db-schema 包

```bash
cd enterprise/packages/db-schema
```

### 步骤 2：安装依赖（首次或更新后执行）

```bash
# 在仓库根 enterprise/ 执行
cd ../..
pnpm install
cd packages/db-schema
```

### 步骤 3：设置 DATABASE_URL 并执行迁移

```bash
export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require"

pnpm db:migrate
```

**正常输出示例**：

```
[drizzle-kit] Using 'pg' driver...
[drizzle-kit] Reading config...
[drizzle-kit] 11 migrations to apply
[drizzle-kit] Applying 0000_friendly_rictor...  ✓
[drizzle-kit] Applying 0001_smiling_tusk...     ✓
...
[drizzle-kit] Applying 0010_runtime_config_pg...✓
[drizzle-kit] All migrations applied successfully
```

### 步骤 4：跑 Seed（建初始管理员账号）

```bash
pnpm db:seed
```

这会在数据库里插入：
- 默认租户（`default`）
- 默认部门（`default`）
- 管理员账号 `admin@agenticx.local`
- 角色与绑定

> 如果要插入 IAM 演示数据（部门层级、示例用户）：
> ```bash
> pnpm db:seed:iam
> ```

### 步骤 5：在 Supabase 验证

打开 Supabase → **Table Editor** 或 **Database → Tables**，确认以下表已存在：

| 表名 | 说明 |
|------|------|
| `users` | 用户账号 |
| `roles` / `user_roles` | 角色与绑定 |
| `departments` | 部门 |
| `sso_providers` | SSO 配置 |
| `audit_events` | IAM 操作审计 |
| `gateway_audit_events` | AI 请求审计 |
| `chat_sessions` / `chat_messages` | 聊天历史 |
| `usage_records` | Token 用量 |
| `policy_rules` / `policy_packs` | 策略规则 |
| `enterprise_runtime_model_providers` | AI 供应商配置（新）|
| `enterprise_runtime_user_visible_models` | 用户可见模型（新）|
| `enterprise_runtime_token_quotas` | Token 配额（新）|
| `enterprise_runtime_policy_snapshots` | 策略快照（新）|
| `auth_refresh_sessions` | Refresh Token 持久化（新）|

共约 **17+ 张表**。

---

## 五、当前迁移文件清单

| 文件名 | 主要内容 |
|--------|----------|
| `0000_friendly_rictor.sql` | users / roles / departments 基础表 |
| `0001_smiling_tusk.sql` | user_roles 绑定 |
| `0002_cultured_ma_gnuci.sql` | audit_events |
| `0003_aberrant_archangel.sql` | chat_sessions / chat_messages |
| `0004_overrated_slyde.sql` | usage_records |
| `0005_supreme_boomer.sql` | policy_rules / policy_packs |
| `0006_complete_ben_parker.sql` | gateway_audit_events |
| `0007_typical_roulette.sql` | 索引与约束补充 |
| `0008_sso_providers.sql` | sso_providers |
| `0009_eager_famine.sql` | 字段补丁 |
| `0010_runtime_config_pg.sql` | enterprise_runtime_* + auth_refresh_sessions（最新）|

---

## 六、后续新增迁移的工作流

当 Schema 有变化时（新增字段、新表、改索引等）：

```bash
# 1. 修改 src/schema/*.ts
# 2. 生成新迁移文件
pnpm db:generate

# 3. 检查生成的 SQL（drizzle/XXXX_*.sql）
# 4. 推送到数据库
DATABASE_URL="..." pnpm db:migrate
```

Drizzle 会在数据库里维护一张 `drizzle.__drizzle_migrations` 表，记录哪些迁移已经执行过，**不会重复执行**已应用的迁移。

---

## 七、常见问题

### Q: 迁移报 `prepared statement already exists`
**原因**：用了 Pooler 连接。  
**解决**：换成 Direct connection（端口 5432）。

### Q: 迁移报 `SSL SYSCALL error: EOF detected`
**原因**：连接串缺少 `?sslmode=require`。  
**解决**：在连接串末尾加 `?sslmode=require`。

### Q: `pnpm db:migrate` 报找不到 `DATABASE_URL`
**解决**：确认已 `export DATABASE_URL=...`，或在命令前内联：
```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

### Q: Seed 报 `duplicate key value`
**原因**：已经跑过一次 seed。  
**解决**：忽略，数据已存在，不影响使用。

### Q: 如何重置数据库（危险操作）
```bash
# 仅用于开发/测试环境，会清空所有数据！
# 在 Supabase Dashboard → Database → Reset Database
# 然后重新执行 pnpm db:migrate && pnpm db:seed
```

---

## 八、配套文件索引

| 文件 | 说明 |
|------|------|
| `enterprise/packages/db-schema/src/schema/` | TypeScript Schema 定义 |
| `enterprise/packages/db-schema/drizzle/` | 迁移 SQL 文件 |
| `enterprise/packages/db-schema/scripts/db-seed.mjs` | 基础 Seed |
| `enterprise/packages/db-schema/drizzle.config.ts` | Drizzle 配置（读 `DATABASE_URL`）|
| `enterprise/.local-secrets/web-portal.env` | 本地 Vercel env 草稿（不入库）|
| `enterprise/docs/deployment/vercel-env-checklist.md` | Vercel 环境变量完整清单 |
