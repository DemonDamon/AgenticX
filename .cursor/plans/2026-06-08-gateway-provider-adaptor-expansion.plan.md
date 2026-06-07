---
name: Gateway LLM Provider 协议 adaptor 扩展（Bedrock + Azure + OpenAI-compatible 泛化）
overview: 网关当前只有 3 个原生协议族（openai/claude/gemini），其余 ProviderType 一律 fallthrough 到 openai。借鉴 Higress ai-proxy 协议映射，新增 Bedrock（SigV4 Converse）与 Azure OpenAI（deployment 路径映射）两个原生 adaptor，并把 OpenAI-compatible 泛化为显式 ProviderType，使火山/千问/DeepSeek 等长尾仅靠配置即可接入。仅改 enterprise/apps/gateway，不动 agenticx/。
todos:
  - id: t1-providertype
    content: 在 adaptor/factory_for.go 增加 bedrock/azure case；Factory 注册新 adaptor，openai-compatible 显式归入 openai 分支
    status: completed
  - id: t2-azure-adaptor
    content: 新增 adaptor/azure.go（实现 Adaptor 接口；deployment 路径与 api-version 映射，复用 openai 报文转换）
    status: completed
  - id: t3-bedrock-adaptor
    content: 新增 adaptor/bedrock.go（SigV4 签名 + Converse API 请求/响应/流式转换为 OpenAI 报文）
    status: completed
  - id: t4-admin-template
    content: admin-console Provider/Channel 新建向导增加 bedrock/azure 模板字段（region/deployment/api-version）
    status: completed
  - id: t5-smoke
    content: go test 覆盖 factory 路由、azure 路径映射、bedrock 签名与流式转换；admin typecheck
    status: completed
isProject: false
---

# Gateway LLM Provider 协议 adaptor 扩展

**Plan-Id**: 2026-06-08-gateway-provider-adaptor-expansion
**Plan-File**: `.cursor/plans/2026-06-08-gateway-provider-adaptor-expansion.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**优先级**: P0（顺序第 1）
**依赖**: 无
**调研依据**: `research/codedeepresearch/higress/higress_enterprise_gap_analysis.md`（G-H1）；`higress_proposal.md` §4.4

## 背景 / 现状（已直读核验）

- `enterprise/apps/gateway/internal/adaptor/factory_for.go` L14-23：`For(ch)` 仅识别 `openai/openai-compatible`、`claude/anthropic`、`gemini/google`，`default` 一律返回 `f.openai`。
- `adaptor/factory.go`：`Factory` 结构只有 `openai/claude/gemini` 三个字段。
- `adaptor/adaptor.go` L14-19：`Adaptor` 接口 = `Name() / Complete() / Stream() / Embeddings()`。
- 对照 Higress `plugins/wasm-go/extensions/ai-proxy/provider/`（60 个文件，40+ provider），Enterprise 原生协议覆盖明显偏少。
- 火山/千问/DeepSeek 等已可走 openai-compatible，但**无显式 ProviderType**，运维只能靠 baseURL 约定，易混淆。

**目标**：新增 Bedrock、Azure 两个真原生 adaptor + 显式 openai-compatible 类型，长尾 provider 靠配置接入。

## 需求

- FR-1: `Factory` 新增 `azure`、`bedrock` 两个 `Adaptor` 字段，`NewFactory` 注册 `NewAzureAdaptor()`、`NewBedrockAdaptor()`。
- FR-2: `factory_for.go` 的 `switch` 增加：`case "azure": return f.azure`、`case "bedrock", "aws-bedrock": return f.bedrock`；`openai-compatible` 继续走 openai 分支（保持兼容，但语义显式）。
- FR-3: `adaptor/azure.go` 实现 `Adaptor`：
  - 请求 URL = `{baseURL}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`；
  - `deployment` 取 `Channel.Metadata["deployment"]`（缺省回退 `req.Model`）；`apiVersion` 取 `Channel.Metadata["apiVersion"]`（缺省 `2024-02-01`）；
  - 鉴权用 `api-key: {APIKey}` header（非 `Authorization: Bearer`）；
  - 报文转换复用 openai adaptor 的 Complete/Stream/Embeddings 报文结构（仅 URL/header 差异）。
- FR-4: `adaptor/bedrock.go` 实现 `Adaptor`：
  - 目标 = AWS Bedrock `Converse` / `ConverseStream` API；
  - 用 AWS SigV4 对请求签名（`region` 取 `Channel.Region` 或 `Metadata["region"]`，`service="bedrock"`，AK/SK 取 `Channel.APIKey` 格式 `ak:sk` 或 `Metadata["accessKeyId"]/["secretAccessKey"]`）；
  - 请求体 OpenAI messages → Bedrock `messages`/`system`；响应 Bedrock `output.message` → OpenAI choices；流式 `ConverseStream` event → OpenAI StreamChunk；
  - Embeddings 暂不支持时返回明确错误 `bedrock: embeddings not supported`（不静默回退）。
- FR-5: admin-console Provider/Channel 新建/编辑向导：当 `providerType=azure` 显示 `deployment`/`apiVersion` 字段，`providerType=bedrock` 显示 `region`/`accessKeyId`/`secretAccessKey` 字段，写入 `Channel.Metadata`。
- NFR-1: 不改变现有 openai/claude/gemini 行为（零回归）。
- NFR-2: 新 adaptor 全部走现有 `relay/` 重试、`channel/picker` 选路、quota/audit/metering 链路，不旁路。
- NFR-3: SigV4 实现不引入重型 AWS SDK；用标准库 `crypto/hmac`+`sha256` 自实现签名（参考 Higress `provider/bedrock.go` 思路，按 Apache-2.0 在文件头标注来源）。
- AC-1: `factory_for.For(ch{ProviderType:"azure"})` 返回 azure adaptor；`"bedrock"` 返回 bedrock adaptor；未知类型仍返回 openai。
- AC-2: azure adaptor 构造的 URL 含 deployment 与 api-version；header 用 `api-key`。
- AC-3: bedrock adaptor 对固定输入产出确定 SigV4 `Authorization` 头（用固定时间戳的单测断言签名串）。
- AC-4: bedrock 流式把 ConverseStream mock 事件转成 OpenAI StreamChunk 序列。
- AC-5: admin typecheck 通过；向导按 providerType 条件渲染字段。

## 改动范围（严格）

### 修改
1. `enterprise/apps/gateway/internal/adaptor/factory.go`：`Factory` 增 azure/bedrock 字段 + `NewFactory` 注册。
2. `enterprise/apps/gateway/internal/adaptor/factory_for.go`：`switch` 增 case。
3. `enterprise/apps/admin-console/src/lib/gateway-channels-store.ts`（或 Provider 向导组件）：新增 providerType 模板字段。
4. admin Channel 新建/编辑表单组件（`src/app/...` 下 gateway channels 页）：条件字段。

### 新增
5. `enterprise/apps/gateway/internal/adaptor/azure.go` + `azure_test.go`
6. `enterprise/apps/gateway/internal/adaptor/bedrock.go` + `bedrock_test.go`
7. （可选）`enterprise/apps/gateway/internal/adaptor/sigv4.go`（SigV4 工具，附 NOTICE 来源）

### 不动
- openai/claude/gemini adaptor 报文逻辑；`relay/`、`quota/`、`audit/`、`metering/`、`policy/`。
- `agenticx/` Python SDK、`desktop/`。

## 关键数据结构

```go
// factory.go
type Factory struct {
    openai  Adaptor
    claude  Adaptor
    gemini  Adaptor
    azure   Adaptor // 新增
    bedrock Adaptor // 新增
}
```

Channel.Metadata 约定键：`deployment`、`apiVersion`（azure）；`region`、`accessKeyId`、`secretAccessKey`（bedrock）。

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/adaptor/... -count=1`（AC-1~AC-4）。
2. `cd enterprise/apps/gateway && go build ./...`。
3. `pnpm -C enterprise exec turbo run typecheck --filter=admin-console`（AC-5）。
4. 手动：admin 新建 azure channel，前台聊一条，确认走 azure URL（mock 或真 key）。

## 规范备注（务必遵守）

- **no-scope-creep**：仅实现上述 FR；不顺手重构 openai adaptor、不改 routing/decider。
- **commit**：用 `/commit --spec=.cursor/plans/2026-06-08-gateway-provider-adaptor-expansion.plan.md`，commit message 必须含：
  - `Plan-Id: 2026-06-08-gateway-provider-adaptor-expansion`
  - `Plan-File: .cursor/plans/2026-06-08-gateway-provider-adaptor-expansion.plan.md`
  - `Made-with: Damon Li`
- **只 git add 本任务直接改动文件**，不夹带无关已修改文件。
- **Apache-2.0**：SigV4/bedrock 转换若参考 Higress 源码，文件头注明 `// Adapted from higress-group/higress ai-proxy (Apache-2.0)`。
- 中文回复用户；技术术语可保留英文。

## 回滚

- 删除 azure/bedrock 文件 + 还原 factory 两处；未知 providerType 行为回到全部 fallthrough openai，无数据迁移。
