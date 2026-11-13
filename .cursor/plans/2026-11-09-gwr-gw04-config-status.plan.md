# GW-04 配置生效状态统一上报

Planned-with: grok-4.7-high
Suggested-Impl-Model: grok-4.7-high

**Goal:** 给网关 4 个核心配置域一个统一的生效状态登记点，并在拉取失败、解析失败、远端 404 时保留最后一次成功应用的快照。新增 `GET /internal/config-status` 与两个 Prometheus 指标。

**Plan-Id:** `2026-11-09-gwr-gw04-config-status`

**依据：** 主规划 `.cursor/plans/2026-11-09-enterprise-gateway-registry-master.plan.md` 第 6 节 GW-04、第 8 节 D-3。行号在本 worktree `gwr/gw04` 上于 2026-11-09 重新核对。

---

## 根因与证据

### A-06 配置源分散，没有统一的生效状态。

- 网关读取约 13 个 `GATEWAY_REMOTE_*_URL` 或 `*_FILE` 配置源：providers、channels、policy snapshot、mcp servers、quota、budget、pricing、cache、compliance、PAT 吊销、session grants 等。
- 每个源有自己的轮询器，失败语义各不相同。例如 `enterprise/apps/gateway/internal/runtimeconfig/runtimeconfig.go` 第 124–160 行：解析失败保留旧快照，但远端返回 404 时会**清空**快照（第 133–135 行）。
- 只有策略有 `/internal/policy-status`（`server.go` 第 665 行）。
- 管理台的拉取路由在 `enterprise/apps/admin-console/src/app/api/internal/*/route.ts`，用 `isGatewayInternalAuthorized` 校验 `GATEWAY_INTERNAL_TOKEN`；网关一侧见 `enterprise/apps/gateway/internal/gatewayinternal/http.go` 第 30–42 行。
- 后果：长期反复出现的「规则已发布，前台还不拦」没有办法从产品内判断是哪个副本、哪个源出了问题。

### U-03 配置下发确认。

`crates/xds/src/client.rs` 约 181–261 和 686–746 行：Delta ADS 按资源应用，合法的部分生效，非法的部分 NACK，被拒绝的资源名不进入 `known_resources`。控制面能知道每个数据面「生效了什么、拒绝了什么」。

### D-3（已决策，不得改语义）

远端返回 404 时，4 个核心域一律保留最后可用快照，登记为一次失败，`LastError` 写 `"remote 404, keeping last known good"`。进程启动后从未成功加载过时，保持现有的空快照行为。策略域的 404 原本会回落到内置规则包，此时改为保留上一次已发布快照；从未加载过时仍回落内置规则包。

---

## 重新核对后的精确落点

「保留旧快照」指内存里正在对外服务的那份数据没有被这次失败覆盖。`hasGood` 是各 loader 上的 `atomic.Bool`，只在**成功解析并写入**（channels 含「空结果被 providers 合成出非空渠道」）之后置 true。从未成功时为 false。

### 1. providers：`internal/runtimeconfig/runtimeconfig.go` `Loader.reload()` 第 124–161 行

| 情况 | 现状（2026-11-09） | 改成 |
| --- | --- | --- |
| 拉取失败：`HTTPGet` 返回 err（第 130–131 行）；本地 `ReadFile` 非 `os.ErrNotExist`（第 147 行）；HTTP 状态非 2xx 且非 404（第 137–138 行） | 返回 err，不执行 `current.Store`，**保留**旧快照 | 行为不变，额外 `ReportFailure("providers", path, err)` |
| 解析失败：`json.Unmarshal` 失败（第 153–154 行） | 返回 err，不 `Store`，**保留**旧快照 | 行为不变，额外 `ReportFailure` |
| 远端 404（第 133–135 行） | `current.Store(&snapshot{})` **清空**，返回 nil（被 `Start` 当成成功） | `hasGood` 时不 `Store`，返回 `configstatus.ErrRemote404Keep`，`ReportFailure`，`LastError` 为 `remote 404, keeping last known good`。`hasGood==false` 时仍清空并返回 nil，不登记失败 |
| 本地文件不存在（第 143–145 行） | 清空并返回 nil | **不改**。不是 D-3 的远端 404 |

### 2. channels：`internal/channel/registry.go` `Registry.reload()` 第 131–140 行，`loadRemoteOrFile()` 第 143–183 行

| 情况 | 现状 | 改成 |
| --- | --- | --- |
| 拉取失败：`HTTPGet` err（第 149–150 行）；非 2xx 非 404（第 155–156 行）；本地 `ReadFile` 非 NotExist（第 164 行） | `reload` 在 err 时直接 return，不 `Store`，**保留** | 不变，额外 `ReportFailure("channels", path, err)` |
| 解析失败（第 168–176 行，两种 JSON 形状都失败） | 返回 err，不 `Store`，**保留** | 不变，额外 `ReportFailure` |
| 远端 404（第 152–153 行） | 返回空切片 + nil。`reload` 在空切片时调用 `synthesizeFromProviders`（第 136–138 行）然后 `Store`，**覆盖**上一份渠道 | `hasGood` 时返回 `ErrRemote404Keep`，不 `Store`、不再合成。从未成功时仍返回空切片，允许现有合成逻辑 |
| 本地文件不存在（第 161–162 行） | 空切片 + nil，可能合成后覆盖 | **不改** |

### 3. policy：`internal/server/server.go` `reloadPolicyIfNeeded()` 第 560–647 行；`loadPolicySnapshot()` 第 417–455 行；`buildPolicyEngine()` 第 386–415 行

| 情况 | 现状 | 改成 |
| --- | --- | --- |
| 拉取失败：远端 `HTTPGet` err（第 588–590 行）；HTTP 非 2xx 非 404（第 598–600 行）；override 或 snapshot 文件 `Stat` 失败且不是 NotExist（第 569–571、609–611 行） | 打日志后 return，不调用 `buildPolicyEngine`，**保留**当前 engine | 不变，额外 `ReportFailure("policy", policySnapshot, err)` |
| 解析失败：`buildPolicyEngine` 返回 err（第 635–637 行），包括坏 JSON | 打日志 return，不替换 `s.policy`，**保留** | 不变，额外 `ReportFailure` |
| 远端 404（`reloadPolicyIfNeeded` 第 594–595 行把 hash 置空；若与 `policySnapBodyHash` 不同则 `snapChanged`；`loadPolicySnapshot` 第 427–428 行把 404 当成「没有快照」；`buildPolicyEngine` 第 394–410 行在 tenants 为空时回落内置规则包） | **已发布快照会被内置规则包替换** | `len(policySnapshotStatus.Tenants) > 0` 时立刻 return，不重建，`ReportFailure(ErrRemote404Keep)`。tenants 为空（从未加载过已发布快照，含启动时 404 已走内置包）保持现有回落 |
| 本地快照文件不存在 | `Stat` 的 NotExist 不当错误；mtime 判定变化后 `buildPolicyEngine` 会回落内置包 | **不改**（见文末「观察到但未处理」） |

策略「已发布」的判定用 `policySnapshotStatus.Tenants` 非空，不用 `policySnapBodyHash`。原因：文件路径的 `loadPolicySnapshot` 第 454 行目前把 hash 固定返回 `""`，空 hash 不能区分「没加载过」和「从文件加载过」。

成功应用时 `Version` 为各租户 `publishId` 按 **tenant ID 字典序** 用逗号拼接。例：`tenant-a`=`p-a`、`tenant-b`=`p-b` → `p-a,p-b`。其余三个域 `Version` 留空。

文件快照成功时，`loadPolicySnapshot` 的 hash 返回值从 `""` 改为 `sha256Hex(raw)`，让 `ContentHash` 有值。engine 选择、mtime 变更判断、404 分支都不读这个文件 hash，行为不变。解析失败仍返回空 hash + error。

### 4. mcp_servers：`internal/mcp/loader.go` `Loader.reload()` 第 88–96 行，`loadRemoteOrFile()` 第 98–132 行

| 情况 | 现状 | 改成 |
| --- | --- | --- |
| 拉取失败：`HTTPGet` err（第 104–105 行）；非 2xx 非 404（第 110–111 行）；`ReadFile` 非 NotExist（第 119 行） | `reload` 返回 err，不 `Store`、不 `Replace`，**保留** | 不变，额外 `ReportFailure("mcp_servers", path, err)` |
| 解析失败（第 125–126 行） | 返回 err，**保留** | 不变，额外 `ReportFailure` |
| 远端 404（第 107–108 行） | 返回空切片 + nil，`Replace` **清空** registry | `hasGood` 时返回 `ErrRemote404Keep`，不 `Replace`。从未成功时仍 `Replace` 空切片并返回 nil |
| 本地文件不存在（第 116–117 行） | `Replace` 空切片 | **不改** |

### 5. 状态登记与路由

新建 `enterprise/apps/gateway/internal/configstatus/status.go`，按主规划的 `Outcome` / `Registry` / `ReportSuccess` / `ReportFailure` / `Snapshot`（按 `Domain` 排序）。

补充（主规划未写函数名，但 AC-2 要求 4 个 domain 始终出现）：

- `FillCoreDomains([]Outcome) []Outcome`：缺哪个核心域就补一条零值 `Outcome{Domain: ...}`，再按 domain 排序。顺序固定为 `channels`、`mcp_servers`、`policy`、`providers`。
- `ErrRemote404Keep = errors.New("remote 404, keeping last known good")`。四个域返回这个哨兵，禁止再包一层 `fmt.Errorf`，否则 `LastError` 不再是这句原文。
- `HashBytes([]byte) string`：sha256 hex。
- `InstanceID()`：`GATEWAY_INSTANCE_ID` 非空用它，否则 `os.Hostname()`，都空则 `"unknown"`。
- `Source` 在登记时去掉 URL 的 query、fragment、userinfo。本地路径原样保留。
- `ReportFailure` 保留该域已有的 `ContentHash`、`Version`、`AppliedAt`，`ConsecutiveFailures++`，更新 `CheckedAt` 与 `LastError`。
- `ReportSuccess` 把 `LastError` 置空、`ConsecutiveFailures` 置 0，刷新 `AppliedAt` 与 `CheckedAt`。
- 指标钩子接口 `Metrics`：`IncConfigApplyFailure(domain string)`、`SetConfigLastSuccess(domain string, at time.Time)`。`nil` 时跳过。

Prometheus 加在 `internal/observability/metrics.go` 的 `register()`（第 54–123 行），与现有 `MustRegister` 同一处：

- `gateway_config_apply_failures_total{domain}` Counter
- `gateway_config_last_success_timestamp_seconds{domain}` Gauge，值为 `AppliedAt.Unix()`

名字按主规划原文，不加现有指标的 `agx_gateway_` 前缀。`domain` 只有 4 个固定值。`metrics_cardinality_test.go` 的 `allowed` 表补这两条，标签只有 `domain`。`GATEWAY_METRICS` 关闭或 collector 为 nil 时方法直接返回。

接线（setter 在 `Start` / 第一次 `reload` 之前调用；不改构造函数签名，避免动现有测试的 `New` / `NewRegistry` / `NewLoader` 调用）：

- `runtimeconfig.Loader.SetConfigStatus`。`server.New` 在 `adminLoader.Start`（现第 157–158 行）之前创建 registry 并 Set。
- `channel.Registry.SetConfigStatus`。`initChannelRelay`（`channel_relay.go` 第 103–104 行）在 `Start` 之前 Set。
- `mcp.Loader.SetConfigStatus`。`initMCPProxy`（`mcp_proxy_handlers.go` 第 17–18 行）在 `Start` 之前 Set。托管开关关闭时 loader 不启动，该域保持零值，这是现有「不轮询」行为，不额外启动 loader。
- `Server` 增加 `configStatus *configstatus.Registry` 与 `startedAt time.Time`。`buildPolicyEngine` 成功后 `ReportSuccess`，失败后 `ReportFailure` 再把原错误返回。
- `reloadPolicyIfNeeded` 的成功分支在写入 `s.policy` 之后 `ReportSuccess`。内容未变化的提前 return（第 630–632 行）不登记：主规划只要求成功/失败分支调用 Report，这里没有新的应用。

路由：`server.go` `Router()` 第 665 行 `/internal/policy-status` 下一行注册 `GET /internal/config-status`。处理函数放在 `health.go`，紧挨 `handleInternalPolicyStatus`（第 55 行）。理由：该文件已经负责内部状态 HTTP，避免往 1900 行的 `server.go` 再塞一个处理函数。响应体按主规划，**不用**兄弟接口的 `{code,message,data}` 信封：

```json
{"instanceId":"...","startedAt":"...","domains":[Outcome...]}
```

`startedAt` 用 `Server` 创建时刻的 UTC `time.Time`（JSON 为 RFC3339）。

### `/internal/*` 鉴权调查结论

没有路由级中间件。每个内部处理函数自己调用 `gatewayInternalAuthorized`（`channel_handlers.go` 第 243–254 行）：

- 期望值来自 `gatewayinternal.SecretFromEnv("GATEWAY_INTERNAL_TOKEN")`（环境变量优先，否则 `GATEWAY_INTERNAL_TOKEN_FILE`）。
- 期望值为空 → 拒绝。
- 请求头必须是 `Authorization: Bearer <token>`，与期望值全等。
- 失败时 `writeAPIError(w, openai.Unauthorized("unauthorized"))`，HTTP 401。

`/internal/policy-status`、`/internal/channel-stats`、keypool、cache、plugins、connectors 都是这个模式。`GET /internal/config-status` 原样调用 `gatewayInternalAuthorized`，不新造鉴权。

---

## before / after 意图

providers 远端 404（channels、mcp 同形）：

```go
// before（runtimeconfig.go:133）
if code == http.StatusNotFound {
    l.current.Store(&snapshot{})
    return nil
}

// after
if code == http.StatusNotFound {
    if l.hasGood.Load() {
        return nil, false, configstatus.ErrRemote404Keep
    }
    return nil, false, nil // 调用方保持「清空并返回 nil」
}
```

policy 远端 404：

```go
// before（server.go:594）
case code == http.StatusNotFound:
    sum = "" // 随后可能重建并回落内置规则包

// after
case code == http.StatusNotFound:
    if len(已加锁读取的 Tenants) > 0 {
        s.reportPolicyFailure(configstatus.ErrRemote404Keep)
        return // 不调用 buildPolicyEngine
    }
    sum = ""
```

登记：

```go
// 成功解析并 Store 之后
status.ReportSuccess(domain, path, sha256Hex, version)
// 返回 err 之前（含 ErrRemote404Keep）
status.ReportFailure(domain, path, err)
```

---

## FR / AC

### FR-1：4 个核心域的生效状态可以通过一个接口查询。

- AC-1：`enterprise/apps/gateway/internal/configstatus/status_test.go`
  - `TestReportSuccessFailureSuccess`：对 `providers` 做 success → failure → failure → success。
  - 断言：第一次成功后 `ConsecutiveFailures==0`、`LastError==""`；第一次失败后 `ConsecutiveFailures==1`、`LastError` 等于传入错误文本、`AppliedAt` 与 `ContentHash` 保持第一次成功的值；第二次失败后 `ConsecutiveFailures==2`；再次成功后 `ConsecutiveFailures==0`、`LastError==""`、`ContentHash` 为新值。
  - 同一用例断言 `Source` 为 `http://127.0.0.1:9/providers?x=1` 登记后不再含 `?`。
  - 假 `Metrics` 断言失败回调次数为 2，成功回调至少 1 次。
  - `TestFillCoreDomainsAlwaysFour`：空输入得到 4 个 domain，顺序为 channels、mcp_servers、policy、providers。
- AC-2：`enterprise/apps/gateway/internal/server/config_status_test.go`
  - `TestInternalConfigStatusListsCoreDomains`：不走 `Server.New`。`httptest` 挂 `Router()`。设置 `GATEWAY_INTERNAL_TOKEN=status-token`。预先对 4 个域 `ReportSuccess`。
  - 无 Authorization：HTTP 401。
  - `Authorization: Bearer status-token`：HTTP 200；`domains` 长度 4；四个名字齐全；预先登记的 `AppliedAt` 非零；带 `?x=1` 的 source 在响应里没有 query。

### FR-2：解析失败时保留最后可用快照。

- AC-3：先合法、再非法、旧数据仍生效、`LastError` 非空。追加到现有测试文件，不新建测试文件。
  - `internal/runtimeconfig/runtimeconfig_test.go` `TestReloadKeepsProvidersOnInvalidJSON`：写合法 providers JSON（模型名 `m-keep`），`reload` 后 `ResolveByModel("m-keep")` 命中；改成 `{` 再 `reload`，返回 err，`ResolveByModel` 仍命中，`LastError != ""`。测试内把 `GATEWAY_REMOTE_PROVIDERS_URL` 置空，避免环境里的远端 URL 抢走文件路径。
  - `internal/channel/picker_test.go` `TestReloadKeepsChannelsOnInvalidJSON`：合法 channels JSON（id `ch-keep`）后 `ByID` 命中；非法 JSON 后 `ByID` 仍命中，`LastError != ""`。置空 `GATEWAY_REMOTE_CHANNELS_URL`。
  - `internal/server/policy_snapshot_test.go` `TestReloadPolicyKeepsSnapshotOnInvalidJSON`：合法快照含关键词 `marker-word`、`publishId=pub-keep`，旁路 manifest 含关键词 `fallback-marker`。第一次 `reloadPolicyIfNeeded` 后 `marker-word` 被拦截、`fallback-marker` 不拦截。文件改成 `{` 并用 `Chtimes` 把 mtime 拨到未来 2 秒后再 reload。`marker-word` 仍拦截，`fallback-marker` 仍不拦截，`LastError != ""`，`Version` 仍含 `pub-keep`。
  - `internal/mcp/loader_test.go` `TestReloadKeepsMCPServersOnInvalidJSON`：合法 JSON 含 id `s-keep`，`Registry.Get` 命中；非法 JSON 后仍命中，`LastError != ""`。置空 `GATEWAY_REMOTE_MCP_SERVERS_URL`。

### FR-3：本地端到端可查。

- AC-4：`bash enterprise/scripts/start-dev-with-infra.sh` 起来之后，`curl --noproxy '*' -H "Authorization: Bearer $GATEWAY_INTERNAL_TOKEN" http://127.0.0.1:<网关端口>/internal/config-status` 返回 200，且 4 个 domain 的 `AppliedAt` 都非零。docker / 端口起不来则记录原因，不杀已有进程，不反复重试。

### FR-4：远端 404 时保留最后可用快照（D-3）。

- AC-5：`internal/runtimeconfig/runtimeconfig_test.go` `TestReloadKeepsProvidersOnRemote404`。`httptest` 第一次 200 返回含模型 `m-keep` 的 JSON，第二次 404。`GATEWAY_REMOTE_PROVIDERS_URL` 指向该服务器，`GATEWAY_ADMIN_PROVIDERS_FILE` 置空。第二次 `reload` 返回的错误文本包含 `remote 404`；`ResolveByModel("m-keep")` 仍命中；registry `LastError` 包含 `remote 404`。
- 同契约的追加用例（AC-5 正文只点名 runtimeconfig，这三份是为 D-3 的另外三个域加的锁，断言点相同：旧数据仍在，`LastError` 包含 `remote 404`）：
  - `picker_test.go` `TestReloadKeepsChannelsOnRemote404`
  - `policy_snapshot_test.go` `TestReloadPolicyKeepsPublishedSnapshotOnRemote404`（先 200 已发布快照，再 404；`marker-word` 仍拦截，`fallback-marker` 不拦截）
  - `policy_snapshot_test.go` `TestReloadPolicyRemote404BeforePublishUsesBuiltin`（从未 200，两次都 404；内置包的 `fallback-marker` 拦截；`LastError` 不含 `remote 404`，因为没有「上一份已发布快照」可保留）
  - `loader_test.go` `TestReloadKeepsMCPServersOnRemote404`

验收命令（在 `enterprise/apps/gateway`）：

```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
go test ./... -count=1
go vet ./...
```

已知 `internal/mcphost` 的 `TestConnectorBackendExecuteActionMissingConnection` 基线失败，不修。其余必须全绿。已有测试不改断言；若某条既有断言与 D-3 冲突，只改那一条并记在文末。

---

## In scope

- 新包 `internal/configstatus`。
- providers / channels / policy / mcp_servers 四个 reload 的成功与失败登记。
- 上表中「改成」列的 404 保留语义。
- `GET /internal/config-status` 与两个 Prometheus 指标。
- 上列测试。
- 文件型策略快照在成功路径返回 sha256，供 `ContentHash` 使用。

## Out of scope

- quota、budget、pricing、cache、compliance、PAT 吊销、session grants（主规划候选 C-01）。
- 推送式下发、管理台快照生成、副本心跳与副本视图（GW-05）。
- 重写任何一个 loader 的解析、轮询间隔、合成渠道规则。
- 本地文件被删除时的清空 / 策略回落内置包。
- 修改 `gatewayInternalAuthorized` 本身。
- 修复 `TestConnectorBackendExecuteActionMissingConnection`。
- 桌面端与 Python 框架。

## no-scope-creep

只改上表点名的函数和 `server.New` / `initChannelRelay` / `initMCPProxy` 里「创建 registry、Set、Start 前注入」这几行。不调整无关格式。不改已有测试的断言，除非跑出来与 D-3 冲突并在文末逐条列出。

---

## 观察到但未处理

- 本地文件不存在时，providers / channels / mcp 仍按原逻辑清空（或合成），policy 文件消失后仍可能回落内置规则包。D-3 只约束远端 404。清空之后如果之前登记过成功，状态里的 `AppliedAt` 可能仍指向被清空前的那一版，直到下一次成功或失败登记。
- policy 在远端 404 且已有已发布快照时直接 return，同一次调用里即使 override 文件 mtime 变了也不会重建。这与现有的「HTTP 拉取失败直接 return」相同，避免 `buildPolicyEngine` 再次把 404 当成空快照并回落内置包。
- policy 内容 hash / mtime 都没变时提前 return，不更新 `CheckedAt`。主规划的登记 API 只有成功和失败两个入口。
- `GATEWAY_MCP_HOSTING` 关闭时不创建 mcp loader，`mcp_servers` 的 `AppliedAt` 保持零值。不为此把 loader 提前启动。

## AC-4 本次执行

未执行端到端 curl。docker daemon 可用，但 3000、3001、5432、6379、8088 已有用户进程监听。`start-dev-with-infra.sh` 会拉起中间件和应用栈，可能挤占或重建这些进程，因此没有启动脚本，也没有改动已有进程。
