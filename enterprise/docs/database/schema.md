# 数据库 Schema

ORM：**Drizzle ORM** + PostgreSQL  
包：`@agenticx/db-schema`（`packages/db-schema/`）  
迁移：`packages/db-schema/drizzle/`（0000 → 0011，含 `0011_gateway_channels.sql`）

---

## 迁移与 Seed

```bash
# bootstrap.sh 自动执行
pnpm --filter @agenticx/db-schema db:migrate
pnpm --filter @agenticx/db-schema db:seed
```

可选演示 IAM 数据：`iam-demo-seed.mjs`（配合 `reset-dev-data.sh --with-iam-seed`）。

---

## 表分组

### IAM 核心

| 表 | 说明 |
|---|---|
| `tenants` | 租户（code, name, plan） |
| `organizations` | 组织 |
| `departments` | 部门树（parent_id, path） |
| `users` | 用户（email, password_hash, dept_id, 软删除, 锁定） |
| `roles` | 角色（code, scopes JSONB, immutable 系统角色） |
| `user_roles` | 用户-角色（含 scope_org/dept 范围） |
| `sso_providers` | SSO Provider 配置（OIDC/SAML，secret 加密） |

### 聊天

| 表 | 说明 |
|---|---|
| `chat_sessions` | 会话（title, active_model, soft delete, user_id） |
| `chat_messages` | 消息（role, content, model, metadata JSONB） |

### 计量

| 表 | 说明 |
|---|---|
| `usage_records` | Token 用量（tenant/dept/user/provider/model/time_bucket） |

### 审计（分表）

| 表 | 用途 |
|---|---|
| `audit_events` | **IAM 管理操作**审计（admin CRUD） |
| `gateway_audit_events` | **LLM 调用**审计（checksum 链, policies_hit, digest） |

勿混淆两表；gateway 查询走 `gateway_audit_events`。

### 策略

| 表 | 说明 |
|---|---|
| `policy_rule_packs` | 规则包（code, applies_to JSONB） |
| `policy_rules` | 规则（kind, action, severity, payload, status draft/active） |
| `policy_rule_versions` | 规则版本快照 |
| `policy_publish_events` | 发布事件（snapshot JSON） |

`applies_to` 支持：`departmentIds`, `roleCodes`, `userIds`, `clientTypes`, `stages` 等。

### 运行时配置（PG 化）

| 表 | 原 JSON | 说明 |
|---|---|---|
| `enterprise_runtime_model_providers` | providers.json | Provider + api_key_cipher |
| `enterprise_runtime_user_visible_models` | user-models.json | 用户可见 model id |
| `enterprise_runtime_token_quotas` | quotas.json | 租户配额整包 |
| `enterprise_runtime_policy_snapshots` | policy-snapshot.json | 已发布策略 |
| `auth_refresh_sessions` | — | Portal refresh token（serverless） |
| `gateway_channels` | — | Gateway 上游 Channel |

迁移 CLI：`pnpm migrate:legacy-runtime` → `scripts/migrate-runtime-legacy.ts`

---

## 关键字段说明

### enterprise_runtime_model_providers

- `provider_id` — 逻辑 id（如 `deepseek`）
- `base_url` — OpenAI 兼容根地址（通常以 `/v1` 结尾）
- `api_key_cipher` — AES-256-GCM，密钥 `AGX_PROVIDER_SECRET_KEY`
- `route` — `local` | `private-cloud` | `third-party`
- `models` — JSONB 数组，含 model 名、enabled、displayName

### gateway_audit_events

- `checksum` / `prev_checksum` — Blake2b 哈希链
- `policies_hit` — JSONB 命中规则数组
- `tenant_id`, `dept_id`, `user_id`, `session_id` — 主体四维

### policy_rules.status

- `draft` — 未进入 Gateway 快照
- `active` — 已发布
- 软删除：行置灰，可恢复或永久删除

---

## 租户隔离

- 几乎所有业务表含 `tenant_id` FK → `tenants.id`
- API 层从 JWT 注入 tenant，禁止跨租户读写
- Internal API 在单租户部署返回全量；多租户扩展需带 tenant 过滤（以实现为准）

---

## ER 关系（简图）

```
tenants
  ├── organizations / departments / users
  ├── roles ← user_roles → users
  ├── chat_sessions → chat_messages
  ├── usage_records
  ├── audit_events (IAM)
  ├── gateway_audit_events (LLM)
  ├── policy_rule_packs → policy_rules → policy_rule_versions
  ├── enterprise_runtime_* (配置)
  ├── gateway_channels
  └── sso_providers
```

---

## 源码索引

| 表定义文件 | 表 |
|---|---|
| `schema/tenants.ts` | tenants |
| `schema/users.ts` | users |
| `schema/departments.ts` | departments |
| `schema/roles.ts`, `user-roles.ts` | roles, user_roles |
| `schema/chat-*.ts` | chat_sessions, chat_messages |
| `schema/usage-records.ts` | usage_records |
| `schema/audit-events.ts` | audit_events |
| `schema/gateway-audit-events.ts` | gateway_audit_events |
| `schema/policy.ts` | policy_* |
| `schema/runtime-config.ts` | enterprise_runtime_*, auth_refresh_sessions |
| `schema/gateway-channels.ts` | gateway_channels |
| `schema/sso-providers.ts` | sso_providers |

导出汇总：`schema/index.ts`

---

## 相关文档

- [gateway/runtime-config.md](../gateway/runtime-config.md)
- [deployment/supabase-migration-guide.md](../deployment/supabase-migration-guide.md)
- [runbooks/audit-pg-backfill.md](../runbooks/audit-pg-backfill.md)
