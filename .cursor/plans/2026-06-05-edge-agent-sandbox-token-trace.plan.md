---
name: 智能体沙箱运行时与词元消耗路径追踪
overview: 把 edge-agent 空壳落地为最小可用的「智能体沙箱执行 + 词元消耗链路追踪」：受限子进程沙箱执行智能体动作，经网关计量并把每步 token 消耗串成可视 trace，admin/portal 提供调试视图。
todos:
  - id: t1-sandbox-runtime
    content: edge-agent 实现最小受限沙箱（隔离工作目录/超时/资源上限）
    status: completed
  - id: t2-trace-model
    content: 定义词元追踪 span 结构（按 agent step 关联 usage）
    status: completed
  - id: t3-trace-collect
    content: 沙箱内动作经网关计量回传，串联 trace 落存储
    status: completed
  - id: t4-debug-ui
    content: admin/portal 调试视图展示 step→token 消耗路径
    status: completed
  - id: t5-smoke
    content: 冒烟测试覆盖沙箱执行、超时、trace 串联
    status: completed
isProject: false
---

# 智能体沙箱运行时与词元消耗路径追踪

**Plan-Id**: 2026-06-05-edge-agent-sandbox-token-trace
**Plan-File**: `.cursor/plans/2026-06-05-edge-agent-sandbox-token-trace.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：`enterprise/apps/edge-agent/cmd/edge-agent/main.go` 仅是打印 skeleton + 6 条 TODO 的空壳，`docs/security-model.md` 仅有设计；Desktop 实际链路走内嵌 `agx serve`，不经 edge-agent。Portal 聊天有会话级 token badge，但**无沙箱、无 agent 级词元追踪/调试面板**。客户要求「沙箱环境验证智能体行为」「调试工具追踪词元消耗路径」。本 plan 落地**最小可演示**版本，范围严格限定 edge-agent + 一个调试视图，不重构 Desktop 链路。

## 需求

- FR-1（沙箱）: edge-agent 提供受限执行：独立临时工作目录、命令/工具超时、基础资源上限（进程/内存/网络白名单），执行智能体的工具动作并回收结果。
- FR-2（追踪模型）: 定义 trace span：`trace_id`（一次 agent 任务）→ `step`（每次模型调用/工具调用）→ 关联该步 usage（input/output/reasoning tokens、成本）。
- FR-3（采集）: 沙箱内对模型的调用经网关（带 trace 头），网关计量回传后按 `trace_id/step` 串联，落 trace 存储（PG 或 JSONL 兜底）。
- FR-4（调试视图）: admin 或 portal 提供 trace 视图：按 step 展示词元消耗路径与累计成本、耗时。
- NFR-1: 沙箱为可选组件，不影响现有 Desktop/agx serve 链路；默认关闭，显式启用才生效。
- NFR-2: 沙箱须 fail-safe：超时/越权动作被拒并记录，不得逃逸工作目录。
- AC-1: 在沙箱执行一个含 2 步模型调用的任务，生成含 2 个 step 的 trace 且 token 合计与各步之和一致。
- AC-2: 设置超时的动作被中止并在 trace 标记失败。
- AC-3: 沙箱内尝试越权写工作目录外路径被拒。

## 改动范围（严格）

1. `enterprise/apps/edge-agent/`
   - `internal/sandbox/`（新）：受限执行器（临时 dir、超时、白名单）。
   - `internal/trace/`（新）：trace/span 结构与写出（PG 或 JSONL）。
   - `cmd/edge-agent/main.go`：装配最小服务（接收任务 → 沙箱执行 → 经网关计量 → 落 trace）。
2. `enterprise/apps/gateway/internal/`
   - 透传 `trace_id`/`step` 头并在 usage 上报时携带，供 edge-agent 关联（仅加字段透传，不改计量算法）。
3. `enterprise/apps/admin-console/`（或 web-portal 二选一，优先 admin）
   - trace 查询 API + 调试视图（step→token 路径）。
4. 文档：`enterprise/apps/edge-agent/docs/` 更新为实际能力（去除「不可演示」标注的对应项）。

不动：Desktop 内嵌 agx serve 链路、Machi 运行时、Go 网关计量算法。

## 验证步骤

1. `cd enterprise/apps/edge-agent && go test ./internal/...`（沙箱超时/越权/ trace 串联，AC-1/2/3）。
2. 本地起 edge-agent + 网关，跑一个两步任务，查 trace 视图与 token 合计核对。

## 回滚

- edge-agent 为独立可选二进制，默认不启用；网关仅新增头透传；trace 视图为新增页。整体可摘除不影响主链路。
