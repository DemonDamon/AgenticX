# Desktop 企业托管联网搜索

Planned-with: GPT-5

## 目标

在 `hc-0818` 打通 Desktop 企业账户登录与 Enterprise 租户联网搜索配置。企业用户登录后，本机内置 `web_search` 只携带企业 PAT 和查询词调用 Enterprise；搜索 Provider 的主密钥、备用密钥、路由、配额和失败切换全部留在服务端。个人/未登录模式继续使用现有本机 DuckDuckGo 或用户自配搜索服务。

## 根因与证据

- `desktop/electron/main.ts::applyEnterpriseProvider()` 把企业 PAT 写入兼容字段 `providers.enterprise.api_key`，LLM 请求经 `/api/desktop/v1/chat/completions` 转发到 Gateway；该值不是模型厂商原始 Key。
- `agenticx/studio/web_search/service.py::WebSearchService.from_config()` 目前只读取本机 `web_search`，不了解 `enterprise` 登录态。
- `enterprise/apps/web-portal/src/app/api/desktop/v1/` 当前只有 `chat/completions`，没有 Desktop 搜索入口。
- Enterprise 已在 `lib/web-search/providers.ts::executeWebSearch()` 实现最多两个已配置 Provider 的顺序尝试，并在 `daily-provider-quota.ts` 提供租户级调用额度预占；应复用这些能力而不是向 Desktop 下发密钥。

## In scope

- 新增 PAT 鉴权的 `POST /api/desktop/v1/web-search`。
- 读取并解密当前租户的搜索配置，遵守管理员启停状态。
- 每次真实 Provider 请求前预占租户每日额度；主 Provider 失败或空结果时自动尝试已配置备用 Provider。
- 只向 Desktop 返回标题、URL、摘要、可选发布时间和实际成功的 Provider ID，不返回任何密钥或完整配置。
- 企业登录态下，本机 `web_search` 转发 Enterprise；401、禁用、额度耗尽、配置故障和双 Provider 失败均原样转成可读错误，禁止本机搜索兜底。
- 引用记录使用服务端实际成功的 Provider ID。
- Desktop 设置中企业登录态只显示“由企业管理员托管”，不再展示本机搜索 Key 输入。

## Out of scope

- 不改变个人模式现有 DuckDuckGo、Bocha、Tavily、Serper、Google CSE、Bing 配置。
- 不向 Desktop bootstrap 或本机配置写入 Enterprise 搜索 Provider Key。
- 不改变 Enterprise 管理后台现有主/备用 Provider 编辑方式。
- 不在 Agent 提示词或工具参数中暴露 Provider 凭据。
- 不把企业搜索失败静默降级为本机 DuckDuckGo。

## 实施

### FR-1：Enterprise Desktop 搜索端点

Suggested-Impl-Model: GPT-5

新文件：`enterprise/apps/web-portal/src/app/api/desktop/v1/web-search/route.ts`

- 使用 `resolveDesktopIdentity(request)` 验证 Bearer PAT，并要求 `workspace:chat` scope。
- 接收 `{ query: string, max_results?: number }`；拒绝空查询和超长查询，结果数由服务端上限约束。
- 调用 `loadTenantWebSearchConfigStrict(identity.tenantId)` 和 `resolveWebSearchConfig()`；管理员关闭时返回 403，配置读取失败返回 503。
- 调用 `executeWebSearch()`，将 `reserveTenantDailySearchProviderCall(identity.tenantId)` 接到 `beforeProviderAttempt`。主 Provider 的失败/空结果由既有执行器进入备用 Provider。
- 通过 `onProviderAttempt` 记录实际成功 Provider；返回 `{ ok, provider, hits }`，不返回 Provider 配置或 Key。
- 配额耗尽返回 429；配额存储不可用返回 503；所有 Provider 均失败返回 502。

测试：`enterprise/apps/web-portal/src/app/api/desktop/v1/web-search/__tests__/route.test.ts`

AC：覆盖未登录、scope 不足、空查询、管理员禁用、主失败后备用成功且额度计数两次、配额错误映射；成功响应不包含 `apiKey`/`providers`。

### FR-2：本机企业搜索转发

Suggested-Impl-Model: GPT-5

新文件：`agenticx/studio/web_search/enterprise.py`

- 仅从全局用户配置读取 `enterprise.enabled/base_url/token`，禁止项目级 `.agenticx/config.yaml` 覆盖企业 Portal 或 PAT。
- 只允许有效 Portal origin；公网必须使用 HTTPS，HTTP 仅允许 loopback 开发地址。固定请求 `/api/desktop/v1/web-search`，禁止跟随重定向以免 Bearer PAT 泄漏到其他 origin。
- 解析服务端安全响应为 `WebSearchResult`；HTTP 错误只透出服务端用户文案，不记录或拼接 PAT。

文件：`agenticx/studio/web_search/service.py`

- `from_config()` 在企业登录态构造托管客户端。
- `search()` 优先且唯一调用企业客户端；失败直接抛错，不进入任何本机 Provider。
- 维护 `last_provider`；个人模式本地付费 Provider 失败回退 DuckDuckGo 时也记录真实 Provider。

文件：`agenticx/cli/agent_tools.py`

- `queue_web_search_batch()` 使用 `service.last_provider`，保证引用来源与实际执行一致。

测试：`tests/test_enterprise_managed_web_search.py`

AC：验证 PAT 请求头、固定同源端点、响应解析、企业失败不触发本机搜索、实际 Provider 写入服务状态。

### FR-3：企业策略优先与设置态

Suggested-Impl-Model: GPT-5

文件：

- `agenticx/runtime/prompts/meta_agent.py::_build_web_search_capability_block()`
- `agenticx/studio/server.py::_strip_disabled_web_search_tools()`
- `desktop/src/components/settings/WebSearchSettingsPanel.tsx`

改动：

- 企业登录态忽略历史本机 `web_search.enabled=false`，保留托管工具；最终是否允许由 Enterprise 租户策略判定。
- 系统提示说明联网搜索由企业管理员托管，不引导企业用户填写本机 Key。
- 设置面板检测 `userAccount.loggedIn`，仅展示托管说明，不加载或编辑本机 Provider 密钥。

AC：企业登录态不会因旧的本机关闭状态丢失工具，也不会显示本机搜索 Key 表单；个人模式行为不变。

## 验证

```text
python -m pytest tests/test_enterprise_managed_web_search.py tests/test_smoke_current_time_grounding.py
pnpm --dir enterprise --filter @agenticx/app-web-portal test -- src/app/api/desktop/v1/web-search/__tests__/route.test.ts
pnpm --dir enterprise --filter @agenticx/app-web-portal typecheck
npx --no-install vitest run src/components/settings/WebSearchSettingsPanel.test.tsx  # desktop/
cd desktop && npm run build
```

## 提交边界

仅提交本计划、Enterprise Desktop 搜索端点及测试、本机搜索转发及测试、托管态提示文件。工作区现有历史侧栏、输入区和设置页其他未提交改动不纳入本提交；不自动推送。
