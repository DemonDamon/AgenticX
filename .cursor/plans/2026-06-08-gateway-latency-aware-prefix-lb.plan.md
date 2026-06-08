---
name: Gateway AI 负载均衡升级（latency-aware 选路 + prefix-cache 亲和）
overview: 网关 channel picker 已采集 latency ring（Stat.Latencies / P50LatencyMS）与 session 亲和，但选路仍只用加权随机，未利用延迟数据，也无 prompt prefix 亲和。借鉴 Higress ai-load-balancer 的 cluster_metrics 与 prefix_cache 策略，为 picker 增加可配置的 latency-aware 选路与 prefix-hash 亲和，提高高并发下 P95 延迟与上游 KV cache 命中。仅改 enterprise/apps/gateway，默认行为不变。
todos:
  - id: t1-policy-field
    content: 定义 LB 策略枚举（weight/latency_aware/prefix_cache）与配置来源（env + 可选 runtime JSON）
    status: completed
  - id: t2-latency-pick
    content: picker 增加 latency_aware 选路（用 P50LatencyMS 反比加权，样本不足回退 weight）
    status: completed
  - id: t3-prefix-affinity
    content: picker 增加 prefix-hash 亲和（按 messages 前 N 段 hash 到候选，命中健康则复用）
    status: completed
  - id: t4-audit-policy
    content: 选路决策写入 audit metadata.routing_policy，便于排障与可观测
    status: completed
  - id: t5-smoke
    content: go test 覆盖 latency 反比选路、prefix 命中同 channel、样本不足回退、默认 weight 零回归
    status: completed
isProject: false
---

# Gateway AI 负载均衡升级（latency-aware + prefix-cache 亲和）

**Plan-Id**: 2026-06-08-gateway-latency-aware-prefix-lb
**Plan-File**: `.cursor/plans/2026-06-08-gateway-latency-aware-prefix-lb.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**优先级**: P0（顺序第 2）
**依赖**: 无（与 Provider 扩展可并行；建议在其后做以便用多 channel 验证）
**调研依据**: `research/codedeepresearch/higress/higress_enterprise_gap_analysis.md`（G-H2）；`higress_proposal.md` §2.4 / §4.2

## 背景 / 现状（已直读核验）

- `enterprise/apps/gateway/internal/channel/picker.go`：
  - `Pick()` L36-89：健康过滤（cooldown/exclude）→ session affinity 命中复用 → 否则 `weightedSample`。
  - `MarkSuccess` L125-132 已记录 latency 到 `StatsStore`。
- `enterprise/apps/gateway/internal/channel/types.go`：
  - `Stat.Latencies` 环形缓冲（L122-123）+ `P50LatencyMS()`（L145-153）**已存在但 picker 选路未用**。
- 对照 Higress `plugins/wasm-go/extensions/ai-load-balancer/`：`cluster_metrics`（按指标选）、`prefix_cache`（prompt 前缀 hash 亲和提高 KV cache 命中）、`global_least_request`。

**目标**：把已采集的 latency 数据用于选路，并新增 prefix-hash 亲和，二者均为可配置、默认关闭（保持 weight）。

## 需求

- FR-1: 新增 LB 策略枚举：`weight`（默认）、`latency_aware`、`prefix_cache`。策略来源优先级：env `GATEWAY_AI_LB_POLICY`（默认 `weight`）；后续可由 runtime JSON 覆盖（本 plan 仅做 env，runtime 留接口）。
- FR-2: `latency_aware` 选路：对健康候选用 `P50LatencyMS()` 计算**反比权重**（延迟越低权重越高），与 `Channel.Weight` 相乘后加权抽样；任一候选样本不足（`len(Latencies)==0`）则该候选用其静态 `Weight`；全部样本不足则退化为现有 `weightedSample`。
- FR-3: `prefix_cache` 亲和：在 session affinity **之前**（或 session 无命中时）按 `hashPrefix(messages 前 N 段)` 取模映射到候选健康列表的稳定序，命中则返回该 channel；N 取 env `GATEWAY_AI_LB_PREFIX_MSGS`（默认 4）。需把 messages 传入 `Pick`（扩展入参或新方法 `PickWithPrefix`），不破坏现有 `Pick` 签名调用方（提供兼容包装）。
- FR-4: 选路最终决策（命中策略名 + channelID + 命中原因 affinity/prefix/latency/weight）写入 audit `metadata.routing_policy`（复用 `server.go` 写 audit 处）。
- NFR-1: `GATEWAY_AI_LB_POLICY` 未设或 `weight` 时，选路结果与改动前完全一致（零回归）——现有 `picker_test.go` 全绿。
- NFR-2: 选路为纯内存计算，不新增 IO；prefix hash 用 `fnv` 或 `sha256` 截断，不引第三方库。
- NFR-3: 不改变 cooldown/exclude/重试语义；亲和命中的 channel 若在 exclude 中必须跳过。
- AC-1: 两 channel，A 的 P50 远低于 B，`latency_aware` 下多次抽样 A 命中率显著高于 weight 比例。
- AC-2: 相同 messages 前缀在 `prefix_cache` 下稳定命中同一 channel；候选集变化时重新映射。
- AC-3: 候选 latency 样本为空时 `latency_aware` 不 panic，退化为 weight。
- AC-4: `GATEWAY_AI_LB_POLICY` 未设时 `picker_test.go` 既有断言不变。
- AC-5: audit 事件含 `routing_policy` 字段（policy + reason）。

## 改动范围（严格）

### 修改
1. `enterprise/apps/gateway/internal/channel/picker.go`：
   - 新增策略字段（构造时读 env 或由调用方注入）；
   - `Pick` 内分支：prefix → affinity → latency/weight；
   - 新增 `PickWithPrefix(model, id, messages, exclude)`；`Pick` 保留为 `PickWithPrefix(..., nil)` 包装。
2. `enterprise/apps/gateway/internal/channel/types.go`：如需 latency 反比辅助函数（如 `InverseLatencyWeight`）可加此处。
3. `enterprise/apps/gateway/internal/server/server.go`：调用 picker 处传入 messages；写 audit `routing_policy`。

### 新增
4. `enterprise/apps/gateway/internal/channel/lb_policy.go`（策略枚举 + env 解析 + 反比权重/prefix hash 纯函数）+ `lb_policy_test.go`。

### 不动
- `relay/` 重试、`quota/`、`metering/`、`policy/`、adaptor。
- `agenticx/`、`desktop/`、admin-console（本 plan 无 UI 改动）。

## 关键数据结构

```go
// lb_policy.go
type LBPolicy string
const (
    LBWeight      LBPolicy = "weight"
    LBLatencyAware LBPolicy = "latency_aware"
    LBPrefixCache LBPolicy = "prefix_cache"
)

func LBPolicyFromEnv() LBPolicy // 读 GATEWAY_AI_LB_POLICY，未知值回退 weight

// 选路结果（写入 audit）
type PickDecision struct {
    ChannelID string
    Policy    LBPolicy
    Reason    string // affinity|prefix|latency|weight
}
```

prefix hash：`fnv32(strings.Join(firstNUserContents, "\n")) % len(stableSortedHealthy)`。

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/channel/... -count=1`（AC-1~AC-4）。
2. `cd enterprise/apps/gateway && go test ./internal/server/... -run Routing -count=1`（AC-5）。
3. `GATEWAY_AI_LB_POLICY` 不设：`go test ./internal/channel/...` 既有用例全绿（NFR-1）。
4. `cd enterprise/apps/gateway && go build ./...`。

## 规范备注（务必遵守）

- **no-scope-creep**：仅在 picker/lb_policy 内实现；不重构 StatsStore、不改 cooldown 阈值。
- **兼容**：`Pick` 旧签名必须保留，所有现有调用方零改动即可编译。
- **commit**：`/commit --spec=.cursor/plans/2026-06-08-gateway-latency-aware-prefix-lb.plan.md`，message 含：
  - `Plan-Id: 2026-06-08-gateway-latency-aware-prefix-lb`
  - `Plan-File: .cursor/plans/2026-06-08-gateway-latency-aware-prefix-lb.plan.md`
  - `Made-with: Damon Li`
- 只 add 本任务文件；参考 Higress 源码处加 Apache-2.0 NOTICE。

## 回滚

- `GATEWAY_AI_LB_POLICY=weight`（默认）即恢复原行为；删除 lb_policy.go 与 picker 分支即可，无持久化数据。
