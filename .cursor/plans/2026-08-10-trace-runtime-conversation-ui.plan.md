# Portal Trace 运行时过程：双栏会话 UI（路径 B）

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: Composer 2.5

> 续作：在已落地的 `TraceTimeline` 聚合 API 之上，仅升级 admin-console **展示交互**，不引入额外追踪服务或第三方运行时依赖（对齐 ADR-0001）。

## Goal

Portal 日志详情抽屉与 `/traces/[traceId]` 全屏页展示双栏过程视图：左侧 observation 树 + 耗时条，右侧选中节点详情（元数据 / tokens / attrs / sources）。

## Architecture

- 数据源不变：`GET /api/traces/:traceId` → `TraceTimeline`
- 新建/重写 `TraceExplorer` 客户端组件，替换当前「仅列表树」的 `TraceTimelineInline` 主体
- `TraceNodeRow` 改为可选中；详情从行内展开改为右侧面板
- 禁止依赖额外追踪服务源码 / npm 包 / iframe

## In scope

- FR-1：双栏布局（左树右详情）
- FR-2：节点选中态；默认选中第一个 `model_step`，否则第一个根节点
- FR-3：左侧显示 kind 色点、label、duration 迷你条（相对 max duration）
- FR-4：右侧展示 status / duration / tokens / cost / attrs JSON / sources 链接列表
- FR-5：`portal-logs` Sheet 与 `/traces/[traceId]` 共用同一组件
- FR-6：zh/en i18n

## Out of scope

- OTLP 导出、自托管外部追踪服务、iframe 嵌入
- 改 `assembleTraceTimeline` 数据结构（除非 UI 缺字段且 attrs 已有）
- 审计页详情双栏（可后续复用组件）
- Prompt/completion 原文回填（当前 span 未必有；有则显示在 attrs）

## 落点

| 文件 | 改动 |
|---|---|
| `enterprise/apps/admin-console/src/components/trace-timeline-tree.tsx` | 实现 `TraceExplorer` + 可选中树行；`TraceTimelineInline` 内嵌 Explorer |
| `enterprise/apps/admin-console/src/app/traces/[traceId]/page.tsx` | 用 `TraceExplorer` 替换纯树列表 |
| `enterprise/apps/admin-console/src/app/portal-logs/page.tsx` | Sheet 加宽到 `sm:max-w-4xl`；继续用 Inline |
| `enterprise/apps/admin-console/messages/zh.json` / `en.json` | `traceRuntime.detail.*` 文案 |

## AC

- AC-1：点开带 `trace_id` 的 portal 日志详情，可见左右双栏，点击左侧节点右侧内容切换
- AC-2：`/traces/:id` 全屏页同一交互
- AC-3：`pnpm -C enterprise/apps/admin-console exec tsc --noEmit` 通过
- AC-4：无新增外部追踪服务依赖

## 续：本轮对话 I/O（2026-08-10 晚）

根因：`agent_token_traces` 只有计量字段，不含 prompt/工具/思考正文。对话落在 `chat_messages`（助手消息 `metadata.trace_id`）。

追加落点：
- `src/lib/trace-conversation-io.ts` + `GET /api/traces/[traceId]/conversation?expand=1`
- `TraceConversationPanel`：懒加载；默认截断 4000 字；展开上限 32k；附件只显示名/mime，不内联二进制
- 右侧栏上方「本轮对话」+ 思考过程拆分

采用骨架树先出、I/O 另请求、截断预览；不做额外分析数据库、Web Worker 或 iframe。

## no-scope-creep

只改 admin-console UI/API/i18n；不改 db-schema、web-portal 写路径、网关；不引入外部追踪服务。
