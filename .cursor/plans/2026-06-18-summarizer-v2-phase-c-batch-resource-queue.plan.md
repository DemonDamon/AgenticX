---
name: Summarizer v2 Phase C - Batch / Resource / Queue
overview: 为摘要服务补齐批处理能力，并建立可计算的资源评估体系（给出最小资源下限公式与配置项）。当实时容量不足时进入内存队列异步处理，提供任务提交/查询接口。本期队列为单机内存实现，预留分布式后端接口。
todos:
  - id: c1-resource-estimator
    content: C1 batch/resource.py ResourceEstimator：按 token/分块估算 LLM 调用数、耗时、TPM/RPM 需求
    status: pending
  - id: c2-capacity-guard
    content: C2 CapacityGuard：依据 provider 限额与并发配置裁决 inline / enqueue
    status: pending
  - id: c3-queue-worker
    content: C3 batch/queue.py + worker.py 内存队列 + 异步 worker（预留 Backend 协议）
    status: pending
  - id: c4-batch-api
    content: C4 app.py /v2/summarize/batch 提交 + /v2/jobs/{id} 查询
    status: pending
  - id: c5-config-doc
    content: C5 config 批处理/资源段 + README 资源评估体系章节（含下限公式与样例算例）
    status: pending
  - id: c6-tests
    content: C6 冒烟测试 test_phase_c_batch.py（估算正确性、入队降级、worker 消费）
    status: pending
isProject: false
---

# Phase C - 批处理 + 资源评估体系 + 队列降级

**Author:** Damon Li
**Date:** 2026-06-18
**Planned-with:** Claude Opus 4.8
**前置:** Phase A 完成（单文档引擎稳定）。可与 Phase B 并行。

## 目标

1. **批处理**：一次提交多条摘要请求，受控并发执行（复用 `asyncio` + `Semaphore`，与 Map-Reduce 同范式）。
2. **资源评估体系**：给出**可计算**的资源下限，而非「加个队列」。明确：处理 N 条 / 每条 M tokens 需要多少 LLM 调用、预计耗时、对 provider TPM/RPM 的需求、内存占用量级。
3. **队列降级**：当并发/限额超出实时容量时，请求转入队列异步处理，返回 `job_id`，提供查询接口。

## 资源评估体系（本 Phase 的核心交付，必须落地为代码 + 文档）

### 估算模型（`ResourceEstimator`）

对单条请求，给定文本 token 数 `T`、单块阈值 `S=max_single_pass_tokens`、块大小 `C=chunk_size`、reduce 扇入 `F`：

- 分块数 `n_chunks = ceil(T / C)`（仅当 `T > S`）
- LLM 调用数：
  - 单块路径（`T ≤ S`）：`calls = 1`
  - Map-Reduce：`map_calls = n_chunks`；`reduce_calls ≈ ceil(n_chunks / F) + ...`（多级，按 `max_reduce_rounds` 收敛）；`calls = map_calls + reduce_calls`
- 预计耗时：`latency ≈ ceil(calls / map_concurrency) * avg_call_seconds`
- TPM 需求：`tokens_per_call ≈ C(输入) + 输出预算`；`required_tpm ≈ calls * tokens_per_call / (latency/60)`
- RPM 需求：`required_rpm ≈ calls / (latency/60)`

对批量 `B` 条：线性叠加后除以 `batch_concurrency`，得到批级 `latency/required_tpm/required_rpm`。

### 最小资源下限（写入 README + 配置注释）

给出「跑通一条 ~1 万 tokens 文档摘要」的下限基线（示例，需在 README 用算例展示）：
- LLM 侧：provider 至少满足 `required_rpm`/`required_tpm`（按上式算出的数字，不要写死）。
- 本机侧：CPU 主要耗在分块（轻量，单核可支撑数十并发）；内存下限 ≈ `max_chunks * chunk_size * 字节系数 * batch_concurrency`，给出量级（MB 级）。
- 队列侧：内存队列容量 `queue_max` 项，单项内存占用 ≈ 文本大小；超出 `queue_max` 拒绝并返回明确错误。

> 实施要求：`ResourceEstimator.estimate(...)` 返回结构化 `ResourceEstimate`（calls/latency/required_tpm/required_rpm/mem_bytes），README 用 1–2 个真实算例展示「输入规模 → 资源需求」，证明体系可计算。

## 新增/变更文件

```
agenticx_service/batch/
  __init__.py
  resource.py     # ResourceEstimator / ResourceEstimate / CapacityGuard
  queue.py        # JobQueue（内存实现）+ QueueBackend 协议（预留）
  worker.py       # 异步消费 worker
agenticx_service/app.py   # 变更：/v2/summarize/batch、/v2/jobs/{id}
config_agenticx.yaml      # 变更：batch 段
```

## 任务清单

- [ ] **C1 资源估算** `batch/resource.py`
  - `@dataclass ResourceEstimate`: `n_chunks/calls/est_latency_s/required_tpm/required_rpm/est_mem_bytes`。
  - `class ResourceEstimator`：`estimate_single(token_count, cfg) -> ResourceEstimate`；`estimate_batch(token_counts: list[int], cfg) -> ResourceEstimate`。用 `count_tokens` 取真实 token；公式见上。`avg_call_seconds`/`output_budget_tokens` 作为可配置常量。

- [ ] **C2 容量裁决** `CapacityGuard`
  - 输入：当前在途任务数、配置的 `provider_rpm_limit/provider_tpm_limit/inline_max_concurrency`。
  - `decide(estimate, in_flight) -> "inline" | "enqueue" | "reject"`：实时容量足够走 inline；超限走 enqueue；队列也满则 reject（明确错误码与原因）。

- [ ] **C3 队列与 worker** `batch/queue.py` / `worker.py`
  - `class QueueBackend(Protocol)`：`put(job)/get()->job/update(job)/get_job(id)`；先实现 `InMemoryQueueBackend`（`asyncio.Queue` + dict 存状态），**预留**接口供后续接 Redis/PG。
  - `Job` 状态机：`queued → running → done|failed`，含 `result`/`error`/`created_at`/`finished_at`。
  - `class SummaryWorker`：后台 `asyncio.Task`，从队列取 job，调 `SummarizationEngine.summarize`，回写状态；并发受 `batch_concurrency` Semaphore 限制。worker 随 FastAPI lifespan 启停。

- [ ] **C4 批处理 API** `app.py`
  - `POST /v2/summarize/batch`：`{items: [{content, domain?, options?}, ...]}` → 对每条先 `estimate` + `CapacityGuard.decide`；可 inline 的并发执行直接返回，需排队的入队返回 `job_id`。响应含每条的 `status` 与（inline）`result` 或（queued）`job_id`。
  - `GET /v2/jobs/{job_id}`：返回 job 状态与结果。
  - lifespan 中创建 `JobQueue` + 启动 `SummaryWorker`，关闭时优雅 drain。

- [ ] **C5 配置 + 文档** `config_agenticx.yaml` / `README.md`
  - `batch:` 段：`batch_concurrency`、`queue_max`、`inline_max_concurrency`、`provider_rpm_limit`、`provider_tpm_limit`、`avg_call_seconds`、`output_budget_tokens`。
  - README 新增「批处理与资源评估」章：估算公式表 + 1–2 个算例 + 队列降级时序图（mermaid）。

- [ ] **C6 测试**（见下）。

## 冒烟测试 `tests/test_phase_c_batch.py`

- `test_estimate_single_pass_vs_mapreduce`：短文本 `calls==1`；长文本 `calls == map+reduce`，`n_chunks` 与公式一致。
- `test_estimate_batch_scales`：批量估算随条数线性增长、随并发下降。
- `test_capacity_guard_enqueue_when_over_limit`：超限返回 `enqueue`；队列满返回 `reject`。
- `test_batch_inline_path`（stub LLM）：小批量全 inline，结果齐全。
- `test_queue_worker_consumes_job`（stub LLM）：入队 job 经 worker 变 `done` 且结果非空。
- `test_jobs_endpoint_returns_status`。

## 设计护栏

- 队列**本期内存实现**即可，但必须经 `QueueBackend` 协议抽象，禁止把 `asyncio.Queue` 直接散落到 API 层（便于将来换 Redis/PG）。
- 资源评估必须是**可计算的数字**输出（结构化对象 + README 算例），不接受仅文字描述。
- 不改 A/B 已冻结契约；批处理复用同一 `SummarizationEngine` 单例。
- worker 异常必须落到 `job.failed` 且记录 error，绝不吞异常导致 job 永久 `running`。

## 验收标准

1. `ResourceEstimator` 估算与公式一致，README 有可复算的算例。
2. 超限请求自动入队并可经 worker 完成；`GET /v2/jobs/{id}` 可查询全生命周期状态。
3. 队列后端经协议抽象，内存实现可一处替换。
4. 批处理与单条共用引擎，行为一致。

Made-with: Damon Li
