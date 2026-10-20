# 能力回流 B7：公开检索证据与用户输入分开审查

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: —（`server.go` 归属顺序 B2 → B9a → B7）

## 目标

深度研究会把检索到的公开网页证据放进发给模型的消息里。现在网关把这些证据当成用户输入审查，公开网页上的电话、卡号等会触发拦截或脱敏，研究直接失败。本计划让门户对这类请求签名，网关验签后：

- 用户本人写的原文照常按策略审查（拦截 / 脱敏 / 提醒全部保留）；
- 公开证据里的个人信息类命中从「拦截 / 脱敏」降为「提醒」，并写一条审计；
- 关键词、正则、密钥类规则对公开证据仍照常拦截；模型输出审查不降级。

签名验不过、拿不到原文、多模态、上传文件、续跑的请求，一律按现在的普通规则审查（失败即收紧）。

## 现状（已核实）

- 网关请求阶段：`enterprise/apps/gateway/internal/server/server.go` L778–L779：`latestUserText := latestUserMessageContent(req.Messages)`，`reqPolicy := s.evaluatePolicy(latestUserText, makeEvalContext(identity, "request"))`。响应与流式阶段另有审查。
- 策略引擎：`enterprise/packages/policy-engine/types.go` 的 `EvalContext` 无公开检索标记；`engine.go` 的个人信息规则不区分来源。
- 普通联网搜索：`apps/web-portal/src/lib/web-search/tool-loop.ts` L299 `withSearchContext` 把证据拼进**系统消息**，请求阶段只看最后一条用户消息，不受影响。**本计划不改普通联网搜索**（主计划 D8）。
- 深度研究：证据在用户消息里（`lib/deep-research/report-writer.ts` 约 L224–L225），会被当用户输入审查。研究的规划与开题两段系统提示文案（「研究规划助手」「调研开题助手」）主仓已有。
- 门户部署没有注入 `GATEWAY_INTERNAL_TOKEN`（`enterprise/deploy/docker-compose/portal.yml`、`prod.yml` 的 `web-portal`）。网关用 `gatewayinternal.SecretFromEnv("GATEWAY_INTERNAL_TOKEN")` 读密钥（支持 `_FILE`）。
- 来源（`$DELIVERY_REPO`）：网关 `apps/gateway/internal/server/retrieval_policy.go`（257 行：`trustedPublicRetrieval` L50–L83、`evaluateChatRequestPolicy` L137–L178、`writePublicRetrievalWarnings` L180–L224）与 `retrieval_policy_test.go`（513 行）、`internal/openai/types.go`（`PolicyContext` L84–L88，请求体字段 `__policy_context` L42）、`server.go` 接线（约 L829、L862、L987、L1416、L1574）；策略引擎 `packages/policy-engine/types.go`（`EvalContext.PublicRetrieval` L59–L61）、`engine.go`（L104–L108）、`engine_retrieval_test.go`、`README.md`；门户 `apps/web-portal/src/lib/deep-research/retrieval-policy.ts`（97 行，`publicRetrievalFetch`）与测试（154 行）、`orchestrator.ts` 约 L1265–L1269 的包装点。提交 `35f3e17c`、`caf1be85`、`97b1c8db`。

## 协议（照搬，不得改名）

- 请求头：`x-agenticx-policy-timestamp`（Unix 秒）、`x-agenticx-policy-nonce`（UUID）、`x-agenticx-policy-signature`（hex）。
- 请求体额外字段：`"__policy_context": { "source": "public-retrieval", "user_text_sha256": "<hex>" }`。
- 签名：`HMAC-SHA256(GATEWAY_INTERNAL_TOKEN, "public-retrieval-v2\n" + Authorization头原值 + "\n" + timestamp + "\n" + nonce + "\n" + 原始请求体字节)`。
- 网关校验：时间窗 ±5 分钟；签名比对；nonce 在窗口内去重（进程内，多副本共享见主计划 §8 待办）；校验后清空 `PolicyContext`，不转发给上游模型。

## 改动

### 1. 策略引擎（`packages/policy-engine`）

- `types.go` `EvalContext` 加 `PublicRetrieval bool`。
- `engine.go`：请求阶段且 `PublicRetrieval` 为真时，个人信息类（非密钥 / 非 api-key）命中的 `block` / `redact` 降为 `warn`；关键词、正则、密钥规则不变；响应阶段不降级。
- 测试 `engine_retrieval_test.go`（照搬）；`README.md` 增补一段契约说明。

### 2. 网关（`apps/gateway/internal`）

- `openai/types.go`：请求体解析 `__policy_context` 到 `PolicyContext{Source, UserTextSHA256}`；序列化给上游时不输出该字段。
- 新文件 `server/retrieval_policy.go`（照搬并适配主仓审计、身份结构）：
  - `trustedPublicRetrieval(r, rawBody, ctx)`：按上面的协议校验。
  - `evaluateChatRequestPolicy(...)`：可信时，从消息里找出 hash 等于 `user_text_sha256` 的原文（规则同交付仓：单条 user 且系统提示含「研究规划助手」或「调研开题助手」→ 整条 user 为原文；多条 user → 全部 user 以 `\n\n` 拼接为原文；其余不可信），原文按普通请求策略审查，最后一条 user（含证据）以 `PublicRetrieval=true` 审查；任何一步找不到 → 退回 `latestUserMessageContent` 的普通审查。
  - `writePublicRetrievalWarnings(...)`：降级出来的提醒单独写一条 `policy_hit` 审计（字段沿用主仓现有审计结构；主仓命中结构为 `matched_rule` + `severity` / `action`）。
- `server.go` L778 附近：OpenAI chat completions 请求阶段改调 `evaluateChatRequestPolicy`。embeddings、其他协议入口、渠道接口不改。
- 审计写入失败的处理沿用主仓现有方式，不新增「尽力而为」分支。

### 3. 门户（`apps/web-portal`）

- 新文件 `src/lib/deep-research/retrieval-policy.ts`（+ test，照搬）：`publicRetrievalFetch(fetchImpl, { gatewayUrl, token })`：只对发往网关 chat completions、body 为 JSON、可抽出原文的请求签名并加 `__policy_context`；token 为空、非网关地址、解析失败、多模态内容 → 原样转发不签名。token 从服务端环境 `GATEWAY_INTERNAL_TOKEN`（或 `_FILE`）读取，禁止 `NEXT_PUBLIC_*`。
- `lib/deep-research/orchestrator.ts`：只在「纯文本公开研究」路径（无上传文件、非续跑）用 `publicRetrievalFetch` 包装发往网关的 fetch；位置对照交付仓约 L1265–L1269，在主仓 `runDeepResearchTurn`（L671 起）里找到构造网关 fetch 的地方接入，改动尽量限于这一处。写作阶段（大纲 / 章节）不签名。
- 部署：`enterprise/deploy/docker-compose/portal.yml` 与 `prod.yml` 的 `web-portal` 增加 `GATEWAY_INTERNAL_TOKEN`（引用与网关、管理台相同的变量 / secret 来源，不写明文值）；`enterprise/scripts/start-dev.sh` 已导出该变量的，确认门户进程能拿到即可。

## In scope / Out of scope

- In：策略引擎降级规则、网关验签与分开审查、审计、门户研究管线签名、门户部署注入密钥。
- Out：普通联网搜索证据位置；nonce 跨副本共享；embeddings / 其他协议；语义规划器。

## 验收

- AC-1：`cd enterprise/packages/policy-engine && go test ./...`：公开证据里的手机号 / 卡号 → `warn`；同一内容非公开来源 → 原动作；密钥 / 关键词仍 `block`；响应阶段不降级。
- AC-2：`cd enterprise/apps/gateway && go test ./internal/server/... ./internal/openai/...`：`retrieval_policy_test.go` 覆盖签名正确放行降级；时间戳过期、签名错、换了 Authorization、nonce 重放 → 退回普通审查；原文里的个人信息仍按原动作处理；`PolicyContext` 不出现在转发给上游的请求体里；提醒写入审计。
- AC-3：`apps/web-portal/src/lib/deep-research/retrieval-policy.test.ts`：签名覆盖 body / Authorization / 时间戳 / nonce；无 token、非网关 URL、多模态 → 不签名。
- AC-4：`pnpm -C enterprise/apps/web-portal typecheck && test`（除基线 10 条外无新增失败）；`go test ./...` 不新增失败包。
- AC-5（验收方手工）：策略中心发布一条「手机号 → 拦截」规则；门户发起一个检索结果里很可能出现客服电话的深度研究，研究能完成，审计里出现降级提醒；在普通对话里直接发自己的手机号，仍被拦截。

## 验收记录

- 2026-10-20 Opus 5.5 复核（自动部分）：AC-1 policy-engine 通过；AC-2 网关 `server` / `openai` 包通过（干净环境）；AC-3 门户签名 14 项通过；AC-4 门户无基线外失败、类型错误仍 26 条，网关 `go test ./...` 无新增失败包。
- 代码审核：用户原文在设置公开检索标记**之前**按普通规则审查；降级只作用于请求阶段非 api-key 的个人信息规则，关键词 / 正则 / 密钥与响应阶段不降级；原文中的脱敏命中同步替换到所有消息；`__policy_context` 在转发前清空；无有效签名时浏览器自带的 `__policy_context` 不被信任。
- 跨实现互通（验收方补测）：用门户 `publicRetrievalFetch` 生成真实签名请求，交给网关 `trustedPublicRetrieval` / `publicRetrievalUserText` 校验：签名通过、用户原文哈希匹配、同一 nonce 重放被拒。临时测试已删除。
- 与计划的差异（实施方说明，验收认可）：审计写失败沿用主仓「返回错误」方式，不移植尽力而为分支；提醒审计只在请求阶段写；签名密钥从服务端环境读取；多模态不签名；主仓没有报告续跑与附件文档解析，包装条件改用计划门续跑、非字符串消息与附件路由头。
- 说明：按交付仓设计，深度研究写作阶段（大纲 / 章节）本身不签名，证据里的公开个人信息在写作阶段仍可能触发拦截；本次收益集中在规划、开题等多轮用户消息场景。AC-5 的整轮深度研究手工走查与 B6 的报告续写一起做。
