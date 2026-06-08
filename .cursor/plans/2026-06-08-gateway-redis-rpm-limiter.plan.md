---
name: Gateway RPM/TPM 分布式限流后端（Redis 固定窗口，多副本一致）
overview: 网关 RateLimiter 当前为纯进程内计数（sharedLimiter 检测到无 GATEWAY_REDIS_URL 只打印 fallback 提示），多副本部署时各副本各算各的，RPM/TPM 限流在水平扩展下被放大 N 倍。借鉴 Higress ai-token-ratelimit 的 Redis 固定窗口 Lua 脚本，为 RateLimiter 增加可选 Redis 后端，使 RPM/TPM 在多副本间一致硬限流。共享 Token 池（PG 账本）已解决月度维度，本 plan 只补秒级窗口限流。仅改 enterprise/apps/gateway。
todos:
  - id: t1-backend-iface
    content: 抽象 RateLimiter 后端接口（AllowRPM/AllowTPM），保留进程内实现为默认
    status: completed
  - id: t2-redis-backend
    content: 新增 Redis 固定窗口后端（Lua incr+expire 原子脚本），GATEWAY_REDIS_URL 时启用
    status: completed
  - id: t3-wire
    content: sharedLimiter 按 env 选择后端；连接失败回退进程内并告警（不阻断请求）
    status: completed
  - id: t4-smoke
    content: go test 覆盖 Redis 窗口计数、过期重置、连接失败回退、无 Redis 行为不变
    status: completed
isProject: false
---

# Gateway RPM/TPM 分布式限流后端（Redis）

**Plan-Id**: 2026-06-08-gateway-redis-rpm-limiter
**Plan-File**: `.cursor/plans/2026-06-08-gateway-redis-rpm-limiter.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**优先级**: P1（顺序第 4）
**依赖**: 无（与 MCP plan 可并行；与共享 Token 池 plan 正交，不冲突）
**调研依据**: `research/codedeepresearch/higress/higress_enterprise_gap_analysis.md`（G-H8）；Higress `plugins/wasm-go/extensions/ai-token-ratelimit/main.go` L52-96（Redis 固定窗口 Lua）

## 背景 / 现状（已直读核验）

- `enterprise/apps/gateway/internal/quota/check_request.go` L10-21：`sharedLimiter()` 只 `NewRateLimiter()`（进程内），检测到无 `GATEWAY_REDIS_URL`/`REDIS_URL` 仅 `fmt.Println` fallback 提示，**Redis 后端从未实现**。
- RPM 检查 L53-60：`lim.AllowRPM(rateKey("rpm", ctx), rule.RPM)`；TPM 同理。
- `rateKey` 多维（pat→user→dept→tenant）已就绪。
- 共享 **月度 Token 池** 已 PG 化（`quota/ledger.go`），但**秒级 RPM/TPM 窗口仍进程内**，多副本下被放大。
- 对照 Higress ai-token-ratelimit：Redis 固定窗口，请求阶段预检 + 响应阶段 incrby，key 含规则/类型/窗口/限流键。

**目标**：为 RateLimiter 增 Redis 后端，使 RPM/TPM 多副本一致；默认（无 Redis）行为不变。

## 需求

- FR-1: 抽象限流后端接口（如 `type limiterBackend interface { AllowRPM(key string, limit int) (bool, int); AllowTPM(key string, limit, tokens int) (bool, int) }`），现有进程内实现重构为 `inProcessBackend`（默认）。
- FR-2: 新增 `redisBackend`：用 Redis 固定窗口（key = `agx-gateway-rl:{type}:{window}:{rateKey}`，窗口长度 RPM=60s/TPM=60s）；计数用原子 Lua（`INCRBY` + 首次 `EXPIRE`），返回是否超限与当前计数。
- FR-3: `sharedLimiter()` 在 `GATEWAY_REDIS_URL`（或 `REDIS_URL`）非空时构造 redis 后端；连接/ping 失败 → 回退 `inProcessBackend` 并 **一次性** 告警（不得因 Redis 故障阻断请求）。
- FR-4: Redis 客户端复用仓库已有依赖（若已用 `go-redis` 则复用；否则用最小封装，不新增重型依赖）；连接池与超时（默认 dial 2s、op 200ms）可配 env。
- NFR-1: 未配置 Redis 时，`limiter_test.go` 既有 RPM/TPM 用例全绿（零回归）。
- NFR-2: Redis 不可用绝不抛错给客户端——降级为进程内，限流可能偏松但不中断服务。
- NFR-3: Lua 脚本保证 incr+expire 原子；窗口过期自动重置。
- NFR-4: 限流键不含敏感信息（沿用 rateKey 既有脱敏）。
- AC-1: 配 Redis，两个进程共享同一 key，合计超过 limit 时第二进程被拦（用同一 Redis 的两个 limiter 实例模拟）。
- AC-2: 窗口过期（TTL 到）后计数重置，请求恢复。
- AC-3: `GATEWAY_REDIS_URL` 指向不可用地址时回退进程内，请求仍通过，日志有一次告警。
- AC-4: 未配 Redis 时既有 limiter 测试全绿。

## 改动范围（严格）

### 修改
1. `enterprise/apps/gateway/internal/quota/check_request.go`：`sharedLimiter()` 按 env 选后端 + 回退逻辑。
2. `enterprise/apps/gateway/internal/quota/limiter.go`（RateLimiter 定义所在文件）：抽出后端接口，进程内实现保留。

### 新增
3. `enterprise/apps/gateway/internal/quota/limiter_redis.go`（Redis 后端 + Lua）+ `limiter_redis_test.go`（用 miniredis 或集成 tag 跳过）。

### 不动
- `rateKey`、规则选择、共享 Token 池账本、TPM 计价、并发限流语义；只换 RPM/TPM 计数后端。
- `agenticx/`、`desktop/`、admin-console（本 plan 无 UI；env 配置即可）。

## 关键数据结构

```go
// limiter.go
type limiterBackend interface {
    AllowRPM(key string, limit int) (allowed bool, used int)
    AllowTPM(key string, limit, tokens int) (allowed bool, used int)
}

// RateLimiter 持有 backend；NewRateLimiter() 默认 inProcessBackend
```

Redis Lua（固定窗口，仿 Higress ResponsePhaseFixedWindowScript）：
```lua
local current = redis.call('incrby', KEYS[1], ARGV[3])
if current == tonumber(ARGV[3]) then redis.call('expire', KEYS[1], ARGV[2]) end
return {tonumber(ARGV[1]), current, redis.call('ttl', KEYS[1])}
```

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/quota/... -run 'RateLimiter|Redis' -count=1`（AC-1~AC-4）。
2. 无 Redis：`go test ./internal/quota/... -count=1` 全绿（NFR-1）。
3. `GATEWAY_REDIS_URL=redis://127.0.0.1:6379 go test ...`（集成，本机起 Redis）验证跨实例一致（AC-1）。
4. `cd enterprise/apps/gateway && go build ./...`。

## 规范备注（务必遵守）

- **no-scope-creep**：仅替换 RPM/TPM 计数后端；不动共享池、不改 rateKey、不改并发限流。
- **降级安全**：Redis 故障必须静默回退进程内，绝不阻断请求或抛 500。
- **依赖克制**：优先复用仓库已有 Redis 客户端；测试用 miniredis 避免 CI 依赖真 Redis。
- **commit**：`/commit --spec=.cursor/plans/2026-06-08-gateway-redis-rpm-limiter.plan.md`，message 含：
  - `Plan-Id: 2026-06-08-gateway-redis-rpm-limiter`
  - `Plan-File: .cursor/plans/2026-06-08-gateway-redis-rpm-limiter.plan.md`
  - `Made-with: Damon Li`
- 参考 Higress Lua 处加 `// Adapted from higress-group/higress ai-token-ratelimit (Apache-2.0)`。
- 只 add 本任务文件。

## 回滚

- 取消 `GATEWAY_REDIS_URL`（默认）即回进程内；删除 limiter_redis.go + 还原 sharedLimiter，无持久化数据。
