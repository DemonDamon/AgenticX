# Enterprise 文档：补实、Mermaid→SVG、英文 sibling

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Cursor Grok 4.6

## Goal

让官网 [Enterprise Docs](https://www.agxbuilder.com/en/enterprise/docs) 三件事同时成立：过简页对照 `enterprise/` 源码可独立读完；剩余 Mermaid 换成与框架文档同一套管线的主题化 SVG；切英文不再回退中文并弹出横幅。

## Architecture

Enterprise 文档**不是**框架文档的 TS content map，而是读磁盘 Markdown：

| 角色 | 路径 |
|------|------|
| 中文权威 | 主仓 `enterprise/docs/` |
| 网站拷贝 | `AgenticX-Website/content/enterprise/` |
| 同步 | `AgenticX-Website/scripts/sync-enterprise-docs.sh`（`rsync --delete`） |
| 加载 | `src/lib/enterprise-docs/load-doc.ts`：`locale=en` 找 `<slug>.en.md` 或 `README.en.md`，没有则读中文且 `fallbackUsed=true` |
| 横幅 | `src/components/enterprise-docs/content.tsx` + `en.ts` `englishUnavailableBanner` |
| 渲染 | 与框架同一 `MarkdownRenderer` / `DocsInlineSvg`（`/docs/svg/` 已内联） |

54 页里当时只有 8 页有 `.en.md` → `/en/...` 必出横幅。英文只存在网站仓；再跑未改过的 sync 会删光全部 `.en.md`。

## In scope

- 改 sync：`--exclude '*.en.md'`、`--exclude '.synced-at'`、`--exclude '.DS_Store'`
- 对照源码补实过简中文页（网站 + 主仓 `enterprise/docs/` 同步，避免下次 sync 回退）
- 11 处 Mermaid（中文 11、英文译本 9）换成 `/docs/svg/<stem>-<zh\|en>.svg?v=2` + 图注
- 为全部缺英文的 slug 写 sibling `.en.md`（含本次补实页）
- 已有英文页补缺口（index 后半、`gateway/overview.en.md` 缺的 Channel 图、data-flow 换 SVG）

## Out of scope

- 不重写已有长文（policy-engine、env-vars、local-dev 等只译不扩写）
- 不改 `DocsInlineSvg` / `load-doc.ts` 加载约定
- 不承诺仓库未落地能力（压测现场基线、`apps/edge-agent` 闭环、部门/用户级配额作为一等产品 UI）
- 不把客户名、竞品对标写进 commit / plan
- 不改 `agenticx/studio/server.py`
- 不提交 `next-env.d.ts`

## Honesty constraints（写进正文，禁止编造）

- Gateway 上游是 Go `net/http` OpenAI 兼容客户端，**不是** LiteLLM
- `apps/edge-agent` 仍是 skeleton；端侧闭环描述 Desktop 内嵌 `agx serve`
- 配额：`quota.Tracker` / `selectRuleExtended` 支持 PAT → user → dept → model → role 回退，字段含 monthly / daily / weekly / TPM / RPM / `MaxConcurrency`；admin「额度控制」页仍偏查询展示，部门/用户级作为一等产品 UI 未承诺
- Key failover 源码：`internal/keypool/pool.go` + `relay.IsKeyRetryable`（401/403/429/5xx/网络错；连续失败 ≥3 进入 60s cooldown）
- MCP：`GATEWAY_MCP_HOSTING=on` 才挂路由；内置 `demo` echo；backend 现为 `echo` / `openapi`（`custom-go` 留口）
- 图注写「示意图 / Diagram」，禁止「官方截图」

---

### Task 1: 保护网站英文译本

**Files:**
- Modify: `AgenticX-Website/scripts/sync-enterprise-docs.sh`

**Before:** `rsync -av --delete --exclude='*.swp' --exclude='.DS_Store'`

**After:** 增加 `--exclude '*.en.md' --exclude '.synced-at'`（`.DS_Store` 已有）。DEST 指向 `content/enterprise/`，SRC 默认 `../AgenticX/enterprise/docs`（脚本里是 `${PROJECT_ROOT}/../AgenticX/enterprise/docs`，本机实际为 sibling 或 `ENTERPRISE_DOCS_SRC`）。

---

### Task 2: 对照源码补实过简页

中文同时改网站拷贝与主仓 `enterprise/docs/` 同相对路径。英文只写网站 `.en.md`。

#### 2a. `gateway/mcp-hosting-overview.md`（现 9 行 stub）

对照：

- `enterprise/apps/gateway/internal/mcphost/host.go`（`HostingEnabled`、`ResolveServer`、builtin `demo`）
- `internal/mcphost/registry.go`（`mcp_servers` / `mcp_tools`）
- `internal/server/mcp_handlers.go`（`GET /mcp/registry`、`POST /mcp/{server}/streamable-http`、`GET /mcp/{server}/sse`、`POST /mcp/{server}/messages`）
- `runbooks/mcp-hosting.md`、`architecture/mcp-hosting.md`

写成可独立读的页，含：开关、端点表、scope、限流、审计字段、Admin `/admin/mcp-servers`、与架构/runbook 交叉链接、一张 `ent-mcp` SVG。不要只留指针。

#### 2b. `gateway/keypool-pat-overview.md`（现 47 行客户摘要）

对照：

- `internal/keypool/pool.go`（`ResolveWithRef`、directKey 优先、env 名轮转、failureThreshold=3、cooldown 60s）
- `internal/relay/executor.go` `IsKeyRetryable`（401/403/429/≥500）
- `internal/auth/pat.go`（`agx-pat-`、SHA-256、`api_tokens`、LRU ~60s、`last_used_at` 60s flush）
- `internal/quota/check_request.go` `selectRuleExtended`
- 姊妹页 `gateway/api-tokens.md`

补：failover 条件、Key 不落库明文、配额选择顺序、诚实「UI 仍偏租户展示」、`ent-keypool` SVG。

#### 2c. 索引 `README.md` / `README.en.md`

中文目录补：`gateway/keypool-pat-overview.md`、`gateway/mcp-hosting-overview.md`、`gateway/api-tokens.md`、`architecture/cache-and-pricing.md`、`architecture/mcp-hosting.md`、`architecture/protocol-translation.md`、`observability/README.md`。英文补中文后半：部署清单、ADR、验收销售、与 Desktop 对照表、成熟度图例。

#### 2d. 其它 thin stub（扩写到可独立读，不重写长文）

| 文件 | 对照源码 / 姊妹页 |
|------|-------------------|
| `architecture/mcp-hosting.md` | mcphost Host / Registry / Backend / Transport；去掉 ASCII 树，改 SVG |
| `architecture/cache-and-pricing.md` | `runbooks/ai-cache.md` + `internal/metering`；L1/L2 开关 |
| `gateway/api-tokens.md` | `auth/pat.go`；吊销 TTL、管理入口 |
| `observability/README.md` | `GET /metrics`、`GATEWAY_METRICS`、Grafana JSON 路径 |
| `deployment/README.md` | 两条路径表 + 指向 local-selfhost / vercel checklist |
| `perf-baselines/README.md` | 明确「仓库无历史基线数字；只存档手工 k6 摘要」 |

---

### Task 3: Mermaid → 主题化 SVG

**Files:**
- Modify: `AgenticX-Website/scripts/build-concept-svgs.mjs`（追加 stem，**禁止**改已有 58 张概念/指南图语义）
- 替换下列 md 里的 `` ```mermaid `` 块

| stem | 源 Mermaid | 落点 |
|------|------------|------|
| `ent-topo` | architecture/overview flowchart LR | `architecture/overview.md` + `.en.md` |
| `ent-chat-seq` | data-flow 聊天 sequence | `architecture/data-flow.md` + `.en.md` |
| `ent-visibility` | 模型可见性 LR | 同上 |
| `ent-policy-publish` | 策略发布 LR | 同上 |
| `ent-audit-dual` | 审计双写 LR | 同上 |
| `ent-metering` | Token 计量 LR | 同上 |
| `ent-channel` | Channel 中继 LR | data-flow + `gateway/overview.md`（中文第二图）+ `.en.md` 补上 |
| `ent-sso` | SSO OIDC sequence | data-flow |
| `ent-gw-chat` | handleChatCompletions TD | `gateway/overview.md` + `.en.md` |
| `ent-schema` | database/schema erDiagram | `database/schema.md` + 新 `.en.md` |
| `ent-mcp` | 新图（非替换） | mcp overview / architecture/mcp-hosting |
| `ent-keypool` | 新图（非替换） | keypool-pat-overview |

替换语法（与框架文档一致）：

```
![...](/docs/svg/<stem>-zh.svg?v=2)

*示意图：...*
```

英文用 `-en.svg` + `*Diagram: ...*`。ER 图用卡片/关系，不要 ASCII。画布约 800 宽，复用 `nodeCard` / `rowCards` / CSS 变量。

`gateway/overview.en.md` 现缺 Channel 中继图：补 `ent-channel-en.svg`。

---

### Task 4: 46 个缺英文 slug 写 `.en.md`

加载约定（不要改 walker）：中文旁 sibling `<name>.en.md`；目录页用 `README.en.md`。`list-docs.ts` 已排除 `.en.md` 进 slug。

已有英文（只补缺口，不重译）：`index`、`architecture/overview`、`architecture/data-flow`、`gateway/overview`、`apps`、`features`、`api`、`mvp-acceptance-checklist-v20260422`。

其余每个中文 `.md` 必须有 sibling。已是英文正文的页（如 `architecture/protocol-translation.md`）复制为 `.en.md` 即可消横幅。

翻译规则：保留代码围栏、路径、环境变量名、表结构；不发明能力；协作指南用中性「Enterprise 交付」表述。

---

### Task 5: 验证与上线

1. `node scripts/build-concept-svgs.mjs`：原 58 + 新 stem×2（12 stem = 24）= **82**
2. `content/enterprise/**/*.md` 不再出现 `` ```mermaid ``
3. 每个中文 slug 都有 `.en.md`；`loadEnterpriseDocBySlug(slug,'en').fallbackUsed === false`
4. `pnpm ts-check`
5. 本地抽查：
   - `/en/enterprise/docs` 无横幅，目录含 Key Pool / MCP / 成熟度
   - `/en/enterprise/docs/gateway/keypool-pat-overview` 英文正文 + SVG
   - `/en/enterprise/docs/gateway/mcp-hosting-overview` 英文正文 + SVG
   - `/enterprise/docs/architecture/data-flow` 中文 SVG，无 Mermaid
6. 只推 Website `main`。主仓中文补实另 commit（若本轮只推网站，主仓改动保持未提交并告知）

## Commit trailers

```
Plan-Id: 2026-09-12-enterprise-docs-svg-i18n
Plan-File: .cursor/plans/2026-09-12-enterprise-docs-svg-i18n.plan.md
Plan-Model: Cursor Grok 4.6
Impl-Model: Cursor Grok 4.6
Made-with: Damon Li
```
