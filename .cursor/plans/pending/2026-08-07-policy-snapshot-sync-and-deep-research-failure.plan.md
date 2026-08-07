# 策略快照同步与深度调研合规失败语义修复

Planned-with: GPT-5

Suggested-Impl-Model: GPT-5（跨 Go Gateway、Next.js 管理后台、深度调研流式状态机与部署配置，需统一收口版本一致性和失败语义）

## 背景与根因证据

测试环境中，管理员已在策略中心停用规则，但深度调研分节写作仍连续收到 Gateway `90001`，最终报告把原始错误 JSON 写进正文并错误宣告“完成”。证据链如下：

1. `enterprise/features/policy/src/snapshot/writer.ts::replaceTenantSnapshot` 已将发布快照写入 `enterprise_runtime_policy_snapshots`（MySQL/PostgreSQL），不再把新快照写回旧的 `policy-snapshot.json`。
2. `enterprise/deploy/docker-compose/test.yml` 与 `prod.yml` 的 Gateway 仍只设置 `GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`。因此 admin 发布更新数据库，而 Gateway 持续读取旧文件。
3. `enterprise/apps/gateway/internal/server/server.go::New` 明确让 `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` 优先于旧文件，并已有 Bearer 内部鉴权抓取逻辑；部署配置漏接了该入口。
4. `enterprise/apps/admin-console/src/app/policy/page.tsx::triggerPublish` 轮询的是不存在的相对路径 `/healthz`，而且即便改成普通健康检查，也不能证明 Gateway 已加载本次 `publishId/version`，所以“同步状态未知/已同步”没有可信闭环。
5. `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts::streamSectionInto` 对非 2xx 响应直接把前 200 字原始 body 拼为“本节撰写失败”，之后仍生成 artifact 和完成事件。策略拒绝应终止本次 run，且不得把内部 JSON/hits 写进客户报告。
6. `enterprise/packages/policy-engine/engine.go::applyHit` 仅在 `action=block` 时设置 `Blocked=true`；`redact` 只替换文本。因此错误响应中出现 redact hit 不等于“redact 被错误当作 block”，完整 hits 中至少还有 block 命中。本计划不改变策略动作语义。

## In scope

- 让 Gateway 在单机、测试覆盖层和生产 compose 中从 admin-console 的数据库快照 API 加载策略，并保留旧文件为未配置远端 URL 时的兼容回退。
- Gateway 记录“实际已构建进当前内存策略引擎”的租户 `publishId/version/publishedAt`，提供带内部 Bearer 鉴权的只读状态接口。
- admin-console 通过代理接口读取 Gateway 活跃版本；页面首次加载和发布后均以 `publishId/version` 精确判断 synced/pending/unknown。
- 深度调研识别 Gateway 9xxxx 策略错误，立即结束 run 为 failed，显示可读合规提示，不生成伪完整报告，不泄露原始错误 JSON。
- 覆盖 Go、Next route、页面纯判断和深度调研回归测试。

## Out of scope / no-scope-creep

- 不修改策略规则本身、PII 正则、规则启停/发布产品语义。
- 不自动停用任何客户规则，不改数据库历史快照，不执行远端运维变更。
- 不把浏览器断开映射为 run abort，不调整深度调研检索预算、并发或引用算法。
- 不修改 Desktop。

## 子规划 A：部署快照来源接线

Suggested-Impl-Model: GPT-5

### 精确落点

- `enterprise/deploy/docker-compose/test.yml`：`gateway-a.environment`，在旧 `GATEWAY_POLICY_SNAPSHOT_FILE` 前增加 `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL`，默认 `http://admin-console:3001/api/internal/policy-snapshot`。
- `enterprise/deploy/docker-compose/prod.yml`：`gateway-a`、`gateway-b` 同样增加远端 URL。
- `enterprise/deploy/docker-compose/gateway_test.yml`：两个 Gateway 服务要求显式传入 `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL`，避免多机覆盖层静默退回旧文件。
- `enterprise/.env.local.example` 与相关部署文档：保留并说明 internal token 必须与 admin-console 一致。
- 同步到 `hc-0730` 时，该分支专有的 `enterprise/deploy/docker-compose/gateway.yml` 和 `load-runtime-env.sh` 使用测试 admin 地址 `http://192.168.16.70:3001/api/internal/policy-snapshot`。

### Before / after

```yaml
# before: admin 写 DB，Gateway 读旧文件
GATEWAY_POLICY_SNAPSHOT_FILE: /runtime/admin/policy-snapshot.json

# after: 远端 DB 快照优先，旧文件仅回退
GATEWAY_REMOTE_POLICY_SNAPSHOT_URL: ${GATEWAY_REMOTE_POLICY_SNAPSHOT_URL:-http://admin-console:3001/api/internal/policy-snapshot}
GATEWAY_POLICY_SNAPSHOT_FILE: /runtime/admin/policy-snapshot.json
```

### AC

- `docker compose config` 展开后 Gateway 同时拿到 remote URL 与 internal token。
- Gateway 远端 URL 有效时按 body hash 热加载；远端变量缺失时既有文件/manifest 回退测试不退化。

## 子规划 B：Gateway 活跃快照状态

Suggested-Impl-Model: GPT-5

### 精确落点

- `enterprise/apps/gateway/internal/server/server.go`
  - 扩展 `tenantPolicySnapshot` 解析 `publishId`、`publishedAt`。
  - 新增不可变 `policySnapshotRuntimeStatus`，由 `snapshotManifestsFromRaw` 从同一份成功构建 engine 的 body 派生。
  - 扩展 `loadPolicySnapshot/buildPolicyEngine` 返回 runtime status；初始化和 `reloadPolicyIfNeeded` 在持有 `policyMu` 时与 engine/hash 原子替换。
  - `Router` 注册 `GET /internal/policy-status`。
- `enterprise/apps/gateway/internal/server/health.go`
  - 新增 `handleInternalPolicyStatus`；复用 `gatewayInternalAuthorized`，先触发受 5 秒节流保护的 reload，再只返回请求 tenant 的活跃 `publishId/version/publishedAt`、source、checkedAt。

### Response contract

```json
{
  "code": "00000",
  "data": {
    "source": "remote",
    "checkedAt": "2026-08-07T12:00:00Z",
    "tenant": {
      "tenantId": "...",
      "publishId": "...",
      "version": 2,
      "publishedAt": "..."
    }
  }
}
```

不得返回规则正文、命中内容或全部租户列表。

### AC

- `enterprise/apps/gateway/internal/server/policy_snapshot_test.go` 断言从 snapshot body 解析 version/publishId。
- `enterprise/apps/gateway/internal/server/health_test.go` 断言未授权 401、授权后只返回所请求租户的活跃版本。
- `go test ./internal/server` 通过。

## 子规划 C：admin-console 真实同步判断

Suggested-Impl-Model: GPT-5

### 精确落点

- `enterprise/apps/admin-console/src/lib/gateway-ops-store.ts`：新增带 `GATEWAY_INTERNAL_TOKEN` 的 `fetchGatewayPolicyStatus(tenantId)`。
- `enterprise/apps/admin-console/src/app/api/gateway/policy-status/route.ts`：要求 `policy:read`，tenantId 只取 admin session，不接受浏览器传入；代理 Gateway 内部状态并规范化 502。
- `enterprise/apps/admin-console/src/app/policy/policy-sync.ts`：新增纯函数 `matchesPublishedSnapshot(latestPublish, gatewayTenant)`，要求 `publishId` 和 `version` 均相等。
- `enterprise/apps/admin-console/src/app/policy/page.tsx`
  - 删除 `/healthz` 轮询。
  - 首次 load 后读取状态；已发布且版本一致为 `synced`，Gateway 可达但版本旧为 `pending`，请求失败/元数据缺失为 `unknown`。
  - `triggerPublish` 从发布响应读取 `event`，最多轮询覆盖 Gateway 5 秒 reload interval；只在精确匹配后显示“Gateway 已同步”。

### AC

- 新增 route 测试：session tenant 被传给 Gateway store；Gateway 不可达返回 502。
- 新增纯函数测试：同 version 不同 publishId 不得视为同步；完全一致才同步。
- 页面代码不再出现 `fetch("/healthz")`。

## 子规划 D：深度调研策略失败语义

Suggested-Impl-Model: GPT-5

### 精确落点

- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`
  - 新增 Gateway 非 2xx 解析 helper 与 `DeepResearchPolicyError`；使用 `@agenticx/core-api` 的 `isPolicyErrorCode/toComplianceMessage`。
  - `callGatewayJson` 遇 9xxxx 必须抛出，不再静默返回空字符串。
  - `streamSectionInto` 遇 9xxxx 必须抛出，不再将原始 body append 到 `reportContentParts`。
  - `runOneLane` 不得吞掉 `DeepResearchPolicyError`。
  - 外层 catch 对该错误发送单次客户可读合规提示、phase=done/status=failed，并 `persistFinish("failed")`；不执行后续章节、artifact finalization 或 completed summary。
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.test.ts`：构造首节返回 403/90001 的三节大纲，断言只请求一次 section、run failed、无 final-report artifact、输出不含 raw JSON/hits/“本节撰写失败”/完成庆祝文案。

### AC

- 90001/90002 不进入报告正文，不生成伪完整 artifact，不标记 completed。
- 普通临时非 2xx 的既有降级行为不扩大改变。
- `pnpm --dir enterprise/apps/web-portal exec vitest run src/lib/deep-research/orchestrator.test.ts` 通过。

## 验证矩阵

1. `go test ./internal/server`（cwd: `enterprise/apps/gateway`）。
2. admin-console 新增 route/纯函数测试与 `typecheck`。
3. web-portal orchestrator 定向测试与 `typecheck`；若全量 typecheck 命中仓库既有测试类型错误，记录基线并以改动文件 lint + 定向测试作为本修复证据。
4. `git diff --check`。
5. 同步到 `hc-0730` 后再次运行上述定向测试，并确认只包含本计划范围文件。

