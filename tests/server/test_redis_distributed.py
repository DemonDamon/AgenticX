#!/usr/bin/env python3
"""
Redis 共享状态分布式验证测试

证明 Redis 后端使 AgenticX server 具备水平扩展能力。
每个测试用两个独立的 RedisBackend 实例（模拟两个进程/副本）来验证状态共享。

运行前提：Redis 容器已启动
  cd deploy && docker compose -f docker-compose.core.yml up redis -d

用法：
  python tests/server/test_redis_distributed.py
  python tests/server/test_redis_distributed.py --url redis://:password@localhost:6379/0
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from pathlib import Path

# tests/server/ → project root
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

REDIS_URL = "redis://:password@localhost:6379/0"
TEST_PREFIX = f"agenticx:test:{uuid.uuid4().hex[:6]}:"   # 隔离每次运行的 key 空间


# ──────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────

async def make_backend(url: str, prefix: str = TEST_PREFIX):
    """创建并连接一个 RedisBackend，使用测试专属 prefix。"""
    from agenticx.server.redis_backend import RedisBackend
    b = RedisBackend(url=url, key_prefix=prefix)
    connected = await b.connect()
    return b, connected


async def cleanup(backend, *keys: str):
    """测试结束后删除测试产生的 Redis key。"""
    if backend and backend.connected and keys:
        await backend.delete(*keys)


# ──────────────────────────────────────────────
# 测试集
# ──────────────────────────────────────────────

async def test_t0_connectivity(url: str) -> bool:
    """T0: Redis 基本连通性"""
    b, connected = await make_backend(url)
    ok = connected and await b.ping()
    await b.close()
    _print("T0", "Redis 连通性 ping", ok)
    return ok


async def test_t1_rate_limit_shared(url: str) -> bool:
    """T1: 分布式限流 — 两个实例共享滑动窗口计数器

    实例 A 消耗 2 次额度，实例 B 再消耗 1 次后应触发限制（总 limit=3）。
    若状态不共享，实例 B 会有独立计数，永远不会触发限制。
    """
    # 每个测试用独立 key，避免相互干扰
    prefix = f"{TEST_PREFIX}t1:"
    ba, _ = await make_backend(url, prefix)
    bb, _ = await make_backend(url, prefix)
    rl_key = "rl:ip:10.0.0.1"
    max_req = 3
    window = 60.0

    # 实例 A 发 2 个请求
    r1 = await ba.rate_limit_sliding_window(rl_key, max_req, window)
    r2 = await ba.rate_limit_sliding_window(rl_key, max_req, window)
    # 实例 B 发第 3 个请求（刚好到达 limit）
    r3 = await bb.rate_limit_sliding_window(rl_key, max_req, window)
    # 实例 B 发第 4 个请求 → 应被拒绝
    r4 = await bb.rate_limit_sliding_window(rl_key, max_req, window)

    ok = r1[0] and r2[0] and r3[0] and (not r4[0])
    detail = (
        f"A-req1={'✓' if r1[0] else '✗'} "
        f"A-req2={'✓' if r2[0] else '✗'} "
        f"B-req3={'✓' if r3[0] else '✗'} "
        f"B-req4(should-block)={'✓' if not r4[0] else '✗(NOT BLOCKED — state not shared!)'}"
    )
    await ba.close()
    await bb.close()
    _print("T1", f"分布式限流共享 {detail}", ok)
    return ok


async def test_t2_task_cross_instance(url: str) -> bool:
    """T2: 任务状态跨实例可见 — 模拟进程重启

    队列 A 提交任务并写入 Redis；
    队列 B（全新实例，内存空白）通过 Redis 读取任务状态。
    """
    from agenticx.server.redis_backend import set_redis_backend
    from agenticx.server.task_queue import AsyncTaskQueue

    prefix = f"{TEST_PREFIX}t2:"
    ba, _ = await make_backend(url, prefix)

    # 实例 A：提交任务
    set_redis_backend(ba)
    queue_a = AsyncTaskQueue()
    task_id = await queue_a.submit(
        asyncio.sleep, args=(0.05,), name="redis_persistence_probe"
    )
    # 等待任务完成，确保写入 Redis
    await asyncio.sleep(0.3)
    info_a = await queue_a.get_status(task_id)

    # 实例 B：全新队列，内存空白，通过 Redis 读取
    bb, _ = await make_backend(url, prefix)
    set_redis_backend(bb)
    queue_b = AsyncTaskQueue()   # 内存中没有任何 task
    info_b = await queue_b.get_status(task_id)

    ok = info_b is not None and info_b.task_id == task_id
    detail = (
        f"A-status={info_a.status.value if info_a else 'None'} | "
        f"B-reads-from-Redis={'✓ ' + info_b.status.value if info_b else '✗ not found'}"
    )
    set_redis_backend(None)
    await ba.close()
    await bb.close()
    _print("T2", f"任务跨实例持久化 {detail}", ok)
    return ok


async def test_t3_idempotency_cross_instance(url: str) -> bool:
    """T3: 幂等性跨实例 — 同一请求 key 只被处理一次

    实例 A 注册幂等 key；实例 B 再次注册同一 key 应返回 False。
    """
    from agenticx.server.redis_backend import set_redis_backend
    from agenticx.server.resilience import RedisIdempotencyStore

    prefix = f"{TEST_PREFIX}t3:"
    ba, _ = await make_backend(url, prefix)
    bb, _ = await make_backend(url, prefix)
    req_key = f"req-{uuid.uuid4().hex[:8]}"

    set_redis_backend(ba)
    store_a = RedisIdempotencyStore(ttl_seconds=60)
    first = await store_a.set_if_absent(req_key, "processed")

    set_redis_backend(bb)
    store_b = RedisIdempotencyStore(ttl_seconds=60)
    second = await store_b.set_if_absent(req_key, "processed")

    ok = first and (not second)
    detail = (
        f"A-first={'✓ True' if first else '✗'} | "
        f"B-duplicate={'✓ False(blocked)' if not second else '✗ True(NOT blocked — state not shared!)'}"
    )
    set_redis_backend(None)
    await ba.close()
    await bb.close()
    _print("T3", f"幂等 key 跨实例拦截 {detail}", ok)
    return ok


async def test_t4_circuit_breaker_shared(url: str) -> bool:
    """T4: 断路器状态跨实例传播

    实例 A 记录 N 次失败后断路器变 open；
    实例 B 读取同一 endpoint 的状态应看到 open。
    """
    prefix = f"{TEST_PREFIX}t4:"
    ba, _ = await make_backend(url, prefix)
    bb, _ = await make_backend(url, prefix)
    ep_key = f"GET:/api/fragile-{uuid.uuid4().hex[:6]}"
    threshold = 3

    # 实例 A 累积失败
    states = []
    for _ in range(threshold):
        s = await ba.circuit_breaker_record_failure(ep_key, threshold, recovery_timeout=30)
        states.append(s)
    final_state_a = states[-1]

    # 实例 B 读取状态
    state_b = await bb.circuit_breaker_state(ep_key)

    ok = final_state_a == "open" and state_b["state"] == "open"
    detail = (
        f"A-after-{threshold}-failures={final_state_a} | "
        f"B-reads={'✓ open' if state_b['state'] == 'open' else '✗ ' + state_b['state']}"
    )
    await ba.close()
    await bb.close()
    _print("T4", f"断路器状态跨实例同步 {detail}", ok)
    return ok


async def test_t5_graceful_fallback() -> bool:
    """T5: Redis 不可用时优雅降级，不抛异常"""
    from agenticx.server.redis_backend import RedisBackend

    bad = RedisBackend(
        url="redis://127.0.0.1:19999/0",  # 不存在的端口
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
    )
    connected = await bad.connect()

    # 所有操作不应抛异常，返回合理默认值
    ping = await bad.ping()
    get_result = await bad.get("any_key")
    set_result = await bad.set("k", "v")
    rl_result = await bad.rate_limit_sliding_window("k", 10, 60.0)

    ok = (
        not connected
        and not ping
        and get_result is None
        and not set_result
        and rl_result[0] is True  # fallback: allow all
    )
    await bad.close()
    _print("T5", f"Redis 不可用优雅降级 connected={connected} fallback-allow={rl_result[0]}", ok)
    return ok


async def test_t6_redis_health_check(url: str) -> bool:
    """T6: Redis 健康检查集成到 DependencyChecker"""
    from agenticx.server.redis_backend import set_redis_backend
    from agenticx.server.health import DependencyChecker, HealthStatus

    prefix = f"{TEST_PREFIX}t6:"
    ba, _ = await make_backend(url, prefix)
    set_redis_backend(ba)

    checker = DependencyChecker(check_redis=True)
    result = await checker.check_redis_backend()

    ok = result.status == HealthStatus.HEALTHY and result.latency_ms is not None
    detail = f"status={result.status.value} latency={result.latency_ms:.1f}ms"
    set_redis_backend(None)
    await ba.close()
    _print("T6", f"Redis 健康探针 {detail}", ok)
    return ok


# ──────────────────────────────────────────────
# 输出格式
# ──────────────────────────────────────────────

def _print(tag: str, desc: str, ok: bool):
    icon = "✓" if ok else "✗"
    print(f"  [{tag}] {icon}  {desc}")


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────

async def main(url: str):
    print("=" * 62)
    print("AgenticX Redis 分布式状态验证")
    print(f"Redis: {url.split('@')[-1]}")
    print(f"Key prefix: {TEST_PREFIX}")
    print("=" * 62)

    results = {}

    print("\n── 基础连通性 ─────────────────────────────────────")
    results["T0"] = await test_t0_connectivity(url)

    if not results["T0"]:
        print("\n❌  Redis 连不上，后续测试跳过。")
        print("提示: docker compose -f deploy/docker-compose.core.yml up redis -d")
        sys.exit(1)

    print("\n── 分布式状态验证（双实例） ──────────────────────────")
    results["T1"] = await test_t1_rate_limit_shared(url)
    results["T2"] = await test_t2_task_cross_instance(url)
    results["T3"] = await test_t3_idempotency_cross_instance(url)
    results["T4"] = await test_t4_circuit_breaker_shared(url)

    print("\n── 降级与健康检查 ─────────────────────────────────")
    results["T5"] = await test_t5_graceful_fallback()
    results["T6"] = await test_t6_redis_health_check(url)

    passed = sum(1 for v in results.values() if v)
    total = len(results)
    print("\n" + "=" * 62)
    print(f"结果: {passed}/{total} 通过")

    if passed == total:
        print("全部通过 ✓  Redis 共享状态后端工作正常，支持水平扩展")
    else:
        failed = [k for k, v in results.items() if not v]
        print(f"失败项: {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Redis 分布式状态验证测试")
    parser.add_argument(
        "--url",
        default=REDIS_URL,
        help=f"Redis URL（默认: {REDIS_URL}）",
    )
    args = parser.parse_args()
    asyncio.run(main(args.url))
