# Enterprise Gateway：Key Pool、配额与 API Token (PAT)

Channel 上游 Key 轮转、配额检查、PAT 直连是三条 complementary 能力。Key 明文不入库；PAT 只存 SHA-256；配额由网关 `quota.Tracker` 执行。

![Key Pool 轮转与冷却](/docs/svg/ent-keypool-zh.svg?v=2)

*示意图：Channel 配置环境变量名，Resolve 跳过空值与冷却，可重试失败三次后冷却 60 秒。*

## 能力边界（对照源码）

| 能力 | 源码 | 已落地 | 不要承诺 |
|------|------|--------|----------|
| Key 级 failover | `internal/keypool/pool.go` + `relay.Executor` | 同一 Channel 多 `metadata.keyRefs`；401/403/429/5xx/网络错切下一把 | 「任意 4xx 都切」——403 会切，取消/超时/`idle_timeout` 不会 |
| 多维配额 | `internal/quota/check_request.go` `selectRuleExtended` | PAT → 用户 → 部门 → 模型 → 角色回退；monthly / daily / weekly / TPM / RPM / `MaxConcurrency` | 管理台「额度控制」已是完整的部门 / 用户配额产品 UI（该页仍偏查询展示） |
| PAT | `internal/auth/pat.go` | `Bearer agx-pat-…` 查 `api_tokens` | 明文二次回显；吊销瞬时全集群生效（进程 LRU 约 60s） |

## Key Pool

Admin **Channel 管理**编辑 `metadata.keyRefs`（环境变量名，不是密钥本身）：

```json
{
  "keyRefs": ["DEEPSEEK_API_KEY_1", "DEEPSEEK_API_KEY_2"]
}
```

解析顺序（`ResolveWithRef`）：

1. Channel 上若已有明文/解密后的 **direct API Key**，直接用，不进轮转
2. 否则按 `keyRefs` 环形取下一个：跳过冷却中、跳过 `os.Getenv(ref)` 为空
3. 网关进程必须能读到这些环境变量

失败处理（`IsKeyRetryable` + `MarkFailure`）：

- 可重试：上游 **401 / 403 / 429 / ≥500**，或连接拒绝 / 超时类网络错
- 不可重试：`context.Canceled`、`DeadlineExceeded`、`stream:idle_timeout`、`stream:buffer_exceeded`
- 同一 `keyRef` 连续失败 **3** 次进入 **60s** cooldown；成功则清零
- Admin 内部接口：`GET /internal/keypool-stats`、`POST /internal/keypool/reset`

单 Key 场景继续用 Channel 的 API Key 字段（落库为 `api_key_cipher`，AES-256-GCM）。

## PAT

供业务系统 / IDE / MCP 客户端直连 `:8088`，不走 portal cookie。

1. web-portal「个人中心 → API Tokens」或 admin-console `/admin/api-tokens` 创建
2. 明文仅创建时返回一次，格式 `agx-pat-<base62>`
3. 表 `api_tokens` 只存 `token_hash`（SHA-256）、tenant / user / dept / scopes / `expire_at` / `status`
4. `last_used_at` 约每 60s flush 一次

```bash
curl -s -H "Authorization: Bearer agx-pat-..." \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8088/v1/chat/completions \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

吊销后网关内存缓存最长约 60s 仍可能接受旧 Token。细节见 [api-tokens.md](./api-tokens.md)。

## 配额

`CheckRequest` 在聊天路径上检查 RPM / TPM / 月额度 / 并发。选择规则：

1. `apiTokens[apiTokenID]`（PAT 调用）
2. `users[userID]`
3. `departments[deptID]`
4. `defaults.model[model]`
5. `defaults.role[role]`，再回退 `staff`

命中拦截返回 `policy:quota:monthly_exceeded` / `tpm` / `rpm` 等；warn 动作可带 `X-AgenticX-Quota-Warn`。未配 Redis 时限流是**单实例内存**语义。

配置表：`enterprise_runtime_token_quotas.config`（jsonb）。Admin **计量 → 配额** 可编辑该 JSON；现场演示以租户级限额为主。

## 私有化注意

- 上游 Key 与 PAT 明文都不要进 Git / PG 明文列
- 多副本要共享 Redis，否则 TPM/RPM 各算各的
- 与 Python / LiteLLM 路由是另一条线，客户方案不要混述

## 相关文档

- [api-tokens.md](./api-tokens.md)
- [overview.md](./overview.md)
- [runtime-config.md](./runtime-config.md)
- [mcp-hosting-overview.md](./mcp-hosting-overview.md)

Made-with: Damon Li
