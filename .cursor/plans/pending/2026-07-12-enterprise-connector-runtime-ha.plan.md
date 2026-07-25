# OpenConnector PostgreSQL 高可用 Runtime

Planned-with: gpt-5.6-sol-medium
Suggested-Impl-Model: gpt-5.6-sol-medium
Status: implementation-ready
Parent-Plan: `.cursor/plans/2026-07-12-enterprise-connector-gateway.plan.md`
Depends-On: `.cursor/plans/2026-07-12-enterprise-connector-gateway-poc.plan.md` G2

## 目标

以固定上游 commit + 仓库内 overlay 构建 OpenConnector 内部镜像，将 SQLite runtime state 替换为 PostgreSQL，实现至少双副本、OAuth callback 任意副本处理、token refresh 并发安全、凭证加密轮换和受限 internal façade。

这是生产高可用硬门禁；PoC 单副本不得替代本计划。

## 上游边界

固定：

```text
repository: https://github.com/oomol-lab/open-connector
commit: 62796b0d9390df49ed7644692ed75ba576bac9e9
```

利用上游：

- `RuntimeDatabase`
- `IConnectionStore`
- `IOAuthClientConfigStore`
- `IOAuthStateStore`
- `IRuntimeTokenStore`
- `IRunLogStore`
- provider catalog/OAuth/Action executor

必须 overlay 的缺口：

- PostgreSQL Store；
- refresh get→refresh→CAS set；
- OAuth denial/error 与 browser nonce；
- keyring codec/AAD；
- run log 正文丢弃；
- Enterprise internal token/受限 façade；
- exact connection lookup/delete。

不修改 provider executor；不建设通用 plugin API。

## 安全与 HA 合同

### Storage

- `open_connector_*` 独立表前缀。
- OAuth state 使用 `DELETE ... RETURNING` 单次消费。
- connection 含 `version`；Store 提供 `compareAndSet(expectedVersion)`。
- refresh 使用 Redis 30 秒租约锁，并以 PG CAS 作最终一致性保护。
- PG 是事实源；Redis 不保存不可恢复 credential。

### Encryption

- ciphertext envelope：`algorithm`, `kid`, `iv`, `ciphertext`, `tag`。
- AAD：`service|alias|record_id|credential_type|key_version`。
- primary + old keyring；新写只用 primary。
- 轮换：加入新 primary → 后台重加密 → 验证完成 → 移除 old key。
- 缺少历史 `kid` 时 readiness 失败，不静默丢 credential。

### OAuth browser binding

- Connector Gateway 生成 browser nonce，仅保存 hash 到 authorization/start 请求。
- Runtime OAuth state 保存 authorization id + browser nonce hash。
- 外部 callback 必须携带同一 HttpOnly cookie；不匹配时不换 token、不落 credential。
- 标准 `error/error_description` 映射稳定错误。

### Internal API

- `OOMOL_CONNECT_ENTERPRISE_INTERNAL_TOKEN` 与 Admin Token 分离。
- Gateway 只可访问：
  - OAuth start
  - exact lookup
  - exact delete
  - Action execute
- 完整 Admin API 只允许 provider bootstrap job。
- 原生 `/v1`、`/mcp`、`/api` 不对公网。

### Run logs

PG `runLogStore.add()` 只保存 action id、status、latency、input/output hash 与白名单错误码。丢弃上游 `inputSummary`、原始 error detail、邮件/文档正文和 Action input/output。

## 文件

### Overlay build

- Create: `enterprise/deploy/connector-gateway/runtime/Dockerfile`
- Create: `enterprise/deploy/connector-gateway/runtime/package.overlay.json`
- Create: `enterprise/deploy/connector-gateway/runtime/package-lock.overlay.json`
- Create: `enterprise/deploy/connector-gateway/runtime/src/postgres-runtime-store.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/src/enterprise-server.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/src/redis-refresh-lock.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/src/internal-connection-route.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/src/keyring-secret-codec.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/patches/connection-store-cas.patch`
- Create: `enterprise/deploy/connector-gateway/runtime/patches/connection-service-refresh-lock.patch`
- Create: `enterprise/deploy/connector-gateway/runtime/patches/oauth-callback-errors.patch`
- Create: `enterprise/deploy/connector-gateway/runtime/patches/oauth-browser-binding.patch`
- Create: `enterprise/deploy/connector-gateway/runtime/patches/run-log-redaction.patch`
- Create: `enterprise/deploy/connector-gateway/runtime/patches/internal-auth.patch`
- Create: `enterprise/deploy/connector-gateway/runtime/migrations/0001_open_connector_pg.sql`
- Create: `enterprise/scripts/build-connector-runtime.sh`
- Create: `enterprise/deploy/connector-gateway/open-connector.lock.json`
- Create: `enterprise/deploy/connector-gateway/NOTICE.md`

### Tests

- Create: `enterprise/deploy/connector-gateway/runtime/tests/postgres-runtime-store.test.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/tests/oauth-state-concurrency.test.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/tests/token-refresh-race.test.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/tests/keyring-rotation.test.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/tests/oauth-browser-binding.test.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/tests/run-log-redaction.test.ts`
- Create: `enterprise/deploy/connector-gateway/runtime/tests/internal-auth.test.ts`

### Deployment

- Create: `enterprise/deploy/connector-gateway/deployment.yaml`
- Create: `enterprise/deploy/connector-gateway/service.yaml`
- Create: `enterprise/deploy/connector-gateway/runtime-deployment.yaml`
- Create: `enterprise/deploy/connector-gateway/runtime-service.yaml`
- Create: `enterprise/deploy/connector-gateway/pdb.yaml`
- Create: `enterprise/deploy/connector-gateway/network-policy.yaml`
- Create: `enterprise/deploy/connector-gateway/provider-bootstrap-job.yaml`
- Create: `enterprise/deploy/connector-gateway/values.example.yaml`
- Create: `enterprise/deploy/connector-gateway/README.md`
- Modify: `enterprise/deploy/docker-compose/prod.yml`
- Modify: `enterprise/deploy/nginx/gateway.conf`
- Modify: `enterprise/deploy/README.md`
- Modify: `enterprise/docs/apps/README.md`
- Create: `enterprise/docs/observability/connector-gateway.md`

## 实施单元

### H1. 可复现 overlay 构建

- 下载 lock 文件指定源码归档并校验 SHA-256。
- 应用 overlay 和同步 `package-lock.overlay.json`。
- `pg` 与 Redis client 版本/完整性哈希必须固定。
- 只运行 `npm ci`；禁止运行浮动安装。
- 输出 SBOM，保留 LICENSE/NOTICE。

### H2. PostgreSQL Store

完整实现五个 Store。对每个 Store 跑与 SQLite/D1 等价 contract tests：

- connection get/set/delete/list/CAS；
- OAuth config CRUD；
- OAuth state set/take once；
- runtime token hash；
- bounded/redacted run log。

### H3. Refresh CAS 与 keyring

- Redis 锁覆盖 get→refresh→CAS set。
- CAS 失败读取新 credential，不用旧 token 覆盖。
- keyring 轮换可在线读旧写新。
- AAD 置换到另一 service/alias/record 时解密失败。

### H4. OAuth callback 与 internal façade

- callback 解析 code/state 与 error/error_description。
- browser nonce 不匹配立即拒绝。
- exact lookup/delete 不允许 list-all。
- Enterprise internal token 只能调用白名单 route。
- Admin Token 不进入 Connector Gateway deployment。

### H5. 双副本部署

- Gateway/Runtime 均 `replicas: 2`。
- PDB 保证滚动至少一副本。
- NetworkPolicy：
  - 公网只到 Gateway 公共前缀和 Runtime exact callback；
  - Gateway service account → Runtime internal façade；
  - bootstrap job service account → Runtime Admin API；
  - 其它 Pod 拒绝。
- Nginx 将外部 `/connectors/runtime/oauth/callback` 剥离前缀重写为 Runtime `/oauth/callback`，保留 query 与 browser nonce cookie。

## 测试场景

1. 两 Runtime 并发 take 同 OAuth state，只有一个成功。
2. 两副本并发刷新同 connection，最终只保留最新 token/version。
3. Redis 锁超时/丢失时 PG CAS 仍阻止旧 token 覆盖。
4. callback 被另一浏览器打开，因 nonce 不匹配不落 credential。
5. provider 拒绝授权得到稳定错误，不统一误报缺 code。
6. key rotation 期间旧密文可读、新写使用新 kid；移除必要 old key 后 readiness 失败。
7. `body/content/text` input 与 provider 原始错误不进入 run log。
8. Gateway internal token 访问 Admin route 返回 403；bootstrap Admin Token 不下发 Gateway。
9. 公网除 exact callback 外无法访问 Runtime 其它 path。
10. 两副本滚动重启时 OAuth state、connection、refresh 不丢失。

## 验收

- AC-1：固定 commit + lockfile + SBOM 可重复构建相同镜像。
- AC-2：五个 Store contract tests 通过。
- AC-3：两副本 OAuth/execute/refresh/重启恢复通过。
- AC-4：callback rewrite 与 browser nonce E2E 通过。
- AC-5：key rotation 与 run-log redaction 通过。
- AC-6：PDB/NetworkPolicy/Secret 边界符合合同。
- AC-7：禁用 transit-file Action 与 provider proxy。

## 回滚

- Runtime 镜像按 digest 回滚；PG migration 首版只新增表，不自动 drop。
- credential keyring 保留旧 key 至回滚窗口结束。
- 关闭 `CONNECTOR_GATEWAY_ENABLED` 后 Runtime 不接收新执行，但保留数据。
- 不允许回滚到 SQLite 并宣称无损 HA；仅可作为明确 non-production 故障诊断。

## Definition of Done

1. G2 已通过。
2. H1–H5 与全部 AC 有证据。
3. 双副本故障/滚动测试通过，才允许控制面生产 flag。
4. Plan 与代码提交包含本 Plan-Id/Plan-File trailer。

## 追溯

- Plan-Id: `2026-07-12-enterprise-connector-runtime-ha`
- Plan-File: `.cursor/plans/2026-07-12-enterprise-connector-runtime-ha.plan.md`
