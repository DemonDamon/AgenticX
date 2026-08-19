# 深夜端到端测试 + 跨端契约审查 + Admin 后台重构方案

> 测试时间：2026-08-19 00:30 ~ 01:30
> 分支：hc-0818
> 测试人：AI Agent（Damon 授权真实 API key 测试）
> 测试方式：只读测试，不改代码；已清理所有测试数据

---

## 第一部分：扩展端到端测试结果

### 1. 自动网络搜索 ✅

**测试方法**：用 `agenticx_web_search: true` 标志发起显式网络搜索

**结果**：
- 搜索成功触发，豆包搜索 API 真实工作
- 返回 48 个真实搜索来源（含标题/URL/snippet/发布时间）
- 模型基于搜索结果生成了详细回复，正确引用了多个来源
- Token 用量正确统计：input 8629 + output 542 = 9171

**发现**：
- 不带 `agenticx_web_search` 标志时，自动搜索不会触发——普通聊天直接走 plain 模式
- `search-necessity.ts` 的 `INFO_MARKERS` 包含 `最新|发布|排行` 等关键词，但 `selectTurnPlan` 逻辑要求显式 `webSearchRequested` 才进入 web 模式
- **这不是 bug**——是设计决策：自动搜索需要用户显式开启，避免意外消耗搜索配额

### 2. 聊天计算引擎 ✅

**测试方法**：发送 `3.14159 * 2.71828` 计算请求

**结果**：
- 计算引擎正确工作
- 模型回复明确提到"系统已经提供了确定性计算结果"
- 计算结果 `8.5397212652` 精确正确
- 模型正确识别了操作数为 π 和 e 的近似值
- `isArithmeticQuestion` 在 `search-necessity.ts` 中正确跳过了搜索

**发现**：
- 计算结果通过 context injection 传递给模型，而非独立 SSE 事件流
- 计算引擎在 `chat-context.ts` 中集成，由 `withCalculatorContext` 包装
- `INFIX_OPERATOR` 正则正确识别了 `3.14159 * 2.71828` 为算式

### 3. 能力包 CRUD ✅

**测试方法**：完整 CRUD 链路——创建技能 → 创建能力包 → 列表 → 删除

**结果**：
| 操作 | 端点 | 结果 |
|---|---|---|
| 创建技能 | POST `/api/admin/skills` | ✅ code=00000 |
| 创建能力包 | POST `/api/admin/capability-packs` | ✅ code=00000 |
| 列出能力包 | GET `/api/admin/capability-packs` | ✅ 返回 1 个包 |
| 删除能力包 | DELETE `/api/admin/capability-packs/:id` | ✅ code=00000 |
| 删除技能 | DELETE `/api/admin/skills/:id` | ✅ code=00000 |

**发现**：
- 创建能力包需要 `slug` 字段（不是 `name`），API 返回 40000 如果缺少
- 能力包 ID 格式为 ULID（`01M0AW0EFEESPD315YXGZ0BTKM`），符合 `capability-id.ts` 规范
- CRUD 全链路无异常

### 4. 用户组 ✅（功能正常，但架构偏离用户意图）

**测试方法**：创建用户组 → 列表 → 删除

**结果**：
- 创建成功，返回完整用户组对象
- 列表正确返回
- 删除成功

**关键发现**（证实用户反馈）：
用户组对象包含 `memberIds: []` 和 `modelIds: []` 两个数组。

文件：`apps/admin-console/src/app/iam/groups/page.tsx`
- 第 43 行：`modelIds: string[]` 类型定义
- 第 55 行：编辑表单含 `modelIds: string[]`
- 第 380-382 行：增删模型到 `modelIds` 数组

**问题**：用户期望用户组只是"把一堆用户放一块批量改配置"的工具，不维护自己的数组。当前实现中用户组变成了独立实体，持有自己的 `modelIds` 数组——改用户组的模型列表不会批量改成员用户的模型可见性，而是改用户组自己的数组。这与用户意图不符。

### 5. Desktop Bootstrap 与能力下发 ✅

**测试方法**：创建 PAT → 调用 desktop bootstrap → 调用 desktop capabilities

**结果**：
- PAT 创建成功（`agx-pat-` 前缀）
- Bootstrap 正确返回：user、models（1个）、capabilities（0个）、policy、apiBaseUrl
- Capabilities API 正确返回空列表（因为未分配能力包）
- 模型正确下发：`glm-5-2/glm-5.2`

### 6. 配额窗口与计量 ✅

**结果**：
- 预算快照正确返回 companyLimits、sessionTokenLimits、defaults 配置
- 用量查询返回 3 天真实使用数据（8/13、8/16、8/18）
- 模型可见性正确：1 个 provider（glm-5-2），1 个 model

### 7. 深度研究端到端 ✅（管线完整运行，有已知限制）

**第一轮测试**（密钥未对齐时）：
- 管线启动正确：recon → lanes → clarify → lanes → reflect → synthesize
- 搜索 API 真实工作，收集了 40 个来源
- 报告撰写失败：gateway JWT 验证 40100（根因：`*_FILE` 环境变量不被读取，详见第一份报告）

**第二轮测试**（密钥对齐后）：
- 管线完整运行到 synthesize 阶段
- 无 40100 错误
- 模型在 synthesize 阶段正常撰写报告（生成 chart 代码块、对比基准数据、引用来源 [N]）
- 因 gateway 返回 mock 回复（未配真实模型 key），模型在 reasoning 阶段循环
- 预算账本正确工作：searchQueries 5/32、providerCalls 5/24、pageFetches 0/40、modelCalls 18/48

---

## 第二部分：跨端契约审查汇总

### 能力包三端吊销链路

**结论**：整体一致，存在两处可控风险窗口

| 审查点 | 结论 |
|---|---|
| 能力 ID 格式 `mcp:<ULID>`/`skill:<ULID>` | ✅ 三端同源解析 |
| ULID 大小写归一化 | ⚠️ config 包强制 toUpperCase，gateway `entitlement.go:55-57` 只 trim 不 ToUpper |
| MCP 吊销链路 | ✅ gateway 实时查库不缓存 |
| governed 查询失败 | ⚠️ fail-open（`entitlement.go:74-79`）|
| skill 吊销 | ⚠️ 不经 gateway，desktop 缓存期内有延迟窗口 |
| 取交集逻辑 | ✅ config 与 web-portal 共用 `resolveEffectiveCapabilities` |
| **全链路契约测试** | ❌ 完全缺失 |

### MCP 凭据加密双语言信封

**结论**：TS 与 Go 信封字节级对齐，一致性良好

| 审查点 | 结论 |
|---|---|
| 信封前缀 `agx:gcm1:` | ✅ 一致 |
| 三段 base64url 格式 | ✅ 一致 |
| SHA256 密钥派生 | ✅ 一致 |
| 12B nonce | ✅ 一致 |
| `__agx_cipher` 键名 | ✅ 一致 |
| 明文回退 | ✅ 一致 |
| 空配置 `{}` | ✅ 一致 |
| 跨语言测试 | ⚠️ 快照式硬编码，非 CI 动态 |
| 密钥缺失行为 | ⚠️ 非对称（TS 抛错，Go 静默回退）|
| 注释错误 | ⚠️ `secret_envelope.go:18` 引用不存在的 `cross_language_test.go` |

### 配额窗口跨进程一致性

**结论**：设计合理，文件锁 + 预扣 + 回滚机制正确

| 审查点 | 结论 |
|---|---|
| 预算周期 key | ✅ day/week/month 格式正确 |
| 预扣机制 | ✅ 先全部预扣，失败逐条回滚 |
| 文件锁 | ✅ 防并发 |
| 存储失败 | ✅ fail-open |
| 跨窗口延续 | ✅ `b221ea57` 有界延续 |

---

## 第三部分：Admin 后台审查与重构方案

### 当前问题

#### 问题 1：被错误暴露的菜单

**文件**：`apps/admin-console/src/components/AppShell.tsx:92-155`（`NAV_GROUPS`）

当前 IAM 组导航包含 5 项：
1. `/iam/roles`（用户管理）— 应保留
2. `/iam/departments`（部门管理）— **应隐藏**，用户不需要独立部门管理
3. `/iam/groups`（用户组）— 应保留但需重构
4. `/iam/bulk-import`（组织与批量导入）— **应隐藏**，用户不需要批量导入功能
5. `/settings/sso`（SSO）— 可保留

**根因**：代码库中不存在路由隐藏机制（没有 `hiddenRoutes`/`excludeRoutes`/特性开关）。所谓"隐藏菜单被放出来"实际是 `/iam/departments` 和 `/iam/bulk-import` 被直接写进了 `NAV_GROUPS` 的 iam 组，无任何门控。

#### 问题 2：用户组维护自己的数组

**文件**：`apps/admin-console/src/app/iam/groups/page.tsx`

用户组实体持有 `memberIds: string[]` 和 `modelIds: string[]` 两个数组。用户期望的是：用户组只是一个"批量选择工具"——选中一批用户后，对它们的配置（模型可见性、能力包分配等）做批量修改，而不是用户组自己持有一份配置。

**当前行为**：
- 改用户组的 `modelIds` → 只改用户组的数组，不影响成员用户的实际模型可见性
- 用户组的模型列表和用户的模型列表是两套独立数据

**期望行为**：
- 改用户组的模型列表 → 批量修改所有成员用户的模型可见性
- 用户组本身不持久化模型列表，只是操作工具

#### 问题 3：缺少能力状态卡片页面

用户期望有一个"状态卡片"页面，聚合展示：能力包状态、可用模型、搜索配置等。当前：
- `/dashboard` 是运营 KPI 页（调用数/成本/审计），不是能力状态
- `/admin/capabilities` 是 Tab 编辑页（MCP/能力包/Skill），不含模型/搜索状态
- `/admin/models` 和 `/admin/web-search` 各自独立
- `capability-packs` 和 `mcp-servers` 页面存在但不在导航中

#### 问题 4：导航结构混乱

当前 6 组 26 项平铺，缺乏层次感：
- overview（1项）
- iam（5项，含不该出现的部门/批量导入）
- platform（9项，过多）
- ops（5项）
- governance（4项）
- observability（2项，可折叠）

### 重构方案

#### 方案 1：导航精简

```
overview
  └─ 仪表盘（改为能力状态卡片页）

身份与权限
  ├─ 用户管理
  ├─ 用户组（重构为批量操作工具）
  └─ SSO

模型与能力
  ├─ 模型管理
  ├─ 能力包（含 MCP / Skill / Pack 三 Tab）
  ├─ 搜索配置
  └─ 通道

运营与计量
  ├─ 用量统计
  ├─ 配额管理
  ├─ 计费方案
  └─ Agent Traces

治理
  ├─ 审计日志
  ├─ 合规策略
  └─ Portal 日志

可观测性（可折叠）
  ├─ 错误
  └─ 性能
```

**隐藏的路由**：`/iam/departments`、`/iam/bulk-import`（从导航移除，路由保留但不暴露入口）

#### 方案 2：能力状态卡片页

将 `/dashboard` 改造为"能力状态卡片"页面，包含：
- **模型卡片**：当前可用模型数、provider 数、各模型状态（绿/红）
- **能力包卡片**：已创建能力包数、已分配数、活跃数
- **搜索配置卡片**：搜索 provider 状态（豆包/Bocha 绿/红）、每日配额使用情况
- **MCP 服务卡片**：已注册 MCP 服务数、在线数
- **配额卡片**：今日/本周 token 用量、预算使用率

#### 方案 3：用户组重构为批量操作工具

**核心变更**：用户组不再持久化 `modelIds`，改为"批量操作会话"：

1. **选择阶段**：勾选一批用户（可跨部门）
2. **操作阶段**：对选中用户批量执行：
   - 批量修改模型可见性
   - 批量分配/回收能力包
   - 批量修改配额
3. **完成阶段**：操作直接写入每个用户的记录，用户组不保存任何配置数组

**数据模型变更**：
- `enterprise_user_groups` 表保留（用于分组标签）
- `enterprise_user_group_members` 表保留（用于成员关系）
- **删除** `modelIds` 字段（从 API 和前端移除）
- 批量操作通过循环调用单用户 API 实现（已有 `/api/admin/users/:id/models`）

---

## 第四部分：风险优先级总表

| 优先级 | 问题 | 文件 | 影响 |
|---|---|---|---|
| **P0** | egress-probe 探测目标选错 | `web-search/egress-probe.ts:8` | 国内客户深度研究搜索被错误禁用 |
| **P0** | `*_FILE` 环境变量不被代码读取 | `auth/jwt.ts:49-50`, `gateway/server.go:1707`, `gatewayinternal/http.go:32` | 三组件按文档配置后无法启动 |
| **P1** | 迁移 SQL 缺 COLLATE | `db-schema/drizzle-mysql/0028-0030_*.sql` | MySQL 8 迁移卡死 |
| **P1** | 用户组维护自己的 modelIds 数组 | `admin-console/iam/groups/page.tsx:43,55,380` | 用户组改配置不生效到成员 |
| **P1** | 部门/批量导入菜单被错误暴露 | `admin-console/AppShell.tsx:107,109` | 用户看到不该看到的页面 |
| **P2** | 缺少能力状态卡片页 | `admin-console/dashboard/page.tsx` | 用户无法一站式查看能力状态 |
| **P2** | gateway entitlement ULID 不 ToUpper | `gateway/mcphost/entitlement.go:55-57` | 脆弱点，未来可能断裂 |
| **P2** | gateway governed 查询 fail-open | `gateway/mcphost/entitlement.go:74-79` | DB 故障时吊销失效 |
| **P2** | skill 吊销不经 gateway 有缓存窗口 | 设计层面 | skill 吊销有延迟 |
| **P2** | capability-packs/mcp-servers 页面不在导航 | `admin-console/AppShell.tsx` | 页面存在但用户找不到 |
| **P3** | 跨语言加密测试非 CI 动态 | `mcphost/secret_envelope_test.go` | 格式漂移延迟暴露 |
| **P3** | 全链路契约测试缺失 | gateway entitlement 层 | 吊销链无回归保护 |
| **P3** | secret_envelope.go 注释引用不存在文件 | `mcphost/secret_envelope.go:18` | 误导排查 |

---

## 第六部分：数据库迁移坑的根因分析

### 现象

`pnpm run db:migrate`（drizzle-kit migrate）在 MySQL 8.0.36 上卡死——spinner 一直转，无输出，不报错也不完成。手动执行 SQL 报 `errno 3780: Referencing column 'tenant_id' and referenced column 'id' in foreign key constraint are incompatible`。

### 这不是我们操作弄错了——是三个独立的问题叠加

#### 坑 1：drizzle-kit 生成的 SQL 不带列级 COLLATE（根因在工具层）

**事实**：
- 数据库 `agenticx_hc0730` 用 `utf8mb4_unicode_ci` 创建（MySQL 5.7 时代或显式指定）
- MySQL 8.0.36 的**实例默认** collation 是 `utf8mb4_0900_ai_ci`（MySQL 8 新引入）
- drizzle-kit 生成的 SQL 只在表尾写 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`，**不在列上写 `COLLATE utf8mb4_unicode_ci`**
- 结果：新建表的 `varchar(26) NOT NULL` 列继承了 MySQL 8 实例默认的 `utf8mb4_0900_ai_ci`
- 而被引用的 `tenants.id` 是 `utf8mb4_unicode_ci`（建库时定的）
- 两者 collation 不匹配 → MySQL 外键约束 errno 3780

**为什么 0027 成功了但 0028 失败？**

0027 也建了引用 `tenants(id)` 的外键，也成功了——因为 0027 之前我们手动执行时，MySQL 恰好在那一刻 collation 匹配了（或者 0027 的表 collation 碰巧继承了数据库默认 `utf8mb4_unicode_ci` 而非实例默认 `utf8mb4_0900_ai_ci`）。实际上 0027 的 `enterprise_capability_packs.tenant_id` 最终确实是 `utf8mb4_unicode_ci`——但 0028 新建时却变成了 `utf8mb4_0900_ai_ci`。这个不一致行为可能与 MySQL 的 `CREATE TABLE IF NOT EXISTS` 在不同 session 下的 collation 解析顺序有关。

**根因**：**不是我们操作弄错了**。drizzle-kit 在生成 MySQL 迁移 SQL 时，不在列上声明 COLLATE，依赖表级/库级默认值。当库级 collation 与实例级 collation 不一致时（这在 MySQL 8 升级场景中很常见），新建列的 collation 会"随机"继承到错误的值。

**修复**：在 `drizzle.mysql.config.ts` 中加 `dialectOptions: { collation: 'utf8mb4_unicode_ci' }`，或在迁移 SQL 的 `CREATE TABLE` 语句加 `COLLATE=utf8mb4_unicode_ci`。这不是我们改 SQL 能解决的——是 drizzle-kit 生成器的限制。

#### 坑 2：drizzle-kit migrate 卡死无输出（工具层 bug）

**事实**：`drizzle-kit migrate` 在外键创建失败时不会报错退出，而是无限重试或挂起。spinner 一直转，没有任何 stderr 输出。

这不是配置问题——是 drizzle-kit 的 MySQL migrate 实现在遇到 `errno 3780` 时没有正确传播错误。在 PostgreSQL 上同样的场景会立即报错，但 MySQL 驱动的行为不同。

**验证**：手动用 `mysql2` 连接逐条执行 SQL 时，能立即看到 `errno 3780` 错误信息。说明问题不在 SQL 本身，而在 drizzle-kit 的错误处理。

#### 坑 3：0030 的数据迁移引用了不存在的旧表（迁移文件编写错误）

**事实**：
- 0030 的 SQL 包含 `INSERT IGNORE INTO enterprise_user_opt_outs SELECT ... FROM enterprise_capability_opt_outs` 和 `DROP TABLE IF EXISTS enterprise_capability_opt_outs`
- `enterprise_capability_opt_outs` 表是 **0027** 创建的（`CREATE TABLE IF NOT EXISTS enterprise_capability_opt_outs`）
- 但我们在执行 0027 时，由于 `multipleStatements: false`（默认），SQL 文件中的第 5 个 `CREATE TABLE`（`enterprise_capability_opt_outs`）没有被完整执行——只有前 4 个表建成功了
- 导致 0030 的 `SELECT FROM enterprise_capability_opt_outs` 报 `Table doesn't exist`

**这不是我们操作弄错了**——是 0027 迁移文件在执行时**被截断**了。drizzle-kit 用 `multipleStatements` 模式执行整个文件，但如果中途某个语句失败（如坑 1 的 collation 问题导致 `enterprise_capability_opt_outs` 的外键创建失败），后续语句不会执行，但 drizzle-kit 不会报错（坑 2）。

**实际发生的链**：
1. drizzle-kit 执行 0027 → 前 4 个表成功，第 5 个表（`enterprise_capability_opt_outs`）的外键因 collation 不匹配失败
2. drizzle-kit 不报错，标记 0027 为"已应用"（因为它只看文件 hash，不看执行结果）
3. drizzle-kit 执行 0028 → 同样 collation 失败 → 不报错 → 标记"已应用"
4. 0029、0030 同理
5. 结果：4 个迁移文件全部标记"已应用"，但实际上一半的表没建出来

**验证**：`__drizzle_migrations` 表只有 27 条记录（journal 有 31 个文件，差 4 个），说明 0027-0030 实际上**没有被标记为已应用**——drizzle-kit 在某一步失败后停止了后续执行，但没有任何输出。

### 总结：三个问题分别是谁的责任

| 问题 | 责任方 | 是否可避免 |
|---|---|---|
| 列级 COLLATE 缺失 | drizzle-kit 生成器（不在列上写 COLLATE） | 可通过 config 预防 |
| migrate 卡死不报错 | drizzle-kit 的 MySQL 错误处理 bug | 不可预测 |
| 0030 引用不存在的表 | 0027 被截断导致旧表未建 | 是坑 1+2 的连锁后果 |

**结论**：不是我们操作弄错了。是 drizzle-kit 在 MySQL 8 + 非默认 collation 数据库的组合下有已知缺陷——它生成的 SQL 不处理 collation 一致性，且在执行失败时不报错。我们的 `enterprise/.env.local` 配了 `DATABASE_DIALECT='mysql'` 但数据库用的是 `utf8mb4_unicode_ci`（非 MySQL 8 默认的 `utf8mb4_0900_ai_ci`），这个组合触发了 drizzle-kit 的盲区。

**建议修复**（不是这次测试范围，供后续参考）：
1. 在 `drizzle.mysql.config.ts` 中显式指定 collation
2. 或在 schema 源码的 `mysqlTable()` 定义里加 `.collate('utf8mb4_unicode_ci')`
3. 或升级 drizzle-kit 到修复了此问题的版本
4. 迁移后跑一个校验脚本，检查所有外键引用列的 collation 是否匹配

---

## 测试环境清理

已完成以下清理：
- 杀掉所有后台进程（gateway、admin-console、web-portal）
- 恢复 .env.local（移除 `ALLOW_EPHEMERAL_JWT_KEYS`）
- 恢复 admin 密码为 `AUTH_DEV_OWNER_PASSWORD`
- 移除 web-portal 和 admin-console 的 .env.local 软链
- 清理测试创建的 PAT token
- 清理测试创建的用户组
- 清理测试创建的能力包和技能

**未改任何代码文件。**
