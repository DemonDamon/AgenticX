# Supabase Seed TLS 踩坑记录（2026-05-12）

## 背景

在 `enterprise/packages/db-schema` 执行：

```bash
pnpm db:seed
```

连接 Supabase（`db.<project-ref>.supabase.co:5432`）时，持续报错：

```text
Seed failed: Error: self-signed certificate in certificate chain
code: 'SELF_SIGNED_CERT_IN_CHAIN'
```

最终 seed 成功输出：

```text
Seed complete: default tenant + admin + super_admin.
```

---

## 现象与误判

- 现象：报错看起来像连接问题，容易误判成数据库密码错误。
- 实际：不是密码错误。  
  如果是密码错误，通常会看到 `password authentication failed` 之类的提示。

---

## 根因

`pg` 在解析连接串时，若存在 `sslmode=require`，会把代码里传入的 `ssl` 对象行为覆盖为强校验链路径。  
结果是即便代码里写了：

```js
ssl: { rejectUnauthorized: false }
```

也可能不生效，从而触发 `SELF_SIGNED_CERT_IN_CHAIN`。

---

## 修复方案（已落地）

新增统一 helper：

- `enterprise/packages/db-schema/scripts/pg-seed-client-config.mjs`

并让以下 seed 脚本统一复用：

- `enterprise/packages/db-schema/scripts/db-seed.mjs`
- `enterprise/packages/db-schema/scripts/iam-demo-seed.mjs`

核心策略：

1. 对 `*.supabase.co` 默认启用 seed 友好的 TLS 配置：
   - `ssl: { rejectUnauthorized: false }`
2. 连接串里自动剥离会覆盖行为的参数：
   - `sslmode`
   - `sslrootcert`
   - `sslcert`
   - `sslkey`
3. 提供开关：
   - `DATABASE_SSL_REJECT_UNAUTHORIZED=true`：强制严格校验
   - `DATABASE_SSL_REJECT_UNAUTHORIZED=false`：强制放宽（任意主机）

---

## 推荐执行方式

在 `db-schema` 目录执行：

```bash
cd /Users/damon/myWork/AgenticX/enterprise/packages/db-schema
export DATABASE_URL="postgresql://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres"
pnpm db:seed
```

> 建议连接串不显式带 `sslmode=require`（seed 场景）。  
> 由脚本内 helper 统一处理 TLS 兼容逻辑，减少环境差异。

---

## 验证结果

Seed 成功后会写入基础 IAM 数据：

- 默认租户：`default`
- 默认管理员：`admin@agenticx.local`
- 角色：`super_admin`

---

## 安全注意事项

1. `rejectUnauthorized: false` 仅用于本机 seed / 开发排障，不建议直接复制到生产主链路。
2. 若在终端/聊天中暴露过明文数据库密码，建议立即在 Supabase 控制台轮换密码并更新 `DATABASE_URL`。
3. 生产环境优先使用平台推荐的 TLS/CA 方案，避免长期依赖放宽校验。

---

## 仍失败时的排障顺序

1. 确认使用的是 Supabase **Direct connection (5432)**。
2. 确认 `DATABASE_URL` 里 host 为 `db.<PROJECT-REF>.supabase.co`。
3. 检查是否存在代理/证书相关环境变量影响 Node TLS：
   - `HTTPS_PROXY`
   - `HTTP_PROXY`
   - `ALL_PROXY`
   - `NODE_EXTRA_CA_CERTS`
4. 用最小命令复测：

```bash
node ./scripts/db-seed.mjs
```

若仍失败，保留完整堆栈日志继续定位（重点看 TLS 与代理链）。
