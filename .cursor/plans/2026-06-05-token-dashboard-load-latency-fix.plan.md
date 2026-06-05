---
name: Token dashboard load latency fix
overview: Token 消耗看板重启后打开慢（~30s）——根因是 7 路并发 /api/usage/* 在事件循环阻塞或线程池争用时集体挂起，且前端无超时/缓存。合并为单接口 + 专用线程池 + 前端 stale-cache。
todos:
  - id: t1-usage-dashboard-sync
    content: UsageStore 增加 dashboard_sync 单次连接批量查询
    status: in_progress
  - id: t2-api-dashboard-route
    content: 新增 GET /api/usage/dashboard 并走 settings 线程池
    status: pending
  - id: t3-frontend-single-fetch
    content: TokenDashboardPanel 单请求 + apiBase + 超时 + sessionStorage 缓存
    status: pending
  - id: t4-migrate-usage-pool
    content: 既有 /api/usage/* 路由改 run_in_settings_pool
    status: pending
isProject: false
---

# Token 消耗看板加载慢排查与修复

**Plan-Id**: 2026-06-05-token-dashboard-load-latency-fix
**Plan-File**: `.cursor/plans/2026-06-05-token-dashboard-load-latency-fix.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 根因（证据）

1. `TokenDashboardPanel` 打开时 `Promise.all` 并发 **7** 个 HTTP 请求（summary×3 + breakdown + daily + top-models + meta）。
2. 各路由使用 `asyncio.to_thread`（默认线程池），与 FTS backfill / persist / 记忆图谱 ingest 争用；事件循环被占住时连 `/api/session` 也 **3s+ 无响应**（本机复现）。
3. 前端 `fetch` **无超时**，`busy` 态需等全部 7 路完成才展示数值。
4. 组件读取 `store.backendUrl`（**不存在**），每次都走 `getApiBase()` IPC，且未复用已初始化的 `apiBase`。
5. `usage.sqlite` 仅 667 行 / 172KB，单查毫秒级——慢不在 SQL 本身，在**请求调度与后端阻塞**。

## 需求

- FR-1: 看板打开改为**单次**聚合 API，减少往返与锁竞争。
- FR-2: usage 查询走 `run_in_settings_pool`，与 persist 池隔离。
- FR-3: 前端展示**缓存快照**（stale-while-revalidate），刷新失败不 blank 已展示数据。
- FR-4: 单次请求 **10s** 超时并给出可读错误。
- AC-1: 后端空闲时，打开看板 **<1s** 展示数值。
- AC-2: 后端繁忙时，先展示上次缓存，后台刷新；超时显示错误而非无限「加载中…」。

## 改动范围

- `agenticx/runtime/usage_store.py` — `dashboard_sync`
- `agenticx/studio/server.py` — `/api/usage/dashboard` + 既有 usage 路由改 pool
- `desktop/src/services/usageApi.ts` — `fetchUsageDashboard`
- `desktop/src/components/TokenDashboardPanel.tsx` — 单请求 + 缓存 + 超时 + `apiBase`
