# @agenticx/feature-tools-mcp 模块总结

> 结论重新生成时间：2026-07-21
> 判定口径：以 `enterprise/features/tools-mcp` 源盘为准，并交叉核对 enterprise 内真实落点（已逐路径核对存在性与行数）。

## 一句话判定

**本 feature 包是纯占位 stub**（仅一行常量导出）；但「工具 · MCP 接入」的**真实能力已分散实现于 enterprise 多处**——gateway 的 Go 侧 host/proxy 双模式（合计 2300+ 行 Go）、admin-console 的 MCP 管理 UI（834 行）+ API（281 行）、db-schema 的 `mcp_servers / mcp_tools / enterprise_runtime_mcp_servers` 表。本包未来若落地，预期是把 admin-console 的 MCP 管理 UI 下沉为复用包。

## 模块概述

`@agenticx/feature-tools-mcp` 预留给「工具 · MCP 接入」能力。当前**包本身未实现**，仅作为 workspace 占位；实际功能已在 enterprise 其他包内实现，且**最重的能力在 Go 网关侧**。

## 目录结构（已逐文件核对）

```
features/tools-mcp/
├── README.md            # 9 行，仅写包名 + 一句 import 示例
├── package.json         # @agenticx/feature-tools-mcp v0.1.0，private，lint 为 placeholder
├── src/index.ts         # 4 行：featureName 常量 + // TODO: implement
├── tsconfig.json
└── tsconfig.tsbuildinfo
```

无 `lib/`、无 `components/`、无 `api/`、无测试目录。

## 关键导出

仅：
```ts
export const featureName = "tools-mcp" as const;
```

`package.json` 的 `lint` script 为 `echo 'lint placeholder'`。无运行时产物。

## 状态（诚实判定）

**本包尚未实现 / 纯 stub。** 源代码只有一行常量声明 + `// TODO: implement` 注释。

**但实际功能已分散在 enterprise 多处真实实现**（下节逐项核对）。

## 真实代码落点（能力实际在哪）

### 1. 网关侧（Go，最核心，运行时承载者）

| 子能力 | 真实落点 | 行数 | 说明 |
|---|---|---|---|
| MCP host 模式 | `apps/gateway/internal/mcphost/` | **1657 行 Go** | 网关本身说 MCP（streamable-http + SSE），支持 OpenAPI 自动转 MCP tools；含 `host.go / backend.go / backend_echo.go / backend_openapi.go / openapi_loader.go / protocol.go / registry.go / scopes.go / transport.go / transport_sse.go / types.go` + 集成测试 |
| MCP proxy 模式 | `apps/gateway/internal/mcp/` | **670 行 Go** | `httputil.ReverseProxy` 反向代理到外部 MCP server；含 `handler.go / loader.go / parse.go / registry.go` + 各自测试 |

### 2. 管理侧（admin-console，TS）

| 子能力 | 真实落点 | 行数 | 说明 |
|---|---|---|---|
| 管理 UI | `apps/admin-console/src/app/admin/mcp-servers/page.tsx` | **834 行** | MCP server 管理页 |
| 管理 API | `apps/admin-console/src/app/api/admin/mcp-servers/` | 190 行 | `route.ts` (54) + `[id]/route.ts` (68) + `[id]/openapi/route.ts` (33) + `[id]/stats/route.ts` (35) |
| Proxy 管理 API | `apps/admin-console/src/app/api/admin/mcp-proxy-servers/` | 91 行 | `route.ts` (36) + `[id]/route.ts` (55) |
| **管理 API 合计** | — | **281 行** | — |

### 3. 数据层（db-schema）

| 子能力 | 真实落点 | 行数 | 说明 |
|---|---|---|---|
| MCP server 表 | `packages/db-schema/src/schema/mcp-servers.ts` | 30 行 | `mcp_servers` 表定义 |
| MCP tool 表 | `packages/db-schema/src/schema/mcp-tools.ts` | 29 行 | `mcp_tools` 表定义 |
| 运行时配置 | `packages/db-schema/src/schema/runtime-config.ts` | 166 行 | 含 `enterprise_runtime_mcp_servers`（迁移文件 `0025` / `0028`） |

> 关键修正：旧结论写的是 `packages/db-schema/schema/...`，实际路径是 `packages/db-schema/src/schema/...`（多一层 `src/`）。表名 `mcp_servers / mcp_tools / enterprise_runtime_mcp_servers` 均已核对存在。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/gateway` | **运行时承载者** | MCP host（1657 行）+ proxy（670 行）都在 Go 网关侧 |
| `apps/admin-console` | **当前已自实现** | MCP 管理 UI（834 行）+ API（281 行） |
| `packages/db-schema` | **schema** | `mcp_servers / mcp_tools / enterprise_runtime_mcp_servers` |

## 未来收敛方向

本包未来可能把散落在 admin-console 的 MCP 管理 UI / API 下沉为**复用包**（TS 侧），供 admin-console 与潜在的其他管理端共用；Go 网关侧的 host/proxy 实现是运行时核心，不会进本 TS feature 包。

## 完成度判定

| 维度 | 状态 |
|---|---|
| 包骨架（package.json / tsconfig / index.ts） | ✅ 存在 |
| 本包业务逻辑 / 组件 / API | ❌ 无（纯 stub） |
| 网关 host 模式（Go） | ✅ `mcphost/` 1657 行 |
| 网关 proxy 模式（Go） | ✅ `mcp/` 670 行 |
| 管理 UI | ✅ admin-console mcp-servers/page.tsx 834 行 |
| 管理 API | ✅ admin-console mcp-servers + mcp-proxy-servers 281 行 |
| DB schema | ✅ db-schema 三张表 |
| **整体** | **本包纯 stub，但 enterprise 侧能力已实质落地（最重在 Go 网关）** |
