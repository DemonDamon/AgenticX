> 已归档（2026-08-08）：内容不再单独维护。server 相关请见 conclusions/server_module_conclusion.md；desktop 相关请见 desktop/conclusions/desktop_conclusion.md。

# AgenticX Server Gateway 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-03-04 之后的变更）（无重大变更）

## 概述

本模块补全 AgenticX「第二步：变成 API 服务」的生产级基础设施，将覆盖度从约 60% 提升到约 92%。
引入 Redis 共享状态后端后，P1-P6 各组件均支持多实例水平扩展，Redis 不可用时自动降级到内存模式。

## 已实现组件

### P0: Redis 共享状态后端

- **文件**: `agenticx/server/redis_backend.py`
- **组件**:
  - `RedisBackend` — 基于 `redis.asyncio` 的连接池，全局单例，所有中间件和队列共用
  - `init_redis_backend(url)` — 初始化并连接，失败时降级（日志警告，不抛异常）
  - `get_redis_backend()` / `set_redis_backend()` — 获取/注入全局实例（测试可替换）
- **核心操作**:
  - 标量：`get` / `set(nx, ex)` / `delete` / `incr` / `expire`
  - Hash：`hget` / `hset` / `hgetall` / `hdel`
  - 有序集合：`zadd` / `zremrangebyscore` / `zcard` / `zrangebyscore`
  - 原子限流：`rate_limit_sliding_window(key, max_requests, window_seconds)` — MULTI/EXEC 事务
  - 断路器：`circuit_breaker_state` / `circuit_breaker_record_failure` / `circuit_breaker_record_success`
  - 任务持久化：`save_task` / `load_task` / `add_task_to_index` / `list_task_ids`
- **降级策略**: Redis 连接失败时所有方法返回安全默认值（`None` / `False` / 空列表），限流默认放行
- **key 前缀**: 默认 `agenticx:`，可通过 `key_prefix` 参数自定义（便于多环境隔离）

### P1: API 网关中间件层

- **文件**: `agenticx/server/middleware.py`
- **组件**:
  - `RequestIdMiddleware` — 注入 `X-Request-ID`，贯穿日志/SSE/错误响应
  - `TimeoutMiddleware` — 请求级超时（默认 300s），超时返回 504
  - `RateLimitMiddleware` — Redis 可用时走原子滑动窗口（`rate_limit_sliding_window`），降级时用内存 `RateLimiter`；支持 per-user/ip/api-key/endpoint/tenant，429 + `Retry-After` + `X-RateLimit-Remaining`
  - `CircuitBreakerMiddleware` — Redis 可用时状态存 Redis Hash（跨实例同步），降级时用内存 `CircuitBreaker`；按 `{METHOD}:{path}` 粒度熔断，503 Service Unavailable
  - `TenantIsolationMiddleware` — 租户上下文注入（仅已认证请求信任 `X-Tenant-ID` 头）
- **配置**: `MiddlewareConfig`，`register_production_middlewares()`
- **中间件执行顺序**（LIFO）: `RequestId → JWT → Tenant → RateLimit → Timeout → CircuitBreaker → handler`

### P2: 异步后台任务队列

- **文件**: `agenticx/server/task_queue.py`，`agenticx/core/background.py`
- **组件**:
  - `AsyncTaskQueue` — 基于 `BackgroundTaskPool.submit_async`，支持 submit/get_status/cancel/list_tasks；Redis 可用时任务元数据持久化（24h TTL），`get_status` 先查内存再查 Redis，`list_tasks` 合并两者
  - `AsyncTaskInfo.to_dict()` / `from_dict()` — 序列化/反序列化到 Redis Hash
  - `BackgroundAgentRunner` — 封装 Agent 任务提交
  - `AsyncBackgroundPool` — 纯 asyncio 任务池
- **API**: `POST /tasks/submit`，`GET /tasks/{id}/status`，`POST /tasks/{id}/cancel`
- **进程重启恢复**: 任务提交后写入 Redis，新实例通过 `task_index`（Sorted Set，按创建时间）可枚举历史任务

### P3: 多租户数据隔离

- **文件**: `agenticx/server/tenant.py`，`agenticx/sessions/base.py`，`agenticx/sessions/database.py`，`agenticx/sessions/in_memory.py`，`agenticx/memory/base.py`
- **组件**:
  - `TenantContext` — 基于 contextvars 的请求级租户上下文
  - `TenantIsolationMiddleware` — 从 JWT/`X-Tenant-ID` 提取 tenant_id
  - Session/Memory 层增加 `tenant_id` 维度，查询自动注入 WHERE 条件
  - `resolve_tenant_id()` — Memory 上下文感知

### P4: JWT 认证中间件

- **文件**: `agenticx/server/auth.py`，`agenticx/server/user_manager.py`
- **组件**:
  - `JWTAuthMiddleware` — Bearer token 验证，注入 user_id/tenant_id/roles
  - `APIKeyAuth` — `X-API-Key` 验证（M2M）
  - `require_role()`，`require_permission()` — 路由级权限装饰器
  - `UserManager.generate_jwt()`，`verify_jwt()` — JWT 生成与验证
- **依赖**: `pip install agenticx[server]`（PyJWT>=2.8.0）

### P5: 深度健康检查与自愈

- **文件**: `agenticx/server/health.py`
- **组件**:
  - `HealthProbe` — liveness / readiness / startup 三级探针
  - `DependencyChecker` — `check_database` / `check_llm_provider` / `check_memory_backend` / `check_redis_backend`（新增）；构造时 `check_redis=True` 则 readiness 包含 Redis PING
  - `SelfHealingManager` — 依赖故障时自动重连，与 CircuitBreaker 集成
- **API**: `GET /health/live`，`GET /health/ready`，`GET /health/startup`

### P6: 通用重试与优雅降级

- **文件**: `agenticx/server/resilience.py`，`agenticx/core/error_handler.py`
- **组件**:
  - `RetryableEndpoint` / `retryable_endpoint` — 可重试端点装饰器，支持 Idempotency-Key
  - `GracefulDegradation` — 降级状态管理，通过 /health/ready 暴露
  - `IdempotencyStore` — 内存幂等存储（TTL 过期，单实例）
  - `RedisIdempotencyStore` — Redis 幂等存储（多实例生产用），`SET NX EX` 原子操作；Redis 不可用时自动回退 `IdempotencyStore`；`get_idempotency_store()` 工厂函数自动选择
  - `is_retryable()` — 错误分类方法

## AgentServer Redis 集成

`AgentServer.__init__` 接受可选的 `redis_url` 参数；启动时（`lifespan`）自动调用 `init_redis_backend()`，关闭时调用 `close()`。`create_server()` 便捷函数同样透传 `redis_url`。

```python
from agenticx.server import AgentServer

server = AgentServer(
    stream_handler=my_handler,
    redis_url="redis://:password@localhost:6379/0",  # 不传则仅用内存
)
server.run(port=8000)
```

## 架构关系

```
Middleware: RequestId → JWT → Tenant → RateLimit → Timeout → CircuitBreaker
                                          ↑               ↑
                                     RedisBackend    RedisBackend
                                   (滑动窗口计数)   (断路器状态)
     ↓
API Routes: /health/*, /tasks/*, /api/login (JWT), ...
                 ↑           ↑
          DependencyChecker AsyncTaskQueue
          (check_redis)    (Redis Hash持久化)
     ↓
Core: ExecutionLane, AgentExecutor, BackgroundTaskPool, ErrorHandler
     ↓
Data: SessionService (tenant_id), Memory (tenant_id)
     ↓
Redis: agenticx:rl:* / agenticx:cb:* / agenticx:idem:* / agenticx:task:*
```

## 导出 API

```python
from agenticx.server import (
    AgentServer,
    register_production_middlewares,
    MiddlewareConfig,
    get_health_probe,
    get_task_queue,
    TenantContext,
    get_current_user,
    require_role,
    # Redis
    RedisBackend,
    init_redis_backend,
    get_redis_backend,
    set_redis_backend,
    RedisIdempotencyStore,
)
```

## 测试

`tests/server/test_redis_distributed.py` — 独立集成测试（无需启动 server），用双 `RedisBackend` 实例验证：
- T1 分布式限流共享（滑动窗口跨实例累计）
- T2 任务跨实例持久化（模拟进程重启）
- T3 幂等 key 跨实例拦截（SET NX）
- T4 断路器状态跨实例同步
- T5 Redis 不可用优雅降级
- T6 Redis 健康探针

运行前提：`docker compose -f deploy/docker-compose.core.yml up redis -d`

## 剩余缺口（非紧急）

- 用户存储 SQLite → PostgreSQL（已有 SQLAlchemy 抽象层，切换成本低）
- 分布式锁（跨实例任务去重，可用 Redis `SETNX` 实现）
- Prometheus metrics 集成（`monitoring` extras 已有依赖，需接线）
