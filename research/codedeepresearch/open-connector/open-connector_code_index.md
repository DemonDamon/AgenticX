# open-connector Code Index

## Provenance
- local clone SHA: `eb4cb13921cfa489cea2efdbd9df56a84eebe4c1` (main, shallow, remote https://github.com/oomol-lab/open-connector)
- GitHub MCP: unavailable（会话未挂载；Issue/PR 历史 not retrieved）
- ZRead: unavailable

## Core tree
```text
open-connector/
├── src/
│   ├── server/            # HTTP 边界：connect-server.ts(路由注册)、api/(runtime-api、openapi、auth、connection-routes)、actions/、storage/、secrets/、proxy/、cloudflare/
│   ├── mcp.ts             # MCP 端点：5 工具、无状态 Streamable HTTP
│   ├── providers/         # 1,579 个 provider 目录 + provider-runtime.ts / provider-loader.ts / mcp-client.ts / mcp-tools.ts
│   │   └── <service>/     # definition.ts / actions.ts / executors.ts（+ runtime-*.ts / scopes.ts / trigger-*.ts）
│   ├── core/              # catalog、action-policy、action-search、guarded-fetch、json-schema、aws-sigv4、cast
│   ├── marketplace/       # OOMOL 托管 SaaS 动作市场客户端
│   ├── oauth/             # OAuth 流程、token 刷新、client 配置
│   ├── catalog-store.ts   # 生成目录的内存视图
│   └── triggers/          # Provider Triggers
├── web/                   # Web Console（Vite workspace）
├── migrations/            # SQLite/PG 迁移
├── scripts/               # generate-catalog、generate-provider-registry、build-binary 等
├── docs/                  # runtime-api、catalog-format、headless、credentials、configuration…
├── examples/              # mcp-client、openai-tools、local-http、homebox-live-check、weixin-bot-login
└── deploy/helm, docker/   # 部署物
```
语言构成：TypeScript 为主（6,681 个 .ts，绝大多数在 src/providers）；License Apache-2.0；monorepo（runtime + web workspace）。

## Files actually read
| File | Evidence category | Symbols inspected |
|---|---|---|
| `README.md` | 公共入口 | 定位、徽章数据源、部署矩阵、License scope |
| `docs/headless.md` | 公共入口/API + 扩展点 | createConnectorRuntime、options 表、getConnectorBuildOptions |
| `docs/catalog-format.md` | 核心抽象 + 扩展点 | 目录生成流程、执行状态四态 |
| `src/server/connect-server.ts`（grep 路由注册 204-416 行） | 公共入口/API | app.get/post/route 全量路由 |
| `src/mcp.ts` | 主执行路径 + 错误处理 | mcpToolConfigs、createMcpServer、handleMcpRequest、executeAction、errorPayload |
| `src/core/provider-definition.ts` | 核心抽象 | defineProviderAction |
| `src/providers/github/definition.ts` | 核心抽象 | provider（auth 授权项/risk 分级） |
| `src/providers/github/executors.ts` | 主执行路径 | executors/proxy/credentialValidators/triggers |
| `src/providers/provider-loader.ts` | 主执行路径 | ExecutorModules、ProviderLoader.loadActionExecutor |
| `src/providers/provider-runtime.ts`（grep 导出符号） | 错误/回退 | providerInputError/providerResponseError/createProviderTimeout/isAbortLikeError/defineProviderProxy/defineProviderExecutors |
| `src/providers/mcp-tools.ts` | 错误/回退 + 扩展点 | listMcpTools/callMcpTool、列表限额 |
| `src/marketplace/marketplace-service.ts` | 核心抽象 | MarketplaceDiscovery/MarketplaceService |
| `src/catalog-store.ts`（1-80 行） | 核心抽象 | CatalogStore/ActionExecutionStatus |
| `src/mcp.test.ts`（110-134 行） | 测试 | 工具摘要/指令测试 |
| `.codex/skills/add-provider/SKILL.md`（1-25 行） | 扩展点 | add-provider 工作流 |
| `package.json` | 公共入口 | scripts、依赖、workspace |

## Key symbols
| Symbol | SHA + path:line-range | Responsibility |
|---|---|---|
| handleMcpRequest | eb4cb13 src/mcp.ts:182-189 | 单请求无状态 MCP 服务 |
| mcpToolConfigs | eb4cb13 src/mcp.ts:60-125 | 5 个发现型工具契约 |
| executeAction | eb4cb13 src/mcp.ts:320-376 | 策略+连接校验后调用 ActionRunner |
| ProviderLoader.loadActionExecutor | eb4cb13 src/providers/provider-loader.ts:64-77 | 执行期动态 import 执行器 |
| defineProviderAction | eb4cb13 src/core/provider-definition.ts:27-44 | action 声明（id=service.name） |
| provider (github) | eb4cb13 src/providers/github/definition.ts:24-92 | provider 元数据 + OAuth 授权项模型 |
| createConnectorRuntime | eb4cb13 docs/headless.md:32-38（文档入口） | headless 嵌入运行时 |
| MarketplaceService | eb4cb13 src/marketplace/marketplace-service.ts:90+ | OOMOL SaaS 动作市场接入 |

## Search coverage
- Paths: src/server、src/mcp.ts、src/providers（root + github/）、src/core、src/marketplace、src/catalog-store.ts、docs/、examples/、.codex/skills/、scripts/
- Exact symbols: handleMcp、listMcpToolSummaries、createMcpServer、defineProviderAction、ProviderLoader、createConnectorRuntime、getConnectorBuildOptions、providerInputError、createProviderTimeout
- Synonyms: catalog、marketplace、executor、lazy、connection、policy、runtime token
- Protocol/config fields: mcpServers、operationType、requiredScopes、locallyExecutable、catalogOnly、runtimeToken、actionPolicy
- 统计命令：`ls src/providers | wc -l`（1,579 目录）、`find … -name executors.ts | wc -l`（1,578）、`grep -c defineProviderAction(`（11,464）

## High-signal Issue/PR history
- not retrieved（GitHub MCP 不可用，未做远端检索）
