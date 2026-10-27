# MA-E06 Vault 凭证库控制面（只写不读 · 信封加密 · 会话级解析）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W4 · MA-E06）
Depends-on:
- MA-E01 `.cursor/plans/2026-10-25-ma-e01-schema.plan.md`（已实现：`0061_ma_control_plane.sql`、`ma_sessions.vault_ids` jsonb 列）
- MA-E02 `.cursor/plans/2026-10-25-ma-e02-agent-versioning-admin.plan.md`（已实现：`lib/ma/{errors,http,pat-auth,internal-auth,records}.ts`、`/api/ma/v1/*` 与 `/api/internal/ma/*` 的写法、`MA_CONTROL_PLANE_ERROR_CODES`）
- MA-E05 `.cursor/plans/2026-10-25-ma-e05-session-console.plan.md`（已实现：`iam-core/src/repos/ma-sessions-read.ts` 的 `getMaSession`）
- MA-E03 `.cursor/plans/2026-10-25-ma-e03-agent-runtime-service.plan.md`（**尚未实现**；它新增迁移 `0062_ma_work_inbox`（PG）/ `0036_ma_work_inbox`（MySQL）并改 `start-dev.sh`、`bootstrap.sh`、`.env.local.example`、`prod.yml`。本子规划的迁移编号与脚本改动都排在它之后，**以实际实现为准，实施前核对**）
- 消费方：MA-A06 `.cursor/plans/pending/2026-10-25-ma-a06-credential-broker.plan.md`（调用本子规划的两个内部接口）

> 风险等级：高（持有可解密的第三方凭证）。合入前建议强推理档只读审查。
>
> **实施前必须核对的三件事**（任何一项与本文不符，按实际调整编号 / 计数，不得改动已合入迁移）：
> 1. `ls enterprise/packages/db-schema/drizzle | tail -3` 与 `drizzle-mysql | tail -3`：E03 合入后末尾应是 `0062_ma_work_inbox.sql` / `0036_ma_work_inbox.sql`。本子规划用 **PG `0063_ma_vaults` / MySQL `0037_ma_vaults`**；MA-E07 用 `0064` / `0038`。若 E03 尚未合入，仍保留 0063 / 0037 编号空位**不可行**（journal idx 必须连续）——此时先等 E03 合入，或经用户确认后改用 0062 / 0036 并通知 E03 / E07 顺延。
> 2. `migration-inventory.test.ts` 中 journal 条数与磁盘文件数（E03 后应为 62 / 64）。
> 3. `schema-parity.test.ts` 中 PG 表数（E01 后为 79，E03 不加表）。

---

## 0. 一句话目标

在 admin-console + iam-core 落地 Vault 资源：`ma_vaults` / `ma_credentials` 两张表（双方言），四种凭证类型（`static_bearer` / `mcp_oauth` / `bearer` / `environment_variable`），密钥用 `@agenticx/auth` 现有 `encryptSecret` 做**两层信封加密**；对外只写不读（响应永不回显密钥，只给 `has_secret` / `expires_at`）；支持部分更新轮换、归档、删除（UI 二次确认）、`referenced_by`；管理台新增「凭证库」页；公共接口 `/api/ma/v1/vaults*`（`ma:vaults:read` / `ma:vaults:write`）；内部接口 `POST /api/internal/ma/vaults/validate` 与 `POST /api/internal/ma/vault-resolve`（仅 agent-runtime，`MA_INTERNAL_TOKEN`，**每次调用写一条 `audit_events`**）。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 节 | 约束 | 本子规划落点 |
|---|---|---|
| §1.2 | Vault「只写不读；运行时在出站边界注入；Agent 与沙箱拿不到明文」 | §5.3 写接口不回显；§5.6 解析只给 agent-runtime |
| §2.3 | `ma_vaults`、`ma_credentials` 唯一写入方 = admin-console（经 iam-core repos）；agent-runtime 调 `/api/internal/ma/*`（`MA_INTERNAL_TOKEN`） | §5.2 repo；§5.6 内部接口；agent-runtime 不直连这两张表 |
| §4 决策 4 | 控制面资源公共 API 由 admin-console `/api/ma/v1/*` 提供（nginx 已按 `vaults` 前缀分流，见 E03 §5.15） | §5.4 |
| §4 决策 8 | Manifest 不得出现密钥；MCP 凭证只经 Vault 按 URL 匹配注入 | §5.1 `mcp_server_url` 归一化规则（A06 用同一规则匹配） |
| §5.2 | Session 有 `vault_ids` 字段 | 内部解析接口以 `ma_sessions.vault_ids` 为准做子集校验 |
| §7 W4 门 | 「管理员在 Vault 里登记一个 MCP Bearer 和一个 `environment_variable` 凭证（限定 `allowed_hosts`）」 | §5.8 管理页；AC FR-13 |
| §9 MA-E06 | 新表、四类型、信封加密复用 `packages/auth`、只写不读、轮换、`referenced_by`、`vault-resolve` 按会话审计 | 全文 |
| §12 第 2 行 | 控制面扩展错误码放 admin-console 本地常量 `MA_CONTROL_PLANE_ERROR_CODES`，不进 MA-00 `ALL_ERROR_CODES` | §5.5 新增 7 个码（**须先在 master §12 登记，见 §10.3**） |

### 1.2 调研语义（对齐对象，`research/managed-agents/`）

| 来源 | 语义 | 采纳 |
|---|---|---|
| `zhipu/vaults.md` L40-48 | 五种类型及不可变身份键（`mcp_server_url` / `host` / `secret_name`） | 采纳其中四种（不做 `oauth`，见 Out of scope） |
| `zhipu/vaults.md` L111 | `environment_variable` 必须声明 `networking`：`unrestricted` 或 `limited` + `allowed_hosts`（≤16，支持 `*.example.com`） | §5.1 校验规则逐字落实 |
| `zhipu/vaults.md` L115 | 会话 `vault_ids` ≤20、不重复、顺序即优先级 | A06 校验；本子规划内部解析按 `vault_ids` 顺序输出 |
| `zhipu/vaults.md` L130-148 | 轮换 = 部分更新，提供的 secret 替换、省略的保留；身份字段必须省略；`auth.type` 必须与原值相同；`refresh: null` 清除刷新配置 | §5.3 `rotateCredential` |
| `zhipu/vaults.md` L160、L172 | 读接口只返回非敏感字段；Vault 归档清除 active 凭证密文并阻止新会话引用 | §5.2 `archiveVault` 清空密文 |
| `volcengine/use-vaults-authentication.md` L244-249 | 同一 Vault 内有效凭证匹配键唯一（重复 409）；每 Vault ≤100 条凭证（超限 409） | `active_identity_key` 唯一索引；`vault_credential_limit` |
| `volcengine/use-vaults-authentication.md` L76-78、L302-306 | OAuth 在读取时进入 `expires_at` 前 5 分钟窗口才刷新，非后台定时 | §5.6 解析时刷新 |
| `bailian/managed-agents-credential-security.md` L31-53 | 占位符模型、`allowed_hosts` 只决定替换范围 | 本子规划只存 `networking`；替换语义由 A06 实现 |

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `enterprise/packages/auth/src/services/secret-cipher.ts` | 1-57 | `encryptSecret(plain, secretKey)`：HKDF-SHA256 派生 32 字节键 + AES-256-GCM，输出 base64url(iv‖tag‖ct)；`decryptSecret` 反向；`assertStrongSecretKey` 要求 ≥32 字符且 ≥8 种不同字符 | **两层信封都用它**：外层用主密钥包 DEK，内层用 DEK 加密密钥 JSON（§5.1.4） |
| `enterprise/packages/auth/src/index.ts` | 4、17 | 已导出 `secret-from-env`、`secret-cipher` | 直接 `import { encryptSecret, decryptSecret, readSecretFromEnv } from "@agenticx/auth"` |
| `enterprise/packages/auth/src/services/secret-from-env.ts` | 13-33 | `readSecretFromEnv(name)`：裸变量优先，其次 `<NAME>_FILE` | 主密钥读取 `MA_VAULT_MASTER_KEY` / `_FILE` |
| `enterprise/packages/iam-core/src/provider-api-key-crypto.ts` | 5-13 | 未配置密钥时用写死的开发密钥，解密失败静默返回 `""` | **不复用**：开发兜底密钥 = 所有开发库可互解；静默失败会把"解不开"伪装成"无密钥" |
| `enterprise/packages/iam-core/package.json` | 20 | iam-core 已依赖 `@agenticx/auth` | 加密模块放 iam-core，无需新依赖 |
| `enterprise/apps/admin-console/src/lib/ma/errors.ts` | 6-11、46-87 | `MA_CONTROL_PLANE_ERROR_CODES` 常量 + `statusFor` 穷举 + `maErrorFromException` 按 `error.name` 映射 | 追加 7 个码与对应异常名映射 |
| `enterprise/apps/admin-console/src/lib/ma/pat-auth.ts` | 14-56 | `requireMaPat(request, scope)`；`ma:admin` 放行全部 | 公共接口沿用 |
| `enterprise/apps/admin-console/src/lib/ma/internal-auth.ts` | 9-58 | `isMaInternalAuthorized(request)`（timingSafeEqual）、`maInternalUnauthorized()` | 内部接口沿用 |
| `enterprise/apps/admin-console/src/lib/ma/http.ts` | 1-48 | `ULID_RE`、`TENANT_ID_RE`、`MaRequestError`、`readJsonObject`、`assertOnlyKeys` | 沿用 |
| `enterprise/apps/admin-console/src/app/api/internal/ma/environments/[envId]/route.ts` | 1-27 | 内部接口样板：`noStore()`、`tenant_id` 查询参数校验 | 照抄结构 |
| `enterprise/apps/admin-console/src/app/api/ma/v1/environments/route.ts` | 1-77 | 公共接口样板：`requireMaPat` → `readJsonObject` → `assertOnlyKeys` → repo → `{environment: record}`，201 | 照抄结构 |
| `enterprise/apps/admin-console/src/app/api/admin/ma-environments/route.ts` | 1-50 | 管理台接口样板：`requireAdminScope(["provider:read"])`、`requiredTenantId()`、`{code:"00000",message:"ok",data}` | 照抄；scope 复用 `provider:*`（§2 D6） |
| `enterprise/packages/iam-core/src/repos/ma-environments.ts` | 1-140 | repo 样板：`isMysql()`、`getIamDb()`、`ulid()`、`isUniqueViolation`、具名错误类、mysql 分支在 `repos/mysql/ma-environments.ts` | 照抄 |
| `enterprise/packages/iam-core/src/repos/audit.ts` | 7-36 | `insertAuditEvent({tenantId, actorUserId, eventType, targetKind, targetId, detail}, dbOrTx?)` | 审计落 `audit_events`（§2 D4） |
| `enterprise/packages/db-schema/drizzle/0005_supreme_boomer.sql` | 1-21 | `audit_events.event_type varchar(64)`、`target_kind varchar(32)`、`actor_user_id` 外键 `users(id)` | `actor_user_id` 对解析事件一律写 `null`（会话用户 id 可能不在 `users` 表，见 §2 D4） |
| `enterprise/packages/iam-core/src/repos/ma-sessions-read.ts` | 37-39、174-198、298 | `getMaSession(tenantId, id)` 返回 `vaultIds: string[]`、`status`、`archivedAt` | 解析接口做「请求 vault ⊆ 会话 vault_ids」校验 |
| `enterprise/packages/db-schema/src/schema/ma-environments.ts`、`mysql-schema/ma-environments.ts` | 全文 | drizzle 双方言样板（`ulid()`、`auditColumns`、`jsonb` / `json`） | 新 schema 文件照抄 |
| `enterprise/packages/db-schema/drizzle-mysql/0035_ma_control_plane.sql` | 1-4 | MySQL 约定：JSON 默认值写 `DEFAULT (JSON_OBJECT())`；不写 CHARSET；`datetime(6) DEFAULT (UTC_TIMESTAMP(6))` | DDL 照此写 |
| `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts` | 21、57-58、140-155、171-208 | MySQL 专用辅助列白名单；PG 表数 79；MySQL 文件清单与 journal 逐条列出 | 改 81 张表、追加 `0037_ma_vaults` |
| `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts` | 16-49 | journal 条数、末 3 tag、磁盘 `.sql` 数 | 改为 63 / 65 |
| `enterprise/apps/admin-console/src/lib/admin-platform-sections.ts` | 2-15 | 平台页 slug 白名单（测试逐项断言） | 在 `"agent-environments"` 后插入 `"agent-vaults"` |
| `enterprise/apps/admin-console/src/app/admin/[section]/page.tsx` | 1-30 | slug → 组件映射 | 注册 `AgentVaultsSection` |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | 114-118 | 平台分组导航项 | 在「执行环境」后加「凭证库」（图标 `KeyRound` 已被 API 令牌占用，用 `LockKeyhole`） |
| `docs/managed-agents/threat-model.md` | 7-14 | 凭证泄露一节把「Vault 只写不读」交给 MA-E06 | 本子规划补充落地说明 |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **两层信封，全部复用 `encryptSecret`**：每条凭证随机生成 DEK（32 字节 → base64url 43 字符），`secret_ciphertext = encryptSecret(JSON.stringify(secrets), dek)`，`wrapped_dek = encryptSecret(dek, masterKey)`，`kek_id = sha256(masterKey).hex[0:16]`。主密钥 `MA_VAULT_MASTER_KEY`（或 `_FILE`），可选 `MA_VAULT_MASTER_KEY_PREVIOUS` 用于主密钥轮换期解旧行 | 「复用 `packages/auth`」的字面要求；DEK 让主密钥轮换只需重包 DEK；不引入 KMS |
| D2 | **主密钥缺失 fail-closed**：任何需要加解密的接口返回 503 `vault_crypto_unavailable`；只读元数据接口（列表、详情）照常工作。**没有开发兜底密钥**；本地由 `start-dev.sh` / `bootstrap.sh` 生成 `.local-secrets/ma_vault_master.key` | 避免 `provider-api-key-crypto.ts` 式的写死开发密钥 |
| D3 | **管理台是唯一写入方，agent-runtime 只经内部接口拿解密结果**；内部解析接口校验「请求的 vault_ids ⊆ `ma_sessions.vault_ids`」、会话未归档 / 未终止 | master §2.3；纵深防御：即便内部 token 泄露，也要先有一条引用该 Vault 的会话行 |
| D4 | **审计落 `audit_events`**（不新建表、不用 `gateway_audit_events`）。事件：`ma.vault.create/update/archive/delete`、`ma.credential.create/rotate/archive/delete/refresh`、`ma.vault.resolve`。`target_kind`：`ma_vault` / `ma_credential` / `ma_session`。解析事件 `actor_user_id = null`、会话用户放 `detail.session_user_id`（会话用户 id 可能是 on-behalf-of 写入的任意 ULID，写进外键列会失败）。**审计写入失败 → 解析接口返回 500 且不返回任何密钥** | `audit_events` 本就是 IAM / 管理面 CRUD 审计表、管理台审计页已能查询；`gateway_audit_events` 是网关模型调用审计链，归网关写；新建表没有收益 |
| D5 | **身份键唯一**用同一个辅助列 `active_identity_key`（两种方言都建）：active 时 = `<identity_kind>:<identity_key>`，归档时置 `NULL`；唯一索引 `(vault_id, active_identity_key)`。PG 与 MySQL 的唯一索引都允许多个 NULL | MySQL 无部分索引；两方言同列避免改 parity 白名单 |
| D6 | **管理台权限复用 `provider:read` / `provider:update` / `provider:delete`**（与模型服务 API Key 同等敏感），不往 `SCOPE_REGISTRY` 新增资源 | 不改 iam-core 角色体系；见 §10.3 Q2 |
| D7 | **删除两步走**：凭证可直接删除（UI 二次确认）；Vault 必须先归档才能删除（否则 409 `vault_not_archived`），删除级联删凭证。会话里残留的 vault id 在解析时进入 `skipped`（`not_found`） | 对应 AGENTS.md「破坏性操作二次确认」；归档已清密文，删除只是清元数据 |
| D8 | **`mcp_oauth` 自动刷新放在解析接口里**（读取触发，非定时）：`refresh` 已配置且 `expires_at` 距今 ≤300 秒（或已过期）时，admin-console 调 `token_endpoint` 换新 token 并回写；失败保留旧 token，该凭证带 `refresh_error: "failed"`，并写 `ma.credential.refresh` 审计（`detail.ok=false`） | 与 `volcengine/use-vaults-authentication.md` L76-78 一致；回写由 admin-console 完成，不破坏单写入方 |
| D9 | **不做创建时 MCP 握手探测与 `mcp_oauth_validate`** | 需要从 admin-console 出站到任意 MCP URL（SSRF 面）；列入后续，见 §10.3 Q3 |
| D10 | **`mcp_server_url` 归一化规则**（TS 与 Python A06 必须逐字一致）：见 §5.1.2 | MCP 凭证按 URL 匹配；规则不一致 = 静默未认证 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

db-schema（TS）：
- 新建 `enterprise/packages/db-schema/drizzle/0063_ma_vaults.sql`
- 新建 `enterprise/packages/db-schema/drizzle-mysql/0037_ma_vaults.sql`
- 修改 `enterprise/packages/db-schema/drizzle/meta/_journal.json`（追加 1 条）
- 修改 `enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json`（追加 1 条）
- 新建 `enterprise/packages/db-schema/src/schema/ma-vaults.ts`
- 新建 `enterprise/packages/db-schema/src/mysql-schema/ma-vaults.ts`
- 修改 `enterprise/packages/db-schema/src/schema/index.ts`、`src/mysql-schema/index.ts`（各加 1 行 `export * from "./ma-vaults";`，紧跟 `./ma-environments` 行之后）
- 修改 `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts`
- 修改 `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts`
- 修改 `enterprise/packages/db-schema/src/__tests__/ma-schema.test.ts`

iam-core（TS）：
- 新建 `enterprise/packages/iam-core/src/ma-vault-crypto.ts`
- 新建 `enterprise/packages/iam-core/src/repos/ma-vault-validate.ts`（纯函数：校验与归一化，无 DB）
- 新建 `enterprise/packages/iam-core/src/repos/ma-vaults.ts`
- 新建 `enterprise/packages/iam-core/src/repos/mysql/ma-vaults.ts`
- 修改 `enterprise/packages/iam-core/src/index.ts`（追加 3 行 export）
- 新建 `enterprise/packages/iam-core/src/__tests__/ma-vault-crypto.test.ts`
- 新建 `enterprise/packages/iam-core/src/repos/__tests__/ma-vault-validate.test.ts`
- 新建 `enterprise/packages/iam-core/src/repos/__tests__/ma-vault-refresh.test.ts`

admin-console（TS）：
- 修改 `src/lib/ma/errors.ts`（追加错误码与异常映射）
- 新建 `src/lib/ma/vault-records.ts`
- 新建 `src/lib/ma/vault-input.ts`
- 新建公共接口（路径相对 `src/app/api/ma/v1/`）：`vaults/route.ts`、`vaults/[vaultId]/route.ts`、`vaults/[vaultId]/archive/route.ts`、`vaults/[vaultId]/referenced_by/route.ts`、`vaults/[vaultId]/credentials/route.ts`、`vaults/[vaultId]/credentials/[credentialId]/route.ts`、`vaults/[vaultId]/credentials/[credentialId]/archive/route.ts`
- 新建内部接口：`src/app/api/internal/ma/vaults/validate/route.ts`、`src/app/api/internal/ma/vault-resolve/route.ts`
- 新建管理台接口（相对 `src/app/api/admin/ma-vaults/`）：`route.ts`、`shared.ts`、`[vaultId]/route.ts`、`[vaultId]/archive/route.ts`、`[vaultId]/references/route.ts`、`[vaultId]/credentials/route.ts`、`[vaultId]/credentials/[credentialId]/route.ts`、`[vaultId]/credentials/[credentialId]/archive/route.ts`
- 新建页面 `src/app/admin/_sections/agent-vaults.tsx`
- 修改 `src/app/admin/[section]/page.tsx`（import + 映射 1 行）
- 修改 `src/lib/admin-platform-sections.ts` 与 `src/lib/__tests__/admin-platform-sections.test.ts`
- 修改 `src/components/AppShell.tsx`（导航 1 项 + 图标 import）
- 修改 `messages/zh.json`、`messages/en.json`（`nav.agentVaults` 与 `agentVaults` 文案块）
- 新建测试：`src/app/api/ma/v1/__tests__/vaults-route.test.ts`、`src/app/api/internal/ma/__tests__/vault-internal-routes.test.ts`、`src/app/api/admin/ma-vaults/__tests__/route.test.ts`

脚本与部署（只增行）：
- 修改 `enterprise/scripts/start-dev.sh`、`enterprise/scripts/bootstrap.sh`、`enterprise/.env.local.example`、`enterprise/deploy/docker-compose/prod.yml`

文档：
- 修改 `docs/managed-agents/protocol.md`（文末追加「Vault 控制面」一节）
- 修改 `docs/managed-agents/threat-model.md`（§1 末尾追加一段「MA-E06 落地」）

### 3.2 Out of scope（不得修改）

- `agenticx/**`、`enterprise/apps/agent-runtime/**`（凭证消费属 MA-A06）、`enterprise/apps/gateway/**`、`enterprise/apps/web-portal/**`、`desktop/**`。
- `enterprise/packages/core-api/**`（Vault 不在 master §5 冻结契约里，记录类型只在 admin-console 本地定义）。
- `iam-core/src/scope-registry.ts`（D6）、`iam-core/src/provider-api-key-crypto.ts`、`admin-console/src/lib/mcp-backend-config-crypto.ts`、现有 `mcp-servers` / `pat-vault` 功能。
- `oauth`（非 MCP 的 HTTPS OAuth）、`mcp_static`、`env_oauth` 类型；创建时 MCP 握手探测；`mcp_oauth_validate`；Vault 元数据中的「按用户可见」权限；主密钥批量重包脚本（只做 PREVIOUS 兜底解密）。

---

## 4. 数据结构

### 4.1 PG `0063_ma_vaults.sql`（逐字）

```sql
-- Managed Agents 凭证库：ma_vaults / ma_credentials。唯一写入方：admin-console（iam-core repos）。
-- 密钥只以信封密文存在：secret_ciphertext = encryptSecret(JSON, DEK)，wrapped_dek = encryptSecret(DEK, MA_VAULT_MASTER_KEY)。
-- active_identity_key：active 时为 "<identity_kind>:<identity_key>"，归档后置 NULL，用于同一 Vault 内匹配键唯一。
CREATE TABLE IF NOT EXISTS "ma_vaults" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_by" varchar(26),
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_vaults_tenant_status_idx"
  ON "ma_vaults" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_credentials" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "vault_id" varchar(26) NOT NULL REFERENCES "ma_vaults"("id") ON DELETE CASCADE,
  "display_name" varchar(255),
  "type" varchar(32) NOT NULL,
  "identity_kind" varchar(24) NOT NULL,
  "identity_key" varchar(512) NOT NULL,
  "active_identity_key" varchar(540),
  "public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secret_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "secret_ciphertext" text,
  "wrapped_dek" text,
  "kek_id" varchar(32),
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone,
  "last_rotated_at" timestamp with time zone,
  "last_resolved_at" timestamp with time zone,
  "created_by" varchar(26),
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_credentials_vault_active_identity_uq"
  ON "ma_credentials" ("vault_id", "active_identity_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_credentials_tenant_vault_idx"
  ON "ma_credentials" ("tenant_id", "vault_id", "created_at");
```

### 4.2 MySQL `0037_ma_vaults.sql`（逐字）

```sql
-- Managed Agents 凭证库（MySQL）。JSON 默认值写 DEFAULT (JSON_OBJECT()) / (JSON_ARRAY())；不写 CHARSET。
CREATE TABLE IF NOT EXISTS `ma_vaults` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `description` text,
  `metadata` json NOT NULL DEFAULT (JSON_OBJECT()),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_by` varchar(26),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_vaults_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_vaults_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  INDEX `ma_vaults_tenant_status_idx` (`tenant_id`, `status`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_credentials` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `vault_id` varchar(26) NOT NULL,
  `display_name` varchar(255),
  `type` varchar(32) NOT NULL,
  `identity_kind` varchar(24) NOT NULL,
  `identity_key` varchar(512) NOT NULL,
  `active_identity_key` varchar(540),
  `public_config` json NOT NULL DEFAULT (JSON_OBJECT()),
  `secret_fields` json NOT NULL DEFAULT (JSON_ARRAY()),
  `secret_ciphertext` text,
  `wrapped_dek` text,
  `kek_id` varchar(32),
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `expires_at` datetime(6),
  `last_rotated_at` datetime(6),
  `last_resolved_at` datetime(6),
  `created_by` varchar(26),
  `archived_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_credentials_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_credentials_vault_fk` FOREIGN KEY (`vault_id`) REFERENCES `ma_vaults` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_credentials_vault_active_identity_uq` UNIQUE (`vault_id`, `active_identity_key`),
  INDEX `ma_credentials_tenant_vault_idx` (`tenant_id`, `vault_id`, `created_at`)
);
```

`varchar(540)` × utf8mb4 = 2160 字节 + `vault_id` 104 字节 < 3072 字节索引上限（已核算）。`secret_ciphertext` 用 `text`（≤65535 字节）：单条密钥 JSON 上限 16 KiB × 4 字段 ≈ 64 KiB 原文时会逼近上限 → §5.1.3 规定**所有密钥字段合计 ≤ 32 KiB**，加密 + base64url 后 < 44 KiB。

Journal 追加：PG `{"idx": 62, "version": "7", "when": 1788100000000, "tag": "0063_ma_vaults", "breakpoints": true}`；MySQL `{"idx": 37, "version": "5", "when": 1788100000001, "tag": "0037_ma_vaults", "breakpoints": true}`（`idx` 以 E03 合入后实际末项 +1 为准）。

### 4.3 drizzle schema（PG 版，MySQL 版同构：`json` 替 `jsonb`、`datetime(..., { fsp: 6 })` 替 `timestamp(..., { withTimezone: true })`、`mysqlTable`）

```ts
/**
 * 托管智能体凭证库。只由 admin-console（iam-core）写入；agent-runtime 只经 /api/internal/ma/vault-resolve 读取解密结果。
 * 密钥列只存信封密文；读接口永不返回密文或明文。
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

export const maVaults = pgTable(
  "ma_vaults",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    description: text("description"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, string>>(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdBy: varchar("created_by", { length: 26 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    tenantStatusIdx: index("ma_vaults_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  }),
);

export const maCredentials = pgTable(
  "ma_credentials",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id").notNull(),
    vaultId: ulid("vault_id").notNull().references(() => maVaults.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }),
    type: varchar("type", { length: 32 }).notNull(),
    identityKind: varchar("identity_kind", { length: 24 }).notNull(),
    identityKey: varchar("identity_key", { length: 512 }).notNull(),
    activeIdentityKey: varchar("active_identity_key", { length: 540 }),
    publicConfig: jsonb("public_config").notNull().default({}).$type<Record<string, unknown>>(),
    secretFields: jsonb("secret_fields").notNull().default([]).$type<string[]>(),
    secretCiphertext: text("secret_ciphertext"),
    wrappedDek: text("wrapped_dek"),
    kekId: varchar("kek_id", { length: 32 }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 26 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => ({
    vaultActiveIdentityUq: uniqueIndex("ma_credentials_vault_active_identity_uq").on(table.vaultId, table.activeIdentityKey),
    tenantVaultIdx: index("ma_credentials_tenant_vault_idx").on(table.tenantId, table.vaultId, table.createdAt),
  }),
);

export type MaVaultRow = typeof maVaults.$inferSelect;
export type MaCredentialRow = typeof maCredentials.$inferSelect;
```

### 4.4 `public_config` / `secret_fields` 按类型（落库形态）

| type | identity_kind / identity_key | public_config 键（非敏感） | secret JSON 键（加密） |
|---|---|---|---|
| `static_bearer` | `mcp_server_url` / 归一化 URL | `{}` | `token` |
| `mcp_oauth` | `mcp_server_url` / 归一化 URL | `refresh?: {token_endpoint, client_id, scope?, resource?, token_endpoint_auth_type: "none"\|"client_secret_basic"\|"client_secret_post"}` | `access_token`、`refresh_token?`、`client_secret?` |
| `bearer` | `host` / 小写主机名 | `{}` | `token` |
| `environment_variable` | `secret_name` / 变量名 | `networking: {type: "unrestricted"} \| {type: "limited", allowed_hosts: string[]}` | `secret_value` |

`secret_fields` = 实际存在的 secret 键名，排序后存（例如 `["access_token","client_secret","refresh_token"]`）；`expires_at` 列只对 `mcp_oauth` 有值。

---

## 5. 精确落点

### 5.1 `iam-core/src/repos/ma-vault-validate.ts`（纯函数，无 DB）

```ts
export type MaCredentialType = "static_bearer" | "mcp_oauth" | "bearer" | "environment_variable";
export const MA_CREDENTIAL_TYPES: readonly MaCredentialType[] = ["static_bearer", "mcp_oauth", "bearer", "environment_variable"];
export type MaIdentityKind = "mcp_server_url" | "host" | "secret_name";
export type MaNetworking = { type: "unrestricted" } | { type: "limited"; allowed_hosts: string[] };
export type MaRefreshPublic = {
  token_endpoint: string; client_id: string; scope: string | null; resource: string | null;
  token_endpoint_auth_type: "none" | "client_secret_basic" | "client_secret_post";
};
export type NormalizedCredentialCreate = {
  type: MaCredentialType; displayName: string | null;
  identityKind: MaIdentityKind; identityKey: string;
  publicConfig: Record<string, unknown>; secrets: Record<string, string>; expiresAt: string | null;
};
export type NormalizedCredentialPatch = {
  displayName?: string | null;
  secrets: Record<string, string>;              // only provided secret keys
  clearSecrets: string[];                       // e.g. refresh: null -> ["refresh_token","client_secret"]
  publicConfigPatch: Record<string, unknown | null>;   // key -> new value; null deletes the key
  expiresAt?: string | null;
};

export class MaVaultValidationError extends Error { name = "MaVaultValidationError"; }
export function normalizeMcpServerUrl(raw: string): string;          // §5.1.2
export function normalizeHost(raw: string, opts: { allowWildcard: boolean }): string;
export function validateSecretName(raw: string): string;
export function validateVaultInput(body: { display_name?: unknown; description?: unknown; metadata?: unknown }, mode: "create" | "update"): {...};
export function normalizeCredentialCreate(body: Record<string, unknown>): NormalizedCredentialCreate;
export function normalizeCredentialPatch(existing: { type: MaCredentialType; publicConfig: Record<string, unknown> }, body: Record<string, unknown>): NormalizedCredentialPatch;
```

所有错误抛 `MaVaultValidationError`，消息为英文短语（API 直接透出），格式 `"<field path>: <reason>"`，例如 `"auth.mcp_server_url: must be an https URL without query, fragment or credentials"`。

#### 5.1.1 Vault 字段

- `display_name`：create 必填；string，trim 后 1–255 字符；不得含 `\u0000-\u001f\u007f`。
- `description`：可选，string 或 null，≤1024 字符。
- `metadata`：可选 object；≤16 个键；键 1–64 字符 `^[A-Za-z0-9_.-]+$`；值必须是 string 且 ≤512 字符。
- update 只允许 `display_name` / `description` / `metadata`（`metadata` 整体替换）。

#### 5.1.2 `normalizeMcpServerUrl`（与 A06 Python `normalize_mcp_url` 逐字同义）

```text
input: raw string, trim
reject (MaVaultValidationError) if: length > 512, contains any char outside printable ASCII (0x21-0x7E)
u = new URL(raw)                         // throws -> reject
reject if u.protocol !== "https:"
reject if u.username || u.password || u.search || u.hash
host = u.hostname.toLowerCase().replace(/\.$/, "")
netloc = u.port && u.port !== "443" ? `${host}:${u.port}` : host
path = u.pathname.replace(/\/+$/, "")     // "/" -> "", "/mcp/" -> "/mcp"
return `https://${netloc}${path}`
```

Python 侧（A06）对 **manifest 里的 URL** 用同一规则但允许 query（附在末尾 `?query`），因此带 query 的 manifest URL 永远匹配不到凭证——这是有意的（凭证 URL 不允许 query）。

#### 5.1.3 凭证 `auth` 校验（`normalizeCredentialCreate`）

请求体：`{display_name?: string|null, auth: {...}}`，`assertOnlyKeys(body, ["display_name","auth"])` 在路由层做。

通用：
- `display_name`：null 或 1–255 字符。
- 每个 secret 字段：string，长度 8–16384（短于 8 → `auth.<key>: must be at least 8 characters`；master §12 已决：短值无法可靠脱敏），不得含 `\r`、`\n`、`\u0000`，不得包含子串 `${cred:`（防止 A06 的 MCP header 解析把它当本地引用）；所有 secret 合计 UTF-8 字节 ≤ 32768。
- `auth` 的未知键 → `auth.<key>: unknown field`。

按类型：

| type | 允许键 | 规则 |
|---|---|---|
| `static_bearer` | `type`、`mcp_server_url`、`token` | 两者必填；`identityKey = normalizeMcpServerUrl(mcp_server_url)`；`token` 若以 `Bearer `（不区分大小写）开头 → 拒绝 `auth.token: must not include the "Bearer " prefix` |
| `bearer` | `type`、`host`、`token` | `host = normalizeHost(host, {allowWildcard:false})`；`token` 同上前缀规则 |
| `mcp_oauth` | `type`、`mcp_server_url`、`access_token`、`expires_at`、`refresh` | `access_token` 必填；`expires_at` 可选 ISO-8601（`Date.parse` 有效）→ 存 UTC ISO；`refresh` 可选 object：允许键 `token_endpoint`（必填，`https://`，≤512，无 userinfo / hash）、`client_id`（必填 1–255）、`scope?`（≤1024）、`resource?`（https URL ≤512）、`refresh_token`（必填 secret）、`token_endpoint_auth`（必填 object：`type` ∈ `none`/`client_secret_basic`/`client_secret_post`；`client_secret` 在 basic/post 时必填、none 时必须缺省）；配置了 `refresh` 时 `expires_at` 必填（否则 `auth.expires_at: required when refresh is configured`） |
| `environment_variable` | `type`、`secret_name`、`secret_value`、`networking` | `secret_name = validateSecretName(...)`；`networking` 必填：`{type:"unrestricted"}`（不得带 `allowed_hosts`）或 `{type:"limited", allowed_hosts:[...]}`（1–16 项，每项 `normalizeHost(h, {allowWildcard:true})`，去重后保持输入顺序） |

`normalizeHost(raw, {allowWildcard})`：trim、小写、去尾 `.`；正则 `^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$`（`allowWildcard=false` 时不得以 `*.` 开头）；总长 ≤253；拒绝纯 IP 字面量以外的端口 / 协议 / 路径（正则已排除）；拒绝 `*`、`*.com` 这类只剩一级的通配（`*.` 之后至少两段）。IPv4 字面量（`^\d{1,3}(\.\d{1,3}){3}$`）允许，但 `allowWildcard` 下不得带 `*.`。

`validateSecretName(raw)`：`^[A-Z_][A-Z0-9_]{0,127}$`；拒绝精确名 `PATH HOME SHELL USER LOGNAME PWD TMPDIR LANG TERM HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY SSL_CERT_FILE REQUESTS_CA_BUNDLE CURL_CA_BUNDLE NODE_EXTRA_CA_CERTS NODE_OPTIONS PYTHONPATH PYTHONHOME`（及其小写形式无意义，正则已限大写）；拒绝前缀 `LD_`、`DYLD_`、`AGX_`、`MA_`。消息 `auth.secret_name: reserved name`。

#### 5.1.4 轮换（`normalizeCredentialPatch`）

请求体：`{display_name?, auth?}`。`auth` 存在时：
- `auth.type` 必填且必须等于 `existing.type`，否则 `auth.type: must equal the credential type`。
- 出现身份键（`mcp_server_url` / `host` / `secret_name`）→ `auth.<key>: is immutable; create a new credential instead`。
- `static_bearer` / `bearer`：可提供 `token`。
- `environment_variable`：可提供 `secret_value`、`networking`（同创建规则，整体替换 → `publicConfigPatch.networking`）。
- `mcp_oauth`：可提供 `access_token`、`expires_at`（null 清空）、`refresh`：
  - `refresh: null` → `publicConfigPatch.refresh = null`，`clearSecrets = ["refresh_token","client_secret"]`。
  - `refresh` 为 object 且原来**没有** refresh：按创建规则完整校验（启用刷新）。
  - `refresh` 为 object 且原来**有** refresh：`token_endpoint` / `client_id` 出现且与原值不同 → `auth.refresh.<key>: is immutable`；可更新 `scope`、`resource`、`refresh_token`、`token_endpoint_auth`（更新 `token_endpoint_auth.type` 到 basic/post 时 `client_secret` 必填，改到 none 时 `clearSecrets` 加 `client_secret`）。
- 至少提供一个可变字段，否则 `request: nothing to update`。

### 5.2 `iam-core/src/ma-vault-crypto.ts`

```ts
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, readSecretFromEnv } from "@agenticx/auth";

export const MA_VAULT_MASTER_KEY_ENV = "MA_VAULT_MASTER_KEY";
export const MA_VAULT_MASTER_KEY_PREVIOUS_ENV = "MA_VAULT_MASTER_KEY_PREVIOUS";

export class VaultCryptoUnavailableError extends Error { name = "VaultCryptoUnavailableError"; }
export class VaultDecryptError extends Error { name = "VaultDecryptError"; }

export type SealedSecret = { ciphertext: string; wrappedDek: string; kekId: string };

export function kekIdOf(masterKey: string): string;      // sha256(masterKey).hex.slice(0, 16)
export function readMasterKeys(env?: NodeJS.ProcessEnv): { current: string; previous: string | null };
export function sealSecretPayload(secrets: Record<string, string>, env?: NodeJS.ProcessEnv): SealedSecret;
export function openSecretPayload(sealed: SealedSecret, env?: NodeJS.ProcessEnv): Record<string, string>;
```

- `readMasterKeys`：`current = readSecretFromEnv(MA_VAULT_MASTER_KEY_ENV, env)`；缺失 → `throw new VaultCryptoUnavailableError("MA_VAULT_MASTER_KEY is not configured")`；调用 `assertStrongSecretKey(current, "MA_VAULT_MASTER_KEY")`（失败转抛 `VaultCryptoUnavailableError(message)`）。`previous` 同法读取，缺失为 null。
- `sealSecretPayload`：
  ```text
  dek = randomBytes(32).toString("base64url"); retry up to 5 times while new Set(dek).size < 8
  ciphertext = encryptSecret(JSON.stringify(sortKeys(secrets)), dek)
  wrappedDek = encryptSecret(dek, current)
  return { ciphertext, wrappedDek, kekId: kekIdOf(current) }
  ```
- `openSecretPayload`：按 `sealed.kekId` 选键：等于 `kekIdOf(current)` → current；等于 `kekIdOf(previous)` → previous；都不等 → `VaultDecryptError("unknown key id")`。`dek = decryptSecret(wrappedDek, key)`；`plain = decryptSecret(ciphertext, dek)`；`JSON.parse` 后必须是 `Record<string,string>`。任何异常 → `throw new VaultDecryptError("cannot decrypt credential")`（**不透出底层消息**，不返回空串）。
- 本文件不得 `console.log` 任何参数。

### 5.3 `iam-core/src/repos/ma-vaults.ts`

导出类型与函数（MySQL 分支放 `repos/mysql/ma-vaults.ts`，写法同 `ma-environments.ts`）：

```ts
export type MaVaultStatus = "active" | "archived";
export type MaVault = {
  id: string; tenantId: string; displayName: string; description: string | null;
  metadata: Record<string, string>; status: MaVaultStatus; credentialCount: number;
  createdBy: string | null; archivedAt: string | null; createdAt: string; updatedAt: string;
};
export type MaCredential = {
  id: string; tenantId: string; vaultId: string; displayName: string | null; type: MaCredentialType;
  identityKind: MaIdentityKind; identityKey: string; publicConfig: Record<string, unknown>;
  secretFields: string[]; hasSecret: boolean; status: "active" | "archived";
  expiresAt: string | null; lastRotatedAt: string | null; lastResolvedAt: string | null;
  createdBy: string | null; archivedAt: string | null; createdAt: string; updatedAt: string;
};
export class MaVaultNotFoundError extends Error { name = "MaVaultNotFoundError"; }
export class MaCredentialNotFoundError extends Error { name = "MaCredentialNotFoundError"; }
export class MaCredentialIdentityConflictError extends Error { name = "MaCredentialIdentityConflictError"; }
export class MaVaultCredentialLimitError extends Error { name = "MaVaultCredentialLimitError"; }
export class MaVaultNotArchivedError extends Error { name = "MaVaultNotArchivedError"; }
export class MaVaultArchivedError extends Error { name = "MaVaultArchivedError"; }
export const MA_VAULT_CREDENTIAL_LIMIT = 100;

export async function listMaVaults(tenantId: string, opts?: { includeArchived?: boolean }): Promise<MaVault[]>;
export async function getMaVault(tenantId: string, vaultId: string): Promise<MaVault>;
export async function createMaVault(tenantId: string, input: VaultInput, actorUserId: string | null): Promise<MaVault>;
export async function updateMaVault(tenantId: string, vaultId: string, patch: Partial<VaultInput>, actorUserId: string | null): Promise<MaVault>;
export async function archiveMaVault(tenantId: string, vaultId: string, actorUserId: string | null): Promise<MaVault>;
export async function deleteMaVault(tenantId: string, vaultId: string, actorUserId: string | null): Promise<void>;
export async function listMaCredentials(tenantId: string, vaultId: string, opts?: { includeArchived?: boolean }): Promise<MaCredential[]>;
export async function getMaCredential(tenantId: string, vaultId: string, credentialId: string): Promise<MaCredential>;
export async function createMaCredential(tenantId: string, vaultId: string, body: Record<string, unknown>, actorUserId: string | null): Promise<MaCredential>;
export async function rotateMaCredential(tenantId: string, vaultId: string, credentialId: string, body: Record<string, unknown>, actorUserId: string | null): Promise<MaCredential>;
export async function archiveMaCredential(tenantId: string, vaultId: string, credentialId: string, actorUserId: string | null): Promise<MaCredential>;
export async function deleteMaCredential(tenantId: string, vaultId: string, credentialId: string, actorUserId: string | null): Promise<void>;
export async function listVaultReferences(tenantId: string, vaultId: string): Promise<VaultReferences>;
export async function validateVaultIds(tenantId: string, vaultIds: string[]): Promise<Array<{ id: string; status: "active" | "archived" | "missing" }>>;
export async function resolveVaultBundle(input: ResolveInput, deps?: { fetchImpl?: typeof fetch; now?: () => Date }): Promise<ResolvedBundle>;
```

行为（每条都必须实现）：

1. **所有查询带 `tenant_id` 过滤**；`vaultId` / `credentialId` 不是 ULID → 直接抛 NotFound（不查库）。
2. `createMaVault`：`validateVaultInput(...,"create")`，插入，`insertAuditEvent({eventType:"ma.vault.create", targetKind:"ma_vault", targetId:id, actorUserId, detail:{display_name}})` 同事务。
3. `updateMaVault`：archived → `MaVaultArchivedError`；审计 `ma.vault.update`（detail 列出变更键名）。
4. `archiveMaVault`：已 archived 幂等返回；否则一个事务内：vault `status='archived', archived_at=now`；该 vault 下所有 active 凭证 `status='archived', archived_at=now, secret_ciphertext=NULL, wrapped_dek=NULL, kek_id=NULL, active_identity_key=NULL`；审计 `ma.vault.archive`（detail `{credential_count}`）。
5. `deleteMaVault`：非 archived → `MaVaultNotArchivedError`；删除（级联凭证）；审计 `ma.vault.delete`（审计行 target_id = vault id，写在删除同事务）。
6. `createMaCredential`：vault 不存在 → NotFound；vault archived → `MaVaultArchivedError`；`normalizeCredentialCreate(body)`；active 凭证数 ≥100 → `MaVaultCredentialLimitError`；`sealSecretPayload(secrets)`（抛 `VaultCryptoUnavailableError` 原样上抛）；插入 `active_identity_key = \`${identityKind}:${identityKey}\``；唯一冲突（`isUniqueViolation`，消息正则加 `ma_credentials_vault_active_identity_uq`）→ `MaCredentialIdentityConflictError`；审计 `ma.credential.create`（detail `{vault_id, type, identity_kind, identity_key}`——身份键不是密钥，可记）。
7. `rotateMaCredential`：读行（含密文）；archived → `MaCredentialNotFoundError`（对外视为不存在）；`normalizeCredentialPatch(existing, body)`；若有 `secrets` 或 `clearSecrets`：`openSecretPayload` 旧密文 → 合并（新值覆盖、clear 的删除）→ 校验合并结果满足该类型必填 secret（`static_bearer/bearer: token`；`mcp_oauth: access_token`，且 `public_config.refresh` 存在时需 `refresh_token`，`token_endpoint_auth_type` 为 basic/post 时需 `client_secret`；`environment_variable: secret_value`）→ `sealSecretPayload` 重新生成 **新 DEK**；更新 `secret_fields`、`last_rotated_at=now`；`public_config` 按 `publicConfigPatch` 合并；`expires_at` 按需更新；审计 `ma.credential.rotate`（detail `{changed: ["token", "networking", ...]}`，只有键名）。
8. `archiveMaCredential`：同 §4 的清空规则（单行）；审计 `ma.credential.archive`。
9. `deleteMaCredential`：硬删；审计 `ma.credential.delete`。
10. `listVaultReferences(tenantId, vaultId)` 返回：
    ```ts
    type VaultReferences = {
      sessions: { active_count: number; recent: Array<{ id: string; agent_id: string; status: string; created_by_user_id: string | null; created_at: string }> };
      agents: Array<{ id: string; display_name: string; latest_version: number; matched: string[] }>;
    };
    ```
    - sessions：`ma_sessions` 中 `tenant_id = ? AND archived_at IS NULL AND status NOT IN ('archived','terminated')` 且 `vault_ids` 含该 id（PG：`vault_ids @> jsonb_build_array(?::text)`；MySQL：`JSON_CONTAINS(vault_ids, JSON_QUOTE(?))`）；`active_count` 为计数，`recent` 按 `created_at DESC` 取 20。
    - agents：取该 vault 下 active 的 `static_bearer` / `mcp_oauth` 凭证的 `identity_key` 集合；遍历租户内 `enterprise_agents`（`status='active'`）的最新版本 `enterprise_agent_versions.version = enterprise_agents.latest_version`，对 manifest 的 `mcp_servers[].url` 用「§5.1.2 规则但保留 query」归一化，命中集合则列入，`matched` 为命中的归一化 URL。只读，不缓存。
11. `validateVaultIds(tenantId, ids)`：按输入顺序返回；非 ULID 或查无 → `missing`。
12. `resolveVaultBundle`（§5.6 详述）。

`MaCredential.hasSecret = secret_ciphertext IS NOT NULL`。repo 返回的对象**永不包含** `secretCiphertext` / `wrappedDek` / `kekId`（行映射函数里显式丢弃）。

### 5.4 公共接口 `/api/ma/v1/vaults*`

全部：`export const dynamic = "force-dynamic"`；鉴权 `requireMaPat(request, "ma:vaults:read" | "ma:vaults:write")`；错误统一 `maErrorFromException`；响应 `cache-control: no-store`（写一个本地 `noStore()` 包装，同内部接口样板）。

| 方法 | 路径 | scope | 请求 | 成功响应 |
|---|---|---|---|---|
| GET | `/api/ma/v1/vaults?include_archived=true` | read | — | 200 `{"data": [VaultRecord]}` |
| POST | `/api/ma/v1/vaults` | write | `{display_name, description?, metadata?}`（`assertOnlyKeys`） | 201 `{"vault": VaultRecord}` |
| GET | `/api/ma/v1/vaults/:vaultId` | read | — | 200 `{"vault": VaultRecord}` |
| PATCH | `/api/ma/v1/vaults/:vaultId` | write | `{display_name?, description?, metadata?}` | 200 `{"vault"}` |
| POST | `/api/ma/v1/vaults/:vaultId/archive` | write | 无 body | 200 `{"vault"}` |
| DELETE | `/api/ma/v1/vaults/:vaultId` | write | — | 200 `{"id", "deleted": true}`；未归档 409 `vault_not_archived` |
| GET | `/api/ma/v1/vaults/:vaultId/referenced_by` | read | — | 200 `VaultReferences` |
| GET | `/api/ma/v1/vaults/:vaultId/credentials?include_archived=true` | read | — | 200 `{"data": [CredentialRecord]}` |
| POST | `/api/ma/v1/vaults/:vaultId/credentials` | write | `{display_name?, auth}` | 201 `{"credential": CredentialRecord}` |
| GET | `/api/ma/v1/vaults/:vaultId/credentials/:credentialId` | read | — | 200 `{"credential"}` |
| PATCH | `/api/ma/v1/vaults/:vaultId/credentials/:credentialId` | write | `{display_name?, auth?}` | 200 `{"credential"}` |
| POST | `/api/ma/v1/vaults/:vaultId/credentials/:credentialId/archive` | write | — | 200 `{"credential"}` |
| DELETE | `/api/ma/v1/vaults/:vaultId/credentials/:credentialId` | write | — | 200 `{"id","deleted":true}` |

`src/lib/ma/vault-records.ts`：

```ts
export type VaultRecord = {
  id: string; tenant_id: string; display_name: string; description: string | null;
  metadata: Record<string, string>; status: "active" | "archived"; credential_count: number;
  created_at: string; updated_at: string; archived_at: string | null;
};
export type CredentialRecord = {
  id: string; vault_id: string; display_name: string | null; type: MaCredentialType;
  status: "active" | "archived"; has_secret: boolean; expires_at: string | null;
  last_rotated_at: string | null; last_resolved_at: string | null;
  created_at: string; updated_at: string; archived_at: string | null;
  auth: CredentialAuthPublic;
};
export type CredentialAuthPublic =
  | { type: "static_bearer"; mcp_server_url: string }
  | { type: "bearer"; host: string }
  | { type: "environment_variable"; secret_name: string; networking: MaNetworking }
  | { type: "mcp_oauth"; mcp_server_url: string; expires_at: string | null;
      refresh: null | { token_endpoint: string; client_id: string; scope: string | null; resource: string | null;
                        token_endpoint_auth: { type: "none" | "client_secret_basic" | "client_secret_post" };
                        has_refresh_token: boolean; has_client_secret: boolean } };
export function toVaultRecord(v: MaVault): VaultRecord;
export function toCredentialRecord(c: MaCredential): CredentialRecord;
```

`toCredentialRecord` 只从 `identityKey` / `publicConfig` / `secretFields` 推导；`has_refresh_token = secretFields.includes("refresh_token")`。**AC 用正则扫描所有响应 JSON，确保不出现请求里提交的任何 secret 原文。**

### 5.5 错误码（admin-console 本地，`src/lib/ma/errors.ts`）

`MA_CONTROL_PLANE_ERROR_CODES` 追加（保持 `as const`）：

```ts
  vault_not_found: 404,
  credential_not_found: 404,
  credential_identity_conflict: 409,
  vault_credential_limit: 409,
  vault_not_archived: 409,
  vault_archived: 409,
  vault_crypto_unavailable: 503,
```

`maErrorFromException` 的 `switch (error.name)` 追加：

| error.name | 返回 |
|---|---|
| `MaVaultValidationError` | `invalid_request`，message 原样 |
| `MaVaultNotFoundError` | `vault_not_found`, `"vault not found"` |
| `MaCredentialNotFoundError` | `credential_not_found`, `"credential not found"` |
| `MaCredentialIdentityConflictError` | `credential_identity_conflict`, `"an active credential with the same identity already exists in this vault"` |
| `MaVaultCredentialLimitError` | `vault_credential_limit`, `"a vault can hold at most 100 active credentials"` |
| `MaVaultNotArchivedError` | `vault_not_archived`, `"archive the vault before deleting it"` |
| `MaVaultArchivedError` | `vault_archived`, `"vault is archived"` |
| `VaultCryptoUnavailableError` | `vault_crypto_unavailable`, `"credential encryption is not configured"`（**不透出**环境变量名以外的细节；`console.error("ma.vault.crypto_unavailable")` 不带参数） |
| `VaultDecryptError` | `internal_error`, `"internal error"`，并 `console.error("ma.vault.decrypt_failed", {credentialId})`（由 repo 在抛出前把 id 附到 error 属性 `credentialId`） |

`statusFor` 的穷举 `never` 检查保持（新增键自动覆盖）。

### 5.6 内部接口

两个路由都：`isMaInternalAuthorized` 失败 → 401；`noStore`；body 用 `readJsonObject`；`tenant_id` 用 `TENANT_ID_RE` 校验。

#### 5.6.1 `POST /api/internal/ma/vaults/validate`

请求 `{"tenant_id": "...", "vault_ids": ["01J..."]}`（`vault_ids` 数组、长度 1–20、元素 string）。响应 200：

```json
{ "vaults": [ { "id": "01J...", "status": "active" }, { "id": "01K...", "status": "missing" } ] }
```

#### 5.6.2 `POST /api/internal/ma/vault-resolve`

开关：`MA_VAULT_RESOLVE_ENABLED`（默认 `"1"`；为 `"0"` 时返回 503 `vault_crypto_unavailable`，消息 `"credential resolution is disabled"`）——紧急止血用。

请求：

```json
{ "tenant_id": "T", "session_id": "01J...", "vault_ids": ["01JVAULTA...", "01JVAULTB..."] }
```

校验顺序：
1. `session_id` 为 ULID；`vault_ids` 1–20 个、元素为 ULID、无重复 → 否则 400 `invalid_request`。
2. `getMaSession(tenant_id, session_id)`；null → 404 `session_not_found`；`status ∈ {archived, terminated}` 或 `archivedAt` 非空 → 409 `session_terminated`（MA-00 已有码）。
3. 每个请求的 vault id 必须在 `session.vaultIds` 中 → 否则 400 `invalid_request`，`"vault_ids must be a subset of the session vault_ids"`。

处理（`resolveVaultBundle`）：
1. 按请求顺序逐个 vault：不存在 → `skipped.push({vault_id, reason: "not_found"})`；archived → `reason: "archived"`。
2. active vault 下的 active 凭证按 `created_at ASC, id ASC` 排序；对每条：`openSecretPayload`（失败 → 整个请求 500，审计 `ma.vault.resolve` detail `{ok:false, error:"decrypt_failed", credential_id}`）。
3. `mcp_oauth` 刷新（D8）：条件 `public_config.refresh` 存在 且 `secrets.refresh_token` 存在 且 `expires_at` 非空 且 `expires_at - now ≤ 300s`。请求：

   ```text
   POST {token_endpoint}
   content-type: application/x-www-form-urlencoded
   body: grant_type=refresh_token&refresh_token=<rt>[&scope=<scope>][&resource=<resource>]
   client_secret_basic -> Authorization: Basic base64(urlencode(client_id) + ":" + urlencode(client_secret))
   client_secret_post  -> body += &client_id=<id>&client_secret=<secret>
   none                -> body += &client_id=<id>
   timeout 10s (AbortController); redirect: "error"
   ```

   成功判定：HTTP 200、JSON、`access_token` 为非空 string、`expires_in` 缺省或为整数（字符串 `"3600"` 视为失败，与调研一致）。成功 → 新 `access_token`、`expires_at = now + expires_in s`（缺省 `expires_in` 则 `expires_at = null`）、若返回 `refresh_token` 则替换；`sealSecretPayload` 重新加密写回该行（`last_rotated_at` 不变、`updated_at = now`）；审计 `ma.credential.refresh` `{ok:true}`。失败 → 用旧 token，输出项加 `"refresh_error": "failed"`，审计 `{ok:false, status:<http status|0>}`（**不记录响应体**）。
4. 批量更新本次输出凭证的 `last_resolved_at = now`（失败只记日志，不影响响应）。
5. 写审计 `ma.vault.resolve`（**必须在返回前成功**，否则 500 且不返回密钥）：

   ```json
   {
     "tenantId": "T", "actorUserId": null, "eventType": "ma.vault.resolve",
     "targetKind": "ma_session", "targetId": "<session_id>",
     "detail": {
       "caller": "agent-runtime", "session_user_id": "<session.createdByUserId|null>",
       "vault_ids": ["..."], "credential_ids": ["..."],
       "types": {"static_bearer": 1, "environment_variable": 1},
       "skipped": [{"vault_id": "...", "reason": "archived"}],
       "refreshed": ["<credential id>"], "refresh_failed": []
     }
   }
   ```

响应 200（`cache-control: no-store`）：

```json
{
  "session_id": "01J...",
  "resolved_at": "2026-10-25T08:00:00.000Z",
  "credentials": [
    { "credential_id": "01J...", "vault_id": "01JVAULTA...", "vault_index": 0, "type": "static_bearer",
      "display_name": "GitHub MCP token", "mcp_server_url": "https://mcp.example.com/mcp", "token": "<plaintext>" },
    { "credential_id": "...", "vault_id": "...", "vault_index": 0, "type": "mcp_oauth", "display_name": null,
      "mcp_server_url": "https://mcp.example.com", "access_token": "<plaintext>", "expires_at": "2026-10-25T09:00:00.000Z",
      "refresh_error": "failed" },
    { "credential_id": "...", "vault_id": "...", "vault_index": 1, "type": "bearer", "display_name": null,
      "host": "docs.example.com", "token": "<plaintext>" },
    { "credential_id": "...", "vault_id": "...", "vault_index": 1, "type": "environment_variable", "display_name": null,
      "secret_name": "EXAMPLE_API_KEY", "secret_value": "<plaintext>",
      "networking": { "type": "limited", "allowed_hosts": ["api.example.com", "*.example.org"] } }
  ],
  "skipped": [ { "vault_id": "01K...", "reason": "not_found" } ]
}
```

- `credentials` 顺序 = 请求 vault 顺序 → 凭证创建顺序；A06 依此决定优先级。
- `refresh_error` 键仅在刷新失败时出现；`refresh_token` / `client_secret` **永不**出现在响应里。
- 路由与 repo 都不得把响应体写日志。

### 5.7 管理台接口 `/api/admin/ma-vaults/*`

与公共接口一一对应，复用同一组 repo 函数；区别：鉴权 `requireAdminScope`（读 `["provider:read"]`、建 / 改 / 归档 / 轮换 `["provider:update"]`、删除 `["provider:delete"]`）、租户 `requiredTenantId()`、响应包 `{code:"00000", message:"ok", data:{...}}`、错误由 `shared.ts` 的 `vaultErrorResponse(error)` 转换（照 `ma-environments/shared.ts` 的写法：`MaVaultValidationError` → 400 `{code:"40000", message}`；NotFound → 404 `"40400"`；冲突类 → 409 `"40900"` 中文消息；`VaultCryptoUnavailableError` → 503 `{code:"50300", message:"凭证加密未配置（MA_VAULT_MASTER_KEY），请联系运维"}`；其他 → 500 `"50000"` `"内部错误"`）。

管理台中文错误消息表（409 / 503 类）：

| error.name | message |
|---|---|
| `MaCredentialIdentityConflictError` | 该凭证库中已存在相同匹配目标的有效凭证 |
| `MaVaultCredentialLimitError` | 单个凭证库最多 100 条有效凭证 |
| `MaVaultNotArchivedError` | 请先归档凭证库再删除 |
| `MaVaultArchivedError` | 凭证库已归档，不能再修改 |

`[vaultId]/references/route.ts` 返回 `listVaultReferences`。

### 5.8 管理台页面「凭证库」 `src/app/admin/_sections/agent-vaults.tsx`

客户端组件，结构参照 `agent-environments.tsx`（`PageHeader` / `Table` / `Dialog` / `toast` 均来自 `@agenticx/ui`，请求用 `adminFetch`）。

- **列表**：列「名称、描述、有效凭证数、状态（有效 / 已归档）、创建时间、操作」；顶部「新建凭证库」按钮；「显示已归档」开关。空态 `EmptyState` 文案「还没有凭证库。凭证库用于保存 MCP 令牌与环境变量密钥，会话引用后由运行时注入，智能体看不到原文。」
- **详情抽屉**（`Sheet`）：基本信息（可编辑名称 / 描述）；「凭证」表（列：名称、类型、匹配目标、状态、过期时间、最近轮换、最近使用、操作「轮换 / 归档 / 删除」）；「被引用」面板（`active_count` 个进行中会话 + 最近 20 条，会话 id 链接到 `/ops/logs/managed/<id>`；可能用到该凭证库的智能体列表）。
- **新增凭证对话框**：先选类型（下拉：`MCP 静态令牌` = static_bearer、`MCP OAuth` = mcp_oauth、`HTTPS Bearer` = bearer、`环境变量` = environment_variable），再显示对应字段；所有密钥输入框 `type="password"`、`autoComplete="new-password"`、**永不回填**；`environment_variable` 显示网络策略单选「仅限指定主机（推荐）/ 不限主机」与主机列表（逐行输入，最多 16 项，提示「支持 *.example.com」）；选「不限主机」时显示黄色警示「任何出站请求都可能带上该密钥，仅在无法预先列出目标主机时使用」。
- **轮换对话框**：只显示该类型的密钥字段（全部可留空 = 保持不变）与 `expires_at`；`mcp_oauth` 显示「清除自动刷新」复选框（→ `refresh: null`）。提交成功 toast「已轮换，新会话立即生效，进行中的会话下一轮生效」。
- **破坏性操作**：归档 / 删除都用主题化 `Dialog` 二次确认（禁止 `window.confirm`）。删除凭证库对话框要求输入凭证库名称完全一致才能点「删除」；文案：归档「归档后凭证密文会被清除且不可恢复，引用它的会话后续调用将以未认证方式进行。」删除「删除后凭证库与其中所有凭证记录将永久移除。」
- 保存失败保留对话框并 toast 后端 `message`；保存按钮使用主题主按钮；「取消」紧靠「保存」左侧。
- 页面任何位置不展示密钥原文、密文、`kek_id`、仓库路径或环境变量文件路径（503 提示中的变量名除外）。

i18n：`messages/zh.json` 的 `nav` 加 `"agentVaults": "凭证库"`，`en.json` 加 `"agentVaults": "Vaults"`；页面文案集中在新键块 `agentVaults`（zh / en 各一份，键名与组件中 `t("...")` 一致）。

导航与路由注册（三处，精确插入）：
- `admin-platform-sections.ts`：`"agent-environments",` 之后插入 `"agent-vaults",`；测试中 `toEqual([...])` 同步插入。
- `[section]/page.tsx`：`import AgentVaultsSection from "../_sections/agent-vaults";`（按字母序放在 `AgentEnvironmentsSection` 之后）；映射 `"agent-vaults": AgentVaultsSection,` 放在 `"agent-environments"` 之后。
- `AppShell.tsx`：`{ href: "/admin/agent-environments", ... }` 之后插入 `{ href: "/admin/agent-vaults", labelKey: "agentVaults", icon: LockKeyhole },`，`lucide-react` import 列表加 `LockKeyhole`。

### 5.9 脚本与部署（只增行）

1. `enterprise/scripts/start-dev.sh`：在「3) 可选自动迁移」块之前（Next 应用启动之前，以便 admin-console 继承变量）插入：

   ```bash
   # 托管智能体凭证库主密钥（本地开发自动生成；生产由部署方注入 MA_VAULT_MASTER_KEY / _FILE）。
   if [ -z "${MA_VAULT_MASTER_KEY:-}" ] && [ -z "${MA_VAULT_MASTER_KEY_FILE:-}" ]; then
     mkdir -p "$ENTERPRISE_DIR/.local-secrets"
     export MA_VAULT_MASTER_KEY_FILE="$ENTERPRISE_DIR/.local-secrets/ma_vault_master.key"
     if [ ! -s "$MA_VAULT_MASTER_KEY_FILE" ]; then
       openssl rand -base64 48 | tr -d '\n' > "$MA_VAULT_MASTER_KEY_FILE"
       chmod 600 "$MA_VAULT_MASTER_KEY_FILE"
       echo "[start-dev] generated $MA_VAULT_MASTER_KEY_FILE"
     fi
   fi
   ```
2. `enterprise/scripts/bootstrap.sh`：local 模式 secrets 生成段内追加同样的文件生成（用脚本已有的 `random_hex 32`），并在 `.env.local` heredoc 追加一行 `MA_VAULT_MASTER_KEY_FILE='${MA_VAULT_MASTER_KEY_FILE:-}'`（放在 E03 追加的 MA 行之后；若 E03 未合入，放在 `GATEWAY_MCP_HOSTING=` 行之后）。
3. `enterprise/.env.local.example` 追加：

   ```bash
   # 托管智能体凭证库主密钥（≥32 字符随机串）。丢失后已存凭证无法解密；轮换时把旧值放入 MA_VAULT_MASTER_KEY_PREVIOUS。
   MA_VAULT_MASTER_KEY_FILE=.local-secrets/ma_vault_master.key
   # MA_VAULT_MASTER_KEY_PREVIOUS=
   # 紧急关闭运行时凭证解析（0 = 关闭）。
   MA_VAULT_RESOLVE_ENABLED=1
   ```
4. `prod.yml` 的 `admin-console.environment` 追加 `MA_VAULT_MASTER_KEY: ${MA_VAULT_MASTER_KEY:-}`、`MA_VAULT_MASTER_KEY_PREVIOUS: ${MA_VAULT_MASTER_KEY_PREVIOUS:-}`、`MA_VAULT_RESOLVE_ENABLED: ${MA_VAULT_RESOLVE_ENABLED:-1}`。

### 5.10 文档

- `docs/managed-agents/protocol.md` 文末追加「## Vault 控制面（MA-E06）」：公共接口表（§5.4）、凭证类型与身份键（§4.4）、`mcp_server_url` 归一化规则（§5.1.2 原文）、内部解析接口请求 / 响应示例（§5.6.2，token 用 `<plaintext>` 占位）、错误码表（§5.5）。
- `docs/managed-agents/threat-model.md` §1 末尾追加段落：「MA-E06 落地：凭证以两层信封加密存储（DEK + 主密钥），读接口只返回 `has_secret` 等非敏感字段；运行时解析接口只服务 agent-runtime，校验会话引用关系，并对每次解析写 `audit_events`（`ma.vault.resolve`）。主密钥丢失 = 全部凭证不可解密，需重新登记。」

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 托管会话需要 MCP 令牌 | 无处登记；Manifest 禁止写 `headers` | 管理员在「凭证库」登记，会话 `vault_ids` 引用，A06 经内部接口取用 |
| 读凭证 | — | 任何读接口只返回元数据 + `has_secret`；明文只出现在内部解析接口响应中 |
| 凭证落库 | — | `secret_ciphertext` + `wrapped_dek`，每条凭证独立 DEK |
| 一次运行时解析 | — | `audit_events` 一行 `ma.vault.resolve`（target = 会话） |
| 未配置主密钥 | — | 写入 / 轮换 / 解析返回 503；列表与详情可用 |

---

## 7. FR / NFR / AC

测试约定：iam-core 与 admin-console 用 vitest；路由测试 `vi.mock("@agenticx/iam-core", ...)`（照 `internal-routes.test.ts` 样板）；加密与校验是纯函数，直接测。

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 双方言表结构 | `ma-schema.test.ts`：`MA_COLUMNS` 增加 `ma_vaults`（10 列）、`ma_credentials`（21 列），列名集合 PG / MySQL 一致，`active_identity_key` 两边都可空；`schema-parity.test.ts::mirrors all 81 PostgreSQL tables in MySQL`；MySQL 文件清单与 journal 含 `0037_ma_vaults`；`migration-inventory.test.ts` journal 63 条、末 3 tag 以 `"0063_ma_vaults"` 结尾、磁盘 65 个 `.sql`（数字以实施时 E03 合入后的实际值 +1 为准） |
| FR-2 | 信封加密 | `ma-vault-crypto.test.ts`：`test("seal/open roundtrip")` 原文 `{token:"tok-abcdefgh-123"}` → open 相等；`test("ciphertext never contains plaintext")` `ciphertext`、`wrappedDek` 都不含 `tok-abcdefgh-123`，且两次 seal 同一原文得到不同 ciphertext 与不同 wrappedDek；`test("missing master key -> VaultCryptoUnavailableError")`；`test("weak master key rejected")`（`"short"`）；`test("previous key fallback")`：用 key A seal，env 改为 current=B、previous=A → open 成功；current=B、无 previous → `VaultDecryptError`，且 `error.message === "cannot decrypt credential"`；`test("tampered ciphertext -> VaultDecryptError")` | gitleaks:allow
| FR-3 | URL / host / secret_name 校验 | `ma-vault-validate.test.ts`：`normalizeMcpServerUrl` 表驱动：`"https://MCP.Example.com:443/mcp/"` → `"https://mcp.example.com/mcp"`；`"https://x.com/"` → `"https://x.com"`；`"https://x.com:8443/a"` → `"https://x.com:8443/a"`；拒绝 `http://x.com`、`https://u:p@x.com`、`https://x.com/?a=1`、`https://x.com/#f`、`https://例子.com`；`normalizeHost("*.Example.com",{allowWildcard:true})` → `"*.example.com"`；拒绝 `"*"`、`"*.com"`、`"x.com:443"`、`"https://x.com"`；`allowWildcard:false` 拒绝 `"*.x.com"`；`validateSecretName`：接受 `EXAMPLE_API_KEY`，拒绝 `path`、`PATH`、`LD_PRELOAD`、`AGX_X`、`1ABC` | gitleaks:allow
| FR-4 | 凭证创建校验 | `ma-vault-validate.test.ts`：四类型最小合法体都通过且 `identityKind/identityKey/publicConfig/secrets` 符合 §4.4；`environment_variable` 缺 `networking` → 消息以 `auth.networking:` 开头；`limited` + 17 个主机 → 拒绝；`unrestricted` + `allowed_hosts` → 拒绝；`static_bearer` token 以 `Bearer ` 开头 → 拒绝；token 含 `${cred:X}` → 拒绝；`mcp_oauth` 有 `refresh` 无 `expires_at` → 拒绝；`token_endpoint_auth.type="none"` 带 `client_secret` → 拒绝；未知键 `auth.foo` → `auth.foo: unknown field` |
| FR-5 | 轮换校验 | `ma-vault-validate.test.ts::patch`：带 `mcp_server_url` → `is immutable`；`type` 不同 → 拒绝；只给 `token` → `secrets={token}`；`mcp_oauth` `refresh:null` → `clearSecrets` 含 `refresh_token`、`client_secret` 且 `publicConfigPatch.refresh === null`；改 `refresh.client_id` → `auth.refresh.client_id: is immutable`；空 auth → `request: nothing to update` |
| FR-6 | OAuth 刷新 | `ma-vault-refresh.test.ts`（把刷新逻辑拆成导出纯函数 `refreshMcpOAuthIfNeeded(cred, secrets, {fetchImpl, now})`，返回 `{secrets, expiresAt, refreshed, failed, status}`）：`expires_at` 在 10 分钟后 → 不调用 fetch；在 2 分钟后 → 以 `client_secret_basic` 调用，断言 `Authorization` 头为 `Basic base64("cid:cs")`、body 含 `grant_type=refresh_token&refresh_token=rt1`；响应 `{access_token:"at2",expires_in:3600,refresh_token:"rt2"}` → `secrets.access_token==="at2"`、`refresh_token==="rt2"`、`expiresAt` = now+3600s；响应 `expires_in:"3600"` → `failed=true` 且 secrets 不变；fetch 抛错 → `failed=true, status=0`；`client_secret_post` → body 含 `client_id` 与 `client_secret`，无 Authorization |
| FR-7 | 公共接口只写不读 | `vaults-route.test.ts`：mock repo；`POST credentials`（`static_bearer`，token `ghp_secret_value_123456`）→ 201，`JSON.stringify(response)` 不含 `ghp_secret_value_123456`、含 `"has_secret":true`；GET 列表 / 详情同样不含；`mcp_oauth` 记录含 `has_refresh_token:true` 且不含 refresh_token 原文；缺 token → 401；只有 `ma:vaults:read` 的 PAT 调 POST → 403 `forbidden_scope`；未知顶层键 → 400 `invalid_request` 且消息 `unknown field: x` |
| FR-8 | 错误码映射 | `vaults-route.test.ts::error mapping`：repo 依次抛 `MaVaultNotFoundError`、`MaCredentialIdentityConflictError`、`MaVaultCredentialLimitError`、`MaVaultNotArchivedError`、`VaultCryptoUnavailableError` → 状态码依次 404 / 409 / 409 / 409 / 503 且 `error.code` 依次为 `vault_not_found` / `credential_identity_conflict` / `vault_credential_limit` / `vault_not_archived` / `vault_crypto_unavailable` |
| FR-9 | 内部 validate | `vault-internal-routes.test.ts::validate`：无 token → 401；`vault_ids` 21 个 → 400；正常 → 原序返回 status；响应头 `cache-control: no-store` |
| FR-10 | 内部 resolve 校验 | `vault-internal-routes.test.ts::resolve`：`getMaSession` 返回 null → 404 `session_not_found`；会话 `status:"archived"` → 409 `session_terminated`；请求 vault 不在 `vaultIds` → 400；`MA_VAULT_RESOLVE_ENABLED=0` → 503 |
| FR-11 | 内部 resolve 输出与审计 | 同文件：mock `resolveVaultBundle` 的依赖（把 repo 内部函数拆成可注入的 `deps`，或在 repo 测试中直测 `resolveVaultBundle`）：两 vault（第二个 archived）→ `credentials` 顺序按 vault 与创建时间，`skipped=[{vault_id:B, reason:"archived"}]`；`insertAuditEvent` 被调用一次，参数 `eventType:"ma.vault.resolve"`、`targetKind:"ma_session"`、`targetId:sid`、`actorUserId:null`，`JSON.stringify(detail)` 不含任何 secret；`insertAuditEvent` 抛错 → 500 且响应体不含 secret |
| FR-12 | 管理台接口 | `api/admin/ma-vaults/__tests__/route.test.ts`：`requireAdminScope` 返回无权限 → 403；创建成功 → `{code:"00000"}` 且 `data.credential` 无 secret；冲突 → 409 中文消息「该凭证库中已存在相同匹配目标的有效凭证」；503 消息含 `MA_VAULT_MASTER_KEY` |
| FR-13 | 管理页（W4 门） | 手动：`/admin/agent-vaults` 新建凭证库 → 添加 `static_bearer`（MCP URL + 令牌）与 `environment_variable`（`EXAMPLE_API_KEY`，限定 `api.example.com`）→ 列表显示两条「有效」凭证、密钥字段为空；轮换后「最近轮换」更新；归档对话框为主题化弹窗；删除凭证库需输入名称；浏览器开发者工具 Network 面板所有响应均不含令牌原文 |
| FR-14 | 平台页注册 | `admin-platform-sections.test.ts` 含 `"agent-vaults"` 且位于 `"agent-environments"` 之后 |
| NFR-1 | 不泄露 | `rg -n "console\.(log|info|warn|error)\(" enterprise/packages/iam-core/src/ma-vault-crypto.ts enterprise/packages/iam-core/src/repos/ma-vaults.ts enterprise/apps/admin-console/src/app/api/internal/ma/vault-resolve` 人工复核：日志参数只含 id / 事件名 |
| NFR-2 | 真落库（禁止 mock 成功） | 手动实库检查（§8 末段）：创建凭证后 `psql` 查 `ma_credentials` 行存在、`secret_ciphertext` 非空且不含原文、`audit_events` 有 `ma.credential.create`；解析后有 `ma.vault.resolve` |
| NFR-3 | 类型检查与构建 | `pnpm -C enterprise --filter @agenticx/db-schema typecheck`、`--filter @agenticx/iam-core typecheck`、`--filter @agenticx/admin-console typecheck` 与 `build` 全绿 |
| NFR-4 | 不越界 | `git diff --name-only` 只出现 §3.1 列出的文件 |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX/enterprise
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/db-schema test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/iam-core test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/admin-console test
pnpm --filter @agenticx/db-schema typecheck
pnpm --filter @agenticx/iam-core typecheck
pnpm --filter @agenticx/admin-console typecheck
pnpm --filter @agenticx/admin-console build
bash -n scripts/start-dev.sh scripts/bootstrap.sh
DATABASE_URL=x DEFAULT_TENANT_ID=x GATEWAY_INTERNAL_TOKEN=x ADMIN_CONSOLE_LOGIN_PASSWORD=x ADMIN_CONSOLE_SESSION_SECRET=x \
  docker compose -f deploy/docker-compose/prod.yml config >/dev/null && echo "compose ok"
```

实库联调（需中间件；`bash scripts/start-dev-with-infra.sh --ui=stream` 起栈后另开终端）：

```bash
cd /Users/damon/myWork/AgenticX/enterprise
PAT=<在 /admin/api-tokens 创建、scope 含 ma:vaults:read / ma:vaults:write 的令牌>
V=$(curl --noproxy '*' -s -X POST http://127.0.0.1:3001/api/ma/v1/vaults -H "Authorization: Bearer $PAT" \
  -H 'content-type: application/json' -d '{"display_name":"W4 测试"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["vault"]["id"])')
curl --noproxy '*' -s -X POST http://127.0.0.1:3001/api/ma/v1/vaults/$V/credentials -H "Authorization: Bearer $PAT" \
  -H 'content-type: application/json' \
  -d '{"auth":{"type":"static_bearer","mcp_server_url":"https://mcp.example.com/mcp","token":"w4-secret-token-123456"}}' | tee /tmp/cred.json
grep -c "w4-secret-token-123456" /tmp/cred.json   # 期望 0
psql "$DATABASE_URL" -c "select id, type, identity_key, length(secret_ciphertext) > 0 as sealed, position('w4-secret' in secret_ciphertext) as leak from ma_credentials order by created_at desc limit 1;"   # leak 期望 0
psql "$DATABASE_URL" -c "select event_type, target_kind, target_id from audit_events where event_type like 'ma.%' order by created_at desc limit 5;"
# 内部解析（需一条 vault_ids 含 $V 的 ma_sessions 行；W4 联调由 A06 的会话创建产生）
```

---

## 9. 回滚

- 紧急止血：`MA_VAULT_RESOLVE_ENABLED=0` → 运行时解析一律 503，A06 侧把会话回合以 `vault_resolution_failed` 收尾（不会以无凭证状态静默执行）。
- 代码回滚：删除 §3.1 新建文件、`git checkout` 被修改文件；导航与 slug 白名单随之恢复。
- 迁移为纯新增表，代码回滚后表保留无害；物理回滚：`DROP TABLE IF EXISTS "ma_credentials"; DROP TABLE IF EXISTS "ma_vaults";` 并删除 `__drizzle_migrations` 对应行（以实际库为准）。
- 主密钥：丢失 = 全部凭证需重新登记；轮换步骤写进 `.env.local.example` 注释（旧值放 `MA_VAULT_MASTER_KEY_PREVIOUS`）。

---

## 10. 不变量、风险与待确认问题

### 10.1 不变量

1. 任何 HTTP 响应（公共 / 管理台）都不含密钥原文、`secret_ciphertext`、`wrapped_dek`、`kek_id`；唯一例外是 `POST /api/internal/ma/vault-resolve`（`MA_INTERNAL_TOKEN` 保护）。
2. `ma_vaults` / `ma_credentials` 只由 admin-console 进程写入。
3. 每次成功的运行时解析都有一行 `audit_events`（`ma.vault.resolve`）；审计失败则不返回密钥。
4. 现有 `provider-api-key-crypto`、`mcp-backend-config-crypto`、PAT、MCP 托管、执行环境、智能体页面行为不变。
5. `MA_ERROR_CODES` / MA-00 `ALL_ERROR_CODES` 不变（新增码只在 `MA_CONTROL_PLANE_ERROR_CODES`）。
6. 不带新环境变量启动时，现有页面与接口全部可用；只有凭证写入 / 解析返回 503。

### 10.2 风险

1. 主密钥与数据库同机存放时，信封加密只防「拿到数据库备份」不防「拿到整台机器」；生产应由密钥管理系统注入环境变量或文件挂载。
2. `mcp_oauth` 刷新由 admin-console 出站访问管理员填写的 `token_endpoint`（仅 https、禁止重定向、10 秒超时）。仍存在把 admin-console 当作出站跳板的可能，需在部署层限制 admin-console 出站。
3. `listVaultReferences` 的智能体匹配是对最新版本 manifest 的线性扫描，租户内智能体数千个时会变慢（只在详情页按需调用）。

### 10.3 须先登记到 master §12 / 待确认问题

- **登记项（实施前由用户写入 master §12）**：新增 7 个控制面错误码 `vault_not_found` 404、`credential_not_found` 404、`credential_identity_conflict` 409、`vault_credential_limit` 409、`vault_not_archived` 409、`vault_archived` 409、`vault_crypto_unavailable` 503；审计表选用 `audit_events`；迁移编号 0063 / 0037。
- **Q1**：会话引用 Vault 的授权粒度。四家都是「工作空间内共享」。本子规划不做 Vault 级可见范围；A06 规定引用 `vault_ids` 需调用方 PAT 同时持有 `ma:vaults:read`（见 A06 D7）。是否需要「按部门 / 用户限定哪些 Vault 可被谁引用」？
- **Q2**：管理台权限复用 `provider:*`。是否要新增独立资源 `vault:*` 到 `SCOPE_REGISTRY`？
- **Q3**：是否需要创建时 MCP 握手探测与 `mcp_oauth_validate`？需要的话另起子规划并评估 admin-console 出站策略。
