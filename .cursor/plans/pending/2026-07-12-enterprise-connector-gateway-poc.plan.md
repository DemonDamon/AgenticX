# Enterprise 连接器网关真实 OAuth PoC

Planned-with: gpt-5.6-sol-medium
Suggested-Impl-Model: gpt-5.3-codex
Status: implementation-ready
Parent-Plan: `.cursor/plans/2026-07-12-enterprise-connector-gateway.plan.md`

## 目标

在不修改 Near 生产代码、不提前建设 PostgreSQL HA overlay 的前提下，固定 OpenConnector 上游版本并以单副本 non-production 环境验证真实 provider 合同。

首个上线里程碑是 GitHub + 腾讯文档；Gmail、Notion、Slack 分别认证、分别上线。

## 证据与边界

- 固定基线：`oomol-lab/open-connector@62796b0d9390df49ed7644692ed75ba576bac9e9`。
- 该版本包含 `github`、`gmail`、`notion`、`slack`、`tencent_docs`。
- PoC 使用上游 SQLite 单副本，仅证明 provider/OAuth/Action 合同；不得描述为 HA 或生产可用。
- OpenConnector Admin API 仅允许 localhost/compose internal network。
- provider Client Secret 只从本地 secret/env 注入，不写 fixture、日志或报告。

### In scope

- 固定源码归档 SHA-256 与 image digest。
- HTTPS callback 域名和五家 OAuth App 配置。
- OAuth start/同意/拒绝/callback/token/profile/refresh/revoke。
- 每家一个最小只读 Action。
- 生成脱敏、可重复执行的 certification 报告。

### Out of scope

- Enterprise 多租户控制面。
- PostgreSQL adapter、双副本和 K8s。
- Near UI/IPC/MCP 接入。
- write/destructive Action。

## 门禁

- **G1：** GitHub OAuth + `github.get_current_user` PASS 后，允许控制面子计划开始。
- **G2：** GitHub + 腾讯文档 PASS，且二者至少一个真实返回 refresh token；若均无 refresh token，则 Gmail refresh 必须 PASS。G2 后允许 Runtime HA 子计划开始。
- 每个 provider 只有自己的 certification PASS 后才可把 feature flag 设为可用。
- 总体完成要求五个 provider 全部 PASS。

## 文件

- Create: `enterprise/deploy/connector-gateway/open-connector.lock.json`
- Create: `enterprise/deploy/connector-gateway/compose.poc.yml`
- Create: `enterprise/scripts/connectors/certify-providers.ts`
- Create: `enterprise/scripts/connectors/provider-certification.fixture.json`
- Create: `enterprise/scripts/connectors/__tests__/certify-providers.test.ts`
- Create: `enterprise/docs/connectors/provider-certification.md`
- Modify: `enterprise/package.json`

## 实施

### P1. 固定供应链

`open-connector.lock.json` 必须包含：

```json
{
  "repository": "https://github.com/oomol-lab/open-connector",
  "commit": "62796b0d9390df49ed7644692ed75ba576bac9e9",
  "sourceArchiveSha256": "<实施时计算并固定>",
  "image": "ghcr.io/oomol-lab/open-connector@sha256:<实施时固定>"
}
```

禁止 `latest`、`tip`、branch 或未校验源码。保留上游 LICENSE/NOTICE 与第三方品牌权利说明。

### P2. Non-production 运行环境

`compose.poc.yml`：

- OpenConnector 单副本；
- 独立 volume；
- Admin/Runtime/Encryption secrets 来自 env；
- `OOMOL_CONNECT_ORIGIN` 使用 staging HTTPS origin；
- 仅 callback 对外；Admin/Runtime API 不对公网发布；
- 明确 label/README：`non-production`, `single-replica`, `sqlite`。

### P3. Provider 认证

认证脚本按 provider 独立运行，输出结构：

```text
service
upstream_commit
authorization_url_host
callback_uri
oauth_start
oauth_complete
profile
refresh
readonly_action
revoke
status
error_code
verified_at
```

不得输出 code、access/refresh token、cookie、Client Secret、邮件/文档正文。

最低 Action：

- GitHub：`github.get_current_user`
- 腾讯文档：`tencent_docs.get_current_user` + `tencent_docs.list_folder` 或 `search_files`
- Gmail：`gmail.get_profile`
- Notion：`notion.list_users`
- Slack：`slack.list_channels`

腾讯文档必须证明 OpenAPI 调用成功，不得只截图微信/QQ 登录页。

### P4. 错误合同

认证脚本覆盖：

- 错误 Client Secret；
- callback URI mismatch；
- 用户拒绝；
- state 缺失/过期/重放；
- scope 不足；
- provider 429/5xx；
- revoke 后旧 credential 执行失败。

PoC 可记录上游原始错误类别，但对外报告必须映射为 `connector.oauth.*` / `connector.provider.*` 稳定码。

## 测试场景

1. fixture parser 遇到 token/cookie/client_secret 字段时拒绝写报告。
2. 五个 provider 可分别运行，单个失败不覆盖其它 provider 结果。
3. 未真实完成 OAuth 的 provider 输出 `blocked`，不能输出 `passed`。
4. GitHub PASS 产生 G1；GitHub+腾讯文档+refresh 条件产生 G2。
5. revoke 后 readonly action 返回未授权。

## 验收

- AC-1：锁文件使用 commit + digest/SHA-256，无浮动引用。
- AC-2：GitHub G1 PASS。
- AC-3：GitHub + 腾讯文档 G2 PASS；必要时 Gmail refresh 补足。
- AC-4：Gmail、Notion、Slack 各有独立真实 certification 结果。
- AC-5：认证报告与日志经 secret scan 无凭证/正文。
- AC-6：PoC 文档明确不可生产、不可 HA。

## Definition of Done

1. G1/G2 有脱敏证据。
2. 五 provider 最终全部通过，或未通过者保持 blocked 且不影响已通过 provider。
3. 下游控制面/HA 计划所需 callback、scope、refresh 与错误合同已落盘。
4. Plan 与代码提交包含本 Plan-Id/Plan-File trailer。

## 追溯

- Plan-Id: `2026-07-12-enterprise-connector-gateway-poc`
- Plan-File: `.cursor/plans/2026-07-12-enterprise-connector-gateway-poc.plan.md`
