---
name: "enterprise-image-build-fixes"
overview: "记录 2026-07-28 enterprise/web-portal 镜像构建过程中暴露的阻塞问题，以及随后联调时发现的管理员数据库鉴权密码哈希不一致问题、根因、修复点与验证结果。"
todos: []
isProject: false
---

# Enterprise 镜像构建问题修复记录

Planned-with: Trae
Scope: `enterprise/apps/web-portal` 镜像构建链路，兼顾通用 `apps/Dockerfile.next`，并补充记录 `web-portal` / `admin-console` 管理员登录数据库鉴权修复

---

## 1. 背景

在 `enterprise/` 目录执行以下构建命令时，`web-portal` 镜像构建连续暴露出多处阻塞问题：

```bash
export ENTERPRISE_IMAGE_TAG=2026.07.28-local
docker build \
  -f apps/Dockerfile.next \
  --platform linux/amd64 \
  --build-arg APP_NAME=web-portal \
  --build-arg APP_PACKAGE=@agenticx/app-web-portal \
  --build-arg APP_PORT=3000 \
  -t agenticx-registry.cn-shanghai.cr.aliyuncs.com/agenticx/enterprise-web-portal:${ENTERPRISE_IMAGE_TAG} \
  .
```

初始症状并不是单一故障，而是“修掉一个类型错误后继续暴露下一个 blocker”的串行问题链。最终问题覆盖了依赖可复现性、TypeScript 收窄、浏览器 Blob 类型兼容，以及 Next standalone 产物输出配置。

---

## 2. 问题链路与修复

### 2.1 Docker 依赖安装未锁定，容器内依赖版本漂移

**现象**

- `apps/Dockerfile.next` 在 `deps` 阶段只复制了 `package.json pnpm-workspace.yaml turbo.json tsconfig.base.json`
- 未复制 `pnpm-lock.yaml`
- `pnpm install` 未使用 `--frozen-lockfile`
- 构建日志里出现容器内 `next` 版本与锁文件不一致的情况，导致类型/构建行为不稳定

**根因**

Docker 构建环境没有严格按仓库锁文件安装依赖，导致容器中解析出的版本可能与本地或上一次构建不同。

**修复**

更新 `enterprise/apps/Dockerfile.next`：

- 复制 `pnpm-lock.yaml`
- 使用 `pnpm install --frozen-lockfile`

**涉及文件**

- `enterprise/apps/Dockerfile.next`

---

### 2.2 `video-probe.ts`：`stdout.toString("utf8")` 类型错误

**报错**

```ts
Type error: Expected 0 arguments, but got 1.
```

后续在一次尝试性修复后，又进一步暴露为：

```ts
Type error: Property 'toString' does not exist on type 'never'.
```

**根因**

`promisify(execFileCb)` 在当前类型上下文下把 `stdout` 推断为 `string`，因此：

- `stdout.toString("utf8")` 不成立
- 三元兼容分支里“非 string 分支”又被收窄成 `never`

**修复**

直接将 fallback 改为：

```ts
transcript = stdout;
```

**涉及文件**

- `enterprise/apps/web-portal/src/lib/video-probe.ts`

---

### 2.3 `MessageList.tsx`：`message.attachments` 可能为 `undefined`

**报错**

```ts
'message.attachments' is possibly 'undefined'
```

**根因**

前面已经计算了：

```ts
const userAttachments = isUser ? (message.attachments ?? []) : [];
```

但真正渲染时仍然直接调用了：

```ts
message.attachments.map(...)
```

导致空值保护失效。

**修复**

将渲染时的遍历改为：

```ts
userAttachments.map(...)
```

**涉及文件**

- `enterprise/features/chat/src/components/molecules/MessageList.tsx`

---

### 2.4 `deep-research-artifact-tree.ts`：目录草稿类型与最终目录节点混用

**报错**

```ts
Type '{ type: "dir"; ... children: ArtifactTreeNode[]; } | DirDraft' is not assignable to type 'DirDraft'
```

**根因**

树构建逻辑里混用了两类都带 `type: "dir"` 的对象：

1. 构建过程中的目录草稿 `DirDraft`
2. 最终渲染用的目录节点 `ArtifactTreeNode` 的 `dir` 分支

虽然二者都叫 `dir`，但：

- `DirDraft.children` 是 `Map`
- 最终节点的 `children` 是 `ArtifactTreeNode[]`

因此 TypeScript 无法仅凭 `type === "dir"` 完成安全收窄。

**修复**

- 单独抽出 `ArtifactFileNode = Extract<ArtifactTreeNode, { type: "file" }>`
- 将 `DirDraft.children` 收窄为 `Map<string, DirDraft | ArtifactFileNode>`
- 在构树时显式把 `next` 标注为 `DirDraft`，避免类型再次混入最终目录节点

**涉及文件**

- `enterprise/features/chat/src/components/molecules/deep-research-artifact-tree.ts`

---

### 2.5 `zip-store.ts`：`Uint8Array<ArrayBufferLike>` 不能直接作为 `BlobPart`

**报错**

```ts
Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'
```

**根因**

当前 TypeScript / DOM 类型定义对 `Blob` 构造函数的入参要求更严格。直接把 `Uint8Array<ArrayBufferLike>` 喂给 `new Blob([...])` 时，会因为底层 `buffer` 可能是 `SharedArrayBuffer` / `ArrayBufferLike` 而被拒绝。

**修复**

新增显式复制函数，把字节数组复制到标准 `ArrayBuffer` 支撑的 `Uint8Array<ArrayBuffer>` 后再传给 `Blob`：

```ts
function toBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
```

**涉及文件**

- `enterprise/features/chat/src/components/molecules/zip-store.ts`

---

### 2.6 `.next/standalone` 不存在，Runner 阶段 `COPY` 失败

**报错**

```bash
COPY --from=build /work/apps/web-portal/.next/standalone /app: not found
```

**根因**

`apps/Dockerfile.next` 的 runner 阶段明确依赖 Next 的 standalone 输出：

```dockerfile
COPY --from=build /work/apps/${APP_NAME}/.next/standalone /app
```

但 `web-portal` 的 `next.config.ts` 未启用：

```ts
output: "standalone"
```

因此 `next build` 不会生成 `.next/standalone`。

**修复**

为两个使用这份通用 Dockerfile 的 Next 应用都补齐：

```ts
output: "standalone"
```

**涉及文件**

- `enterprise/apps/web-portal/next.config.ts`
- `enterprise/apps/admin-console/next.config.ts`

### 2.7 管理员数据库鉴权启用后，历史 `users.password_hash` 未同步导致登录失败

**现象**

- `admin-console` 与 `web-portal` 在启用数据库鉴权后，管理员登录会直接校验数据库中的 `users.password_hash`
- 现网/本地历史管理员账号是通过手工 SQL 插入，库中的旧哈希未随着当前环境变量密码同步更新
- 最终表现为：即使输入的是当前配置的管理员密码，两个服务仍返回登录失败

**根因**

两个服务当前都已经切到数据库账号体系：

- `admin-console` 登录读取数据库用户并执行 `verifyPassword(input.password, user.passwordHash)`
- `web-portal` 账密登录通过共享 `AuthService.loginWithPassword()` 校验同一份 `user.passwordHash`

因此只要数据库里管理员账号的历史哈希仍是旧值，就会稳定复现登录失败。问题本质不是前端表单或 session，而是数据库中的管理员密码哈希与当前配置密码发生漂移。

**修复**

新增统一的管理员密码哈希对齐逻辑：

- 在 `iam-core` 中新增 `reconcileUserPasswordHashByEmail()`
- 当检测到“当前登录的是配置中的管理员账号，且输入密码等于当前配置密码”时：
  - 先读取数据库当前用户
  - 若哈希已匹配，则直接放行
  - 若哈希不匹配，则用当前密码重新生成哈希并回写数据库
  - 同时清零 `failedLoginCount`、清除 `lockedUntil`、恢复 `status=active`

随后在两个服务的登录入口接入：

- `admin-console`：在数据库鉴权前先执行一次管理员哈希对齐
- `web-portal`：在密码登录与桌面端密码登录前先执行同样的对齐逻辑

此外，已对当前本地数据库中的管理员账号执行一次实际修复，确认旧哈希已被更新为当前配置密码对应的新哈希。

**涉及文件**

- `enterprise/packages/iam-core/src/admin-password-reconcile.ts`
- `enterprise/packages/iam-core/src/index.ts`
- `enterprise/apps/admin-console/src/lib/admin-pg-auth.ts`
- `enterprise/apps/web-portal/src/lib/auth-runtime.ts`

---

### 2.8 `web-portal` 管理员登录成功后，JWT / Cookie 头过大触发代理层 502

**现象**

- 普通用户登录 `web-portal` 正常
- 管理员账号登录 `POST /api/auth/login` 时，浏览器收到 `502 Bad Gateway`
- 响应头显示错误来自外层 `openresty`，且前端一度会把 HTML 错页当 JSON 解析

**根因**

`web-portal` 原有 token 发放逻辑会把完整 `scopes` 写入 access / refresh 两枚 JWT。  
管理员账号由于角色较多，展开后的 scope 集合远大于普通用户，最终造成：

1. portal 返回的两枚 JWT 体积明显变大
2. `Set-Cookie` 响应头随之膨胀
3. 在经过外层 Nginx / OpenResty 代理时，命中响应头缓冲限制并被转成 502

更重要的是，`web-portal` 本身在读取 session 时已经具备“从数据库回填 live scopes”的能力，因此 JWT 中继续携带完整权限集合并不是必要条件。

**修复**

将 `web-portal` 的 portal JWT 改为仅携带精简身份 claims，不再把完整权限集合塞进 token：

- 保留 `userId / tenantId / deptId / email / sessionId`
- 将 `scopes` 固定写为空数组
- 权限判断继续依赖现有的 `getSessionFromCookies()` -> `hydrateFromDatabase()` 链路，从数据库读取当前 live scopes

同时，为避免再次绕回共享 `AuthService.loginWithPassword()` 生成“大 JWT”，将 `web-portal` 的密码登录改为：

- portal 自行校验密码哈希
- portal 自行维护失败次数与锁定逻辑
- portal 自行签发 compact access / refresh token

SSO 登录与 refresh token 续期也统一切换到同一套 compact token 逻辑，确保后续不会重新把全量 scopes 带回 JWT。

**涉及文件**

- `enterprise/apps/web-portal/src/lib/auth-runtime.ts`
- `enterprise/apps/web-portal/src/lib/portal-auth-token-context.ts`
- `enterprise/apps/web-portal/src/lib/portal-auth-token-context.test.ts`

### 2.9 `web-portal` completion 请求因缺少 `session_grants` 被 gateway 返回 403 Forbidden

**现象**

- `web-portal` 登录成功后，请求 `/api/chat/completions` 返回 `403 Forbidden`
- 排查发现当前登录用户本身拥有 `super_admin` 角色，聚合权限中已包含 `workspace:chat`
- 但当前登录 session 在 `session_grants` 表中没有对应记录
- portal 侧 `/api/auth/session` 读 session 时可以从数据库补齐 live scopes，但 completion 转发到 gateway 时仍会被判定缺少 `workspace:chat`

**根因**

在 2.8 的 compact JWT 修复之后，portal token 中不再携带完整 `scopes`，这是符合预期的。  
但 gateway 在鉴权时除了读取 JWT claims 外，还依赖 `session_grants` 为当前 session 补充工作台权限。

此前 `web-portal` 的登录与 refresh token 续期流程只会：

- 写入 `auth_refresh_sessions`
- 签发 compact access / refresh token

却没有同步为对应 `sessionId` 创建 `session_grants`。因此实际表现为：

1. portal 自己读取 session 没问题，因为它能从数据库回填用户 live scopes
2. gateway 看到的 JWT `scopes` 为空
3. `session_grants` 又没有补权记录
4. 最终 `/api/chat/completions` 被 gateway 拒绝，返回 403

**修复**

在 `web-portal` 的统一签发链路中补齐 session grant 同步逻辑：

- 登录成功后，在 `issueTokensForUser()` 中为当前 `sessionId` 创建 `session_grants`
- SSO 登录复用同一套签发逻辑，因此也自动获得 grant
- refresh token 续期时不再沿用旧 `sessionId`，而是轮换出新的 `sessionId`
- refresh 成功后，为新的 `sessionId` 再创建一条 `session_grants`
- grant scopes 固定包含：
  - `workspace:chat`
  - `workspace:read`
  - `workspace:manage`

同时增加失败保护：

- 如果 session grant 创建失败，则回滚刚写入的 refresh session
- 避免出现“登录成功但 gateway 仍然无法识别工作台权限”的半成功状态

**涉及文件**

- `enterprise/apps/web-portal/src/lib/auth-runtime.ts`
- `enterprise/apps/web-portal/src/lib/auth-runtime.test.ts`

### 2.10 测试环境 gateway 审计目录权限不足，导致对话接口返回 `audit write failed`

**现象**

- 在测试环境通过 `web-portal` 发起大模型对话时，前端直接收到：

```text
audit write failed
```

- 继续查看 `gateway-a` 容器日志后，出现明确报错：

```text
write audit event failed
mkdir /runtime/audit: permission denied
```

- 这说明失败点并不在模型调用本身，而是在 gateway 处理完请求后写审计事件时，无法创建审计目录。

**根因**

测试环境 compose 与 gateway 镜像的运行方式组合在一起，触发了一个典型的权限问题：

- `enterprise/deploy/config/policies.yaml` 将 gateway 审计目录配置为：

```yaml
audit_dir: /runtime/audit
```

- `enterprise/deploy/docker-compose/test.yml` 中，测试栈把命名卷 `gateway_runtime` 挂载到整个 `/runtime`
- gateway 镜像本身在 Dockerfile 中使用 `USER nonroot:nonroot`
- gateway 写审计时会先调用 `os.MkdirAll("/runtime/audit", 0700)`，首次创建目录时如果当前运行用户无权限写 `/runtime`，就会直接失败

因此，问题本质不是“PG 审计表写入失败”，也不是“上游模型返回异常”，而是 **gateway 在测试环境中没有权限初始化共享 runtime volume 下的审计目录**。

**修复**

考虑到这是测试环境 compose 的长期稳定性问题，采用了测试栈内直接放宽 gateway 运行用户的方案：

- 在 `enterprise/deploy/docker-compose/test.yml` 中为 `gateway-a` 增加：

```yaml
user: "0:0"
```

- 在 `enterprise/deploy/docker-compose/gateway_test.yml` 中同步为 `gateway-a` / `gateway-b` 都增加：

```yaml
user: "0:0"
```

这样测试环境下 gateway 首次启动时即可自行创建：

- `/runtime/audit`
- `/runtime/admin`
- `/runtime/gateway`

从而避免每次手工进入宿主机对 Docker volume 执行 `mkdir/chown`。

**影响范围**

- 该修复仅针对测试环境 compose
- 不改变 gateway 审计写入逻辑本身
- 不影响生产环境镜像默认仍以 `nonroot` 身份运行的设计
- 若后续希望恢复测试环境 nonroot 运行，则需要额外补一个 init 容器或 volume 权限初始化步骤

**涉及文件**

- `enterprise/deploy/docker-compose/test.yml`
- `enterprise/deploy/docker-compose/gateway_test.yml`

### 2.11 测试环境未同步 `web-portal` 新增 MySQL 表结构，导致相关能力异常

**现象**

- `web-portal` 在本地运行正常，但部署到测试环境后，依赖数据库持久化的部分能力出现异常
- 排查测试环境 MySQL 表结构时发现，以下两张 `web-portal` 运行时依赖的表并不存在：
  - `enterprise_runtime_web_search`
  - `enterprise_chat_artifacts`
- 继续对照仓库中的 MySQL 迁移链后确认，测试环境数据库没有及时应用 `web-portal` 最近新增的 schema 变更

**根因**

当前 `web-portal` 的 MySQL 表结构由 `enterprise/packages/db-schema/drizzle-mysql/` 统一维护，本地之所以正常，是因为本地库已经包含较新的迁移结果；而测试环境在部署服务前没有先执行对应的数据库迁移，导致“应用代码已更新、数据库结构仍停留在旧版本”。

这次直接缺失的两张表分别对应以下迁移：

- `0003_enterprise_runtime_web_search.sql`
- `0007_enterprise_chat_artifacts.sql`

同时，`enterprise_runtime_web_search` 的最终线上结构还叠加依赖后续增量迁移：

- `0004_web_search_max_results_default.sql`
- `0005_enterprise_runtime_deep_research.sql`
- `0006_deep_research_enabled_default_true.sql`

因此问题本质不是 `web-portal` 代码逻辑错误，而是 **测试环境数据库表结构版本落后于当前应用版本**。

**处置**

- 优先方案：在测试环境对目标 MySQL 库执行正式迁移

```bash
cd enterprise
export DATABASE_DIALECT=mysql
export DATABASE_URL=mysql://...
pnpm --filter @agenticx/db-schema db:migrate
```

- 若当前联调窗口内无法直接跑完整迁移，也可以先按仓库当前 schema 手工补建缺失表，再补跑正式迁移记录对齐
- 更新表结构后，应至少复查以下对象是否已与当前代码预期一致：
  - `enterprise_runtime_web_search`
  - `enterprise_chat_artifacts`
  - `chat_sessions.pinned_at`

**涉及文件**

- `enterprise/packages/db-schema/drizzle-mysql/0003_enterprise_runtime_web_search.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0004_web_search_max_results_default.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0005_enterprise_runtime_deep_research.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0006_deep_research_enabled_default_true.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0007_enterprise_chat_artifacts.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0008_chat_sessions_pinned_at.sql`

---

## 3. 最终验证结果

在完成上述修复后，重新执行同一条 `web-portal` 镜像构建命令，结果如下：

1. `pnpm install --frozen-lockfile` 正常完成
2. `pnpm --filter "@agenticx/app-web-portal" build` 正常完成
3. `next build` 成功产出 `.next/standalone`
4. runner 阶段三条 `COPY --from=build` 均成功
5. 镜像成功导出并打上 tag

最终成功产物：

```bash
agenticx-registry.cn-shanghai.cr.aliyuncs.com/agenticx/enterprise-web-portal:2026.07.28-local
```

在补充完成管理员数据库鉴权修复后，又额外完成了以下验证：

1. 确认本地 `.env.local` 中管理员密码与数据库 `users.password_hash` 之前确实不匹配
2. 运行新增的 `iam-core` 对齐测试，验证“存在旧哈希时可自动重建并解锁账号”
3. 运行 `admin-console` 定向测试，验证登录前会先触发管理员哈希对齐
4. 实际对本地数据库中的 `admin@agenticx.local` 执行一次哈希修复
5. 再次调用 `admin-console` 与 `web-portal` 的登录逻辑，两个服务均返回成功

在补充完成 `web-portal` 的 compact JWT 修复后，又额外完成了以下验证：

1. 确认 `web-portal` 的密码登录、SSO 登录、refresh token 续期都统一走 compact token 发放逻辑
2. 确认 portal token context 仅保留身份字段，`scopes` 固定为空数组
3. 运行定向测试，验证 compact token context 的结构符合预期
4. 复查 `session.ts`，确认现有 `hydrateFromDatabase()` 仍会在读 session 时从数据库补齐 live scopes，因此权限判断链路不受影响

在补充完成 `session_grants` 同步修复后，又额外完成了以下验证：

1. 确认密码登录成功后会为当前 `sessionId` 创建包含 `workspace:chat / workspace:read / workspace:manage` 的 grant
2. 确认 SSO 登录同样复用统一签发链路，因此也会同步创建 grant
3. 确认 refresh token 续期时会轮换出新的 `sessionId`，并为新 session 创建 grant
4. 确认旧 refresh session 在轮换后会被删除，旧 refresh token 不再可继续续期
5. 运行 `pnpm test -- auth-runtime.test.ts`，定向验证登录创建 grant 与 refresh 轮换 grant 两条路径均通过

在补充完成测试环境 gateway 审计目录权限修复后，又额外完成了以下验证：

1. 复查测试环境 gateway 日志，确认报错根因为：

```text
mkdir /runtime/audit: permission denied
```

2. 复查 `enterprise/deploy/config/policies.yaml`，确认审计目录配置确为 `/runtime/audit`
3. 复查测试环境 compose，确认 `/runtime` 使用共享 named volume，且原有 gateway 镜像默认以 `nonroot` 用户运行
4. 将测试环境 compose 中的 gateway 服务切换为 `user: "0:0"` 后，确认 compose 渲染结果中该设置已生效
5. 由此将该问题沉淀为测试环境的长期方案，避免后续联调时再次出现同样的 `audit write failed`

---

## 4. 当前仍存在但未阻断构建的问题

以下内容在本次构建中仍然出现，但未阻断镜像构建：

### 4.1 ESLint warning

- `i18next/no-literal-string`
- `The Next.js plugin was not detected in your ESLint configuration`

这些是 warning，不影响镜像产出，但后续建议单独整理：

- 国际化字面量豁免边界
- `eslint.config.mjs` 与 Next 官方 flat config 的对齐方式

### 4.2 共享 Dockerfile 的一致性风险

当前 `apps/Dockerfile.next` 是通用 Dockerfile，因此凡是走这套 runner 复制逻辑的 Next app，都应保持：

```ts
output: "standalone"
```

否则切换到其他 app 构建时还会复现同类问题。

### 4.3 `web-portal` 保存联网搜索 API Key 时缺少加密密钥

**现象**

- 在 `web-portal` 设置页为联网搜索服务商（如 Bocha / Tavily）填写并保存 API Key 时，接口返回：

```text
保存联网搜索配置失败：AGX_PROVIDER_SECRET_KEY is required in production to encrypt model provider API keys.
```

- 前端表现为“联网搜索配置保存失败”，无法将搜索服务商密钥持久化到数据库。

**根因**

`web-portal` 的联网搜索配置持久化逻辑与模型 Provider 共用同一套 API Key 加解密实现：

- `src/lib/web-search/tenant-config.ts` 在保存 `apiKey` 时会调用 `encryptProviderApiKey(nextKey)`
- 该加密函数位于 `packages/iam-core/src/provider-api-key-crypto.ts`
- 当 `NODE_ENV=production` 且环境中未注入 `AGX_PROVIDER_SECRET_KEY` 时，只要待保存的 key 非空，就会直接抛错，拒绝写入数据库

因此，这一报错并不表示“联网搜索功能本身不可用”，而是表示“联网搜索配置中的密钥无法在生产模式下完成加密入库”。

**影响**

- DuckDuckGo 这类免密钥 provider 仍可继续使用
- 需要保存 API Key 的 provider（如 Bocha / Tavily）无法在 `web-portal` 中完成配置
- 即使只是修改联网搜索的其他设置，只要当前保存链路里带上了非空 `apiKey`，仍可能再次触发同样的加密报错

**处置建议**

- 为运行 `web-portal` 的进程补齐同一个 `AGX_PROVIDER_SECRET_KEY`
- 该变量应作为稳定环境变量注入，而不是临时在单次 shell 中设置
- 若 gateway / admin-console 也需要读取或复用同一批加密密文，则应保持使用同一份密钥材料，避免后续出现“可写不可读”或“旧密文无法解密”的问题

**涉及文件**

- `enterprise/apps/web-portal/src/lib/web-search/tenant-config.ts`
- `enterprise/packages/iam-core/src/provider-api-key-crypto.ts`

---

## 5. 本次修复涉及文件清单

- `enterprise/apps/Dockerfile.next`
- `enterprise/apps/web-portal/src/lib/video-probe.ts`
- `enterprise/features/chat/src/components/molecules/MessageList.tsx`
- `enterprise/features/chat/src/components/molecules/deep-research-artifact-tree.ts`
- `enterprise/features/chat/src/components/molecules/zip-store.ts`
- `enterprise/apps/web-portal/next.config.ts`
- `enterprise/apps/admin-console/next.config.ts`
- `enterprise/packages/iam-core/src/admin-password-reconcile.ts`
- `enterprise/packages/iam-core/src/index.ts`
- `enterprise/apps/admin-console/src/lib/admin-pg-auth.ts`
- `enterprise/apps/web-portal/src/lib/auth-runtime.ts`
- `enterprise/apps/web-portal/src/lib/auth-runtime.test.ts`
- `enterprise/apps/web-portal/src/lib/portal-auth-token-context.ts`
- `enterprise/apps/web-portal/src/lib/portal-auth-token-context.test.ts`
- `enterprise/deploy/docker-compose/test.yml`
- `enterprise/deploy/docker-compose/gateway_test.yml`

---

## 6. 建议的后续动作

1. 用同一套参数验证 `admin-console` 镜像也能成功构建
2. 视情况为 `apps/Dockerfile.next` 补一条注释，说明其依赖 Next standalone 产物
3. 单独开一个小任务清理 `web-portal` 的 ESLint warning
4. 在 CI 中加入一次 `docker build -f apps/Dockerfile.next ...`，避免类似问题只在本地构建时暴露
5. 补一条管理员账号运维约束：凡是手工插入或重置 `users` 表管理员记录时，必须同步更新与当前配置密码一致的 bcrypt 哈希，避免后续数据库鉴权再次漂移
6. 在测试环境重新部署 `web-portal` 并重新登录一次，确认新的 compact portal token 已替换旧 cookie
7. 在测试环境重新部署 `web-portal` 后，重新登录并确认 `session_grants` 中已出现当前 session 的工作台授权记录，再验证 `/api/chat/completions` 不再返回 403
8. 若管理员登录仍经过外层 `openresty` 返回 502，再继续排查外层代理对请求头 / 响应头的 buffer 配置，以及 `admin_console_session` 跨应用共享带来的额外头部体积
9. 为 `web-portal` 的部署环境补齐 `AGX_PROVIDER_SECRET_KEY`，然后重新验证联网搜索 provider API Key 的保存、读取与实际检索链路
