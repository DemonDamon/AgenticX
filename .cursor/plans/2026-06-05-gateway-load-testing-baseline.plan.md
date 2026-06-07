---
name: 网关压测套件与性能基线
overview: 为 AI 网关建立可重复的压测套件（k6）与性能基线归档，针对 /v1/chat/completions 等关键路径产出 TPS/P95/错误率数据，写入 perf-baselines 供投标与回归对照，替代当前「无任何网关压测与基线」的空白。
todos:
  - id: t1-mock-upstream
    content: 提供可控 mock 上游（固定延迟/可调）以隔离网关自身开销
    status: completed
  - id: t2-k6-scripts
    content: 编写关键路径 k6 压测脚本（非流式/流式/带策略）
    status: completed
  - id: t3-baseline-harness
    content: 运行脚本并把结果归档为结构化基线文件
    status: completed
  - id: t4-doc-report
    content: 产出压测方法与基线报告（含部署建议、限制说明）
    status: completed
isProject: false
---

# 网关压测套件与性能基线

**Plan-Id**: 2026-06-05-gateway-load-testing-baseline
**Plan-File**: `.cursor/plans/2026-06-05-gateway-load-testing-baseline.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：仓库**没有任何针对 `/v1/chat/completions` 的网关/聊天压测脚本**，`enterprise/docs/perf-baselines/` 目录内无实测数据，仅 `scripts/perf/sso-200-concurrent.js`（测 SSO start）与一个 transform benchmark。客户提出「万级 TPS、P95<50ms、99.999%」等指标——本 plan 建立**可重复压测方法 + 基线数据**，使方案能以实测/部署建议作答，而非口头承诺达标。

## 需求

- FR-1: 提供可控 mock 上游（固定/可调延迟、返回标准 usage），使压测度量**网关自身开销**而非真实模型延迟。
- FR-2: k6 脚本覆盖关键路径：非流式 chat、流式 chat、带策略命中、带配额检查；可参数化并发 VU 与时长。
- FR-3: 运行 harness 输出结构化基线（JSON/CSV）：吞吐(req/s 与 token/s)、P50/P95/P99、错误率，并归档到 `perf-baselines/` 带环境元数据（机器规格、commit）。
- FR-4: 报告文档说明方法、结果、瓶颈观察、扩容/部署建议，并诚实标注「单机基线 ≠ 生产 SLA 承诺」。
- NFR-1: 压测套件不进入生产路径；不依赖外部付费模型（用 mock 上游）。
- AC-1: `k6 run` 关键脚本可跑通并产出指标文件。
- AC-2: 基线文件含可复现的环境元数据与 commit。
- AC-3: 报告区分「实测基线」与「生产估算/建议」。

## 改动范围（严格）

1. `enterprise/scripts/perf/`
   - `mock-upstream/`（轻量 HTTP server，可调延迟 + 标准 usage）。
   - `gateway-chat-nonstream.js`、`gateway-chat-stream.js`、`gateway-policy-quota.js`（k6）。
   - `run-gateway-baseline.sh`：起 mock + 网关 → 跑脚本 → 汇总归档。
2. `enterprise/docs/perf-baselines/`
   - 写入基线结果文件（按日期/commit）与 `README` 方法说明。
   - `gateway-baseline-report.md`：方法 + 结果 + 部署建议 + 限制声明。
3. （可选）`.github/workflows/` 夜间触发说明，仅文档建议，不强制加 CI 产物。

不动：网关业务代码、生产配置。

## 验证步骤

1. 本地起 mock 上游 + 网关，`k6 run enterprise/scripts/perf/gateway-chat-nonstream.js`（AC-1）。
2. `bash run-gateway-baseline.sh` 产出归档文件并含 commit/环境元数据（AC-2）。
3. 审阅报告确认实测与估算分离（AC-3）。

## 回滚

- 纯新增脚本与文档，不影响任何运行时代码；删除目录即回滚。
