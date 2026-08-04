# Plan D：定时任务调度集群化 + 健康探针 + 优雅停机 + 多副本部署形态

Planned-with: kimi-k3
Suggested-Impl-Model: glm-5.2-max（相对样板的接线与部署工作，中档代码模型够用）
Status: pending-review
Parent-Plan: `.cursor/plans/pending/2026-08-04-agenticx-ha-roadmap.plan.md`
Depends-On: Plan A（任务定义存储走 backend）、Plan C（leader 锁复用 CoordinationBus/RedisBackend）；Plan B（优雅停机时 checkpoint 落盘）
Covers-Gap: G-004 + G-006，证据见 `research/codedeepresearch/agentscope/agentscope_ha_gap_analysis.md`

## 根因与证据链

- **G-004**：定时任务调度器 `AutomationScheduler` 在 **Electron 主进程**（`desktop/electron/main.ts:1061-1116`，30s `setInterval`，每分钟去重 key，任务读写走本地 JSON）。纯服务部署（无 Desktop）没有调度器；多副本若各自调度会重复 fire。注意：对标对象 AgentScope 此处同样是短板（`SchedulerManager` 每进程本地 restore，多副本重复 fire，E-014）——本 plan 直接做 leader 选举，属超越对标。
- **G-006**：`agx serve` 无健康探针（`agenticx/cli/main.py:613` 单进程 uvicorn，路由表中无 `/api/health`）；shutdown 路径（`agenticx/studio/server.py:1035-1037` 区域）只关闭 MCP，无在途任务处理。AgentScope 同样无探针（E-016），但其有优雅停机 cancel 在途 run 的语义（E-015）可对齐。

## In scope

新增：
- `agenticx/studio/automation_scheduler.py`
- `agenticx/runtime/coordination/leader.py`
- `deploy/ha-docker-compose/docker-compose.yml`
- `deploy/ha-docker-compose/nginx.conf`
- `docs/guides/ha-deployment.md`
- `tests/test_ha_scheduler_leader.py`
- `tests/test_ha_health.py`

修改（只允许这些文件）：
- `agenticx/studio/server.py`（**红线文件**：只精确增删目标行；提交前 `agx serve` 冷启动 smoke，`/api/session`、`/api/avatars`、`/api/sessions` 返回 200）
- `agenticx/cli/config_manager.py`（仅新增配置键）
- `desktop/electron/main.ts`（仅 FR-4 的模式开关接线，禁止重构 AutomationScheduler 其它逻辑）

## Out of scope

- 不改 cron/调度表达式语义（`shouldRun`/`isWithinDateRange` 的判定逻辑逐字保留）。
- 不改 `automation:*` 会话隔离规则与「每次触发新开 session」语义（`main.ts:1102-1104` 注释所述行为保留）。
- 不提供 K8s Helm chart；不做 systemd/supervisor 编排。
- 不动 Enterprise 现有 `enterprise/deploy/` 编排。
- 不迁移 Desktop 的 `emitAutomationTaskProgress` 等 UI 通知机制（服务端模式下进度经既有 SSE/轮询通路，不新增推送通道）。

## FR 与 AC

### FR-1：服务端 `AutomationScheduler`

落点：新建 `agenticx/studio/automation_scheduler.py`。

意图：把 `main.ts:1082-1116` 的 tick 逻辑**逐语义翻译**为 Python async 版（30s loop、分钟级去重 key、`enabled`/日期范围/`shouldRun`/`lastRunAt` 分钟前缀去重，判定规则与 TS 版一一对应），任务读写走 Plan A backend（`load_automation_tasks`/`save_automation_tasks`），触发执行复用 studio 现有「自动化触发执行」通路（与 `schedule_task` 工具触发态相同的执行器入口；实施者在 `agenticx/studio/server.py` 中定位现有手动触发 HTTP 路径并复用其内部函数，禁止复制一份执行逻辑）。

- 每 tick 前 `await leader_gate.am_i_leader()`（FR-2），非 leader 直接跳过。
- fire 前写 `lastRunAt` 采用「先 save 后 execute」顺序（与 TS 版 `main.ts:1100-1115` 一致），防 leader 切换同分钟重 fire。
- 开关：env `AGX_AUTOMATION_SCHEDULER` > `runtime.automation.scheduler`，取值 `electron`（默认，现状）/ `server`。HA 模式（`AGX_HA_MODE=redis`）默认 `server`。

**AC-1**：`tests/test_ha_scheduler_leader.py::test_tick_semantics_parity`：固定任务集 + 冻结时间，Python tick 与 TS tick 的判定结果（哪些 task 被 fire）一致（用例直接翻译 TS 判定分支：disabled、日期范围外、时间不匹配、同分钟已跑）。

### FR-2：Leader 选举

落点：新建 `agenticx/runtime/coordination/leader.py`。

- `LeaderGate`：key `agenticx:leader:automation`，`SET {instance_id} NX PX 30000`；leader 每 10s renew（Lua compare-and-expire，同 Plan C 锁原语，**必须复用** `RedisBackend` 连接）；失去锁（renew 失败）立即停止 fire。
- InProcess/单机模式：`am_i_leader()` 恒 True（零行为变化）。
- 启动时随机 0-3s jitter 再首次竞选，防多副本同拍抢锁。

**AC-2**：`test_leader_election_single_firer`：两个 `LeaderGate` 实例共享 fakeredis，同一时刻仅一个 `am_i_leader()` 为 True；kill leader（停止 renew）后 35s 内另一个成为 leader。

### FR-3：健康探针与优雅停机

落点：`agenticx/studio/server.py`（红线，精确增行）。

- `GET /api/health`：liveness，恒 200 `{"status":"ok"}`（不触任何依赖）。
- `GET /api/ready`：readiness——`storage.ping()`（Plan A）+ `bus.ping()`（Plan C）全过才 200，任一失败 503 `{"status":"not_ready","detail":{...}}`；单机 local/inprocess 模式下两者恒 True。
- 优雅停机：lifespan shutdown 序列（现有 `GlobalMcpManager.close_all()` 调用点 `server.py:1035` **之前**）插入：(1) 置 `app.state.draining = True`，`/api/chat` 在 draining 时对新请求返回 503 SSE 错误事件 `{"type":"error","error":"server_draining"}`；(2) 等待在途 run 数归零，上限 `AGX_DRAIN_TIMEOUT_SEC`（默认 15s）——在途 run 的 checkpoint 已由 Plan B 每轮落盘，此处只等不落；(3) 再走现有 close_all 等收尾。
- 在途 run 计数：`session_manager` 维护 `_active_runs: int`（run_turn 进出 +/-1），server  shutdown 轮询该值。

**AC-3**：`tests/test_ha_health.py::test_health_ready`：local 模式两探针 200；mock storage.ping=False 时 ready 503。
**AC-4**：`test_draining_rejects_new_chat`：draining 状态下 POST /api/chat 收到 `server_draining` 错误事件；已在运行的会话不受影响直至完成。

### FR-4：Desktop 侧模式接线（最小改动）

落点：`desktop/electron/main.ts`。

- `AutomationScheduler.start()`（1065）调用前增加判断：若配置 `runtime.automation.scheduler === "server"`（经既有 config 读取 IPC），则**不启动** Electron 侧调度（避免双 fire）；默认缺省 = 现状启动。
- 禁止改动 `tick`/`executeTask`/`shouldRun` 等既有逻辑。

**AC-5**：`npm run dev` 手工冒烟：默认配置下定时任务照常触发（与 main 一致）；设 server 模式后 Electron 不再触发、服务端触发可见。

### FR-5：多副本部署示例与文档

落点：新建 `deploy/ha-docker-compose/` 与 `docs/guides/ha-deployment.md`。

- `docker-compose.yml`：`redis:7` + 2 个 `agx serve` 副本（env：`AGX_HA_MODE=redis`、`AGX_REDIS_URL=redis://redis:6379/0`、`AGX_AUTOMATION_SCHEDULER=server`）+ `nginx`。
- `nginx.conf`：upstream 两副本；sticky 策略 = 按请求头/参数中的 session 维度 hash（`hash $arg_session_id` 兜底 `$remote_addr`；chat 请求体里的 session_id 无法参与 hash，文档中说明该限制与「会话锁兜底」的关系：打错副本会收到 `session_busy_elsewhere`，客户端应重试另一副本或由 LB 重试）。
- `ha-deployment.md`：架构图（mermaid）、配置项清单（本路线图全部新增 env/config 键）、已知限制（MCP stdio 每副本独立、taskspaces 本机目录不共享、FTS 每副本各自 backfill 建议 `AGX_SESSION_FTS=0` 选一）、滚动重启操作步骤、故障接管验证步骤。

**AC-5**：`docker compose -f deploy/ha-docker-compose/docker-compose.yml up` 可起栈；文档中「故障接管验证」章节步骤可手工复现：A 副本会话进行中 `docker stop` A，B 副本 resume 接管（依赖 Plan B/C 已落地）。

## 发现的非目标问题（记录，不修）

- nginx 无法按请求体 session_id 路由是通用限制；彻底解需要客户端携带 session 上下文到 header/query，列入后续 Desktop/API 契约演进，不在本 plan。
- Electron 与 server 双调度器并存期间的切换抖动（同分钟双 fire 风险）由 `lastRunAt` 分钟前缀去重兜底，文档中注明切换步骤（先停 Desktop 再切）。

## 验证

```bash
pytest tests/test_ha_scheduler_leader.py tests/test_ha_health.py -v
agx serve --host 127.0.0.1 --port 17502 &  # 冷启动 smoke（server.py 红线）+ curl /api/health /api/ready
docker compose -f deploy/ha-docker-compose/docker-compose.yml up --build  # 端到端：双副本 + kill 接管 + 定时任务单 fire
```
