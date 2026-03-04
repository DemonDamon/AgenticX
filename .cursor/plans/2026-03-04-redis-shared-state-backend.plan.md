---
name: ""
overview: ""
todos: []
isProject: false
---

# Redis 共享状态后端 - 生产级水平扩展

## 背景

AgenticX server 的 P1-P6 基础设施模块已就绪，但所有状态（限流计数、断路器、幂等键、任务队列）
均存储在单进程内存中。多副本部署时这些状态无法共享，导致限流失效、幂等不生效、任务状态丢失。

## 目标

引入 Redis 作为共享状态后端，使 AgenticX server 支持多实例水平扩展。
保持向后兼容：Redis 不可用时自动回退到内存模式（单实例仍正常工作）。

## 设计原则

1. **Strategy Pattern**: 每个组件接受可选的 Redis backend，不影响现有 API
2. **Graceful Fallback**: Redis 连接失败自动降级到内存模式
3. **Single Connection Pool**: 全局共享一个 Redis 连接池
4. **Zero Breaking Change**: 所有现有接口保持不变

## 模块清单

### P0: Redis Backend Core (`agenticx/server/redis_backend.py`) [NEW]

- `RedisBackend` class - 管理 `redis.asyncio` 连接池
- `get_redis_backend()` / `init_redis_backend()` 工厂函数
- `ping()`, `close()` 生命周期方法
- 便捷方法: `get`, `set`, `delete`, `incr`, `expire`, `hget`, `hset`, `zadd`, `zrangebyscore`

### P1: Redis-backed Rate Limiting (`middleware.py`)

- `RateLimitMiddleware` 接受可选 `redis_backend`
- Redis 滑动窗口: `ZADD + ZREMRANGEBYSCORE + ZCARD` 原子操作
- 回退: Redis 不可用时走现有内存 RateLimiter

### P2: Redis-backed Circuit Breaker (`middleware.py`)

- `CircuitBreakerMiddleware` 接受可选 `redis_backend`
- Redis Hash 存储: `{endpoint}:{state, failure_count, last_failure_time}`
- 回退: Redis 不可用时走现有内存 CircuitBreaker

### P3: Redis-backed Idempotency Store (`resilience.py`)

- `RedisIdempotencyStore` 实现同接口
- `SET NX EX` 实现原子幂等检查
- `get_idempotency_store()` 自动选择 Redis/内存

### P4: Redis-backed Task Queue State (`task_queue.py`)

- `AsyncTaskInfo` 序列化/反序列化到 Redis Hash
- `submit()` 写 Redis，`get_status()` 读 Redis
- 任务列表用 Redis Sorted Set（按创建时间排序）
- 回退: Redis 不可用时走现有内存 dict

### P5: Redis Health Check (`health.py`)

- `DependencyChecker` 新增 `check_redis` 参数
- Redis PING 作为 readiness 探针的一部分

### P6: Server Wiring (`server.py` + `__init__.py`)

- `AgentServer.__init__` 接受 `redis_url` 参数
- 启动时初始化 Redis backend，注入到各中间件
- `__init__.py` 导出新组件

### P7: Dependencies (`pyproject.toml`)

- `[project.optional-dependencies].server` 添加 `redis>=5.0.0,<6`

## 文件变更清单


| 文件                                 | 操作     |
| ---------------------------------- | ------ |
| `agenticx/server/redis_backend.py` | NEW    |
| `agenticx/server/middleware.py`    | MODIFY |
| `agenticx/server/resilience.py`    | MODIFY |
| `agenticx/server/task_queue.py`    | MODIFY |
| `agenticx/server/health.py`        | MODIFY |
| `agenticx/server/server.py`        | MODIFY |
| `agenticx/server/__init__.py`      | MODIFY |
| `pyproject.toml`                   | MODIFY |


