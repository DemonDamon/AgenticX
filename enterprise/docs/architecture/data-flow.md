# Enterprise 数据流

> 最后更新：2026-05-21

本文描述一次完整聊天请求及关联子系统的数据流向。

---

## 1. 聊天 completions 主链路

![聊天请求过网关](/docs/svg/ent-chat-seq-zh.svg?v=2)

*示意图：portal 转发到网关后做配额与策略，拦截返回业务错误，放行才打上游并写审计 / 计量。*

### Portal 侧会话持久化

聊天历史**不经过 Gateway 持久化**，由 portal API 写入 PG：

- `POST /api/chat/sessions` → `chat_sessions`
- `POST /api/chat/sessions/:id/messages` → `chat_messages`

Gateway 只负责推理、策略、审计、计量。

---

## 2. 模型可见性

![可见模型与可调用上游](/docs/svg/ent-visibility-zh.svg?v=2)

*示意图：Admin 写 provider 与可见模型表；portal 按 JWT 过滤下拉；网关另读可调用上游。*

Gateway 侧通过 internal API 或 PG 读取 provider 配置（含 `api_key_cipher` 解密），与 portal 可见性**独立**：portal 控制「用户能看到哪些 model id」，gateway 控制「哪些 upstream 可调用」。

---

## 3. 策略发布流

![策略发布进快照](/docs/svg/ent-policy-publish-zh.svg?v=2)

*示意图：只有 status=active 的规则进入快照，网关按远程 URL 或本地文件热加载。*

**注意**：`blocked=true` 仅当 action 为 **block**；warn/redact 可有 hits 但不拦截。

测试：`POST /api/policy/test` 合并表单预览与库内规则，避免「界面选拦截仍按旧动作计算」。

---

## 4. 审计双写

![审计双写](/docs/svg/ent-audit-dual-zh.svg?v=2)

*示意图：JSONL 必须成功；Postgres 尽力而为，失败进 .pg-pending，启动时回灌。*

admin-console `/audit` 查询走 PG `PgAuditStore`，可见域依赖 scope：

- `audit:read:all` — 全租户
- `audit:read:dept` — 本部门
- 旧 `audit:read`  alone 可能导致部门场景 403

IAM 管理操作审计在**另一张表** `audit_events`，与 gateway 审计分表。

---

## 5. Token 计量

![Token 计量](/docs/svg/ent-metering-zh.svg?v=2)

*示意图：网关结算写入 usage_records；管理台查询导出；portal 可用 SSE 显示 token chip。*

配额：`enterprise_runtime_token_quotas` → gateway `quota.Tracker`。当前以**租户级**为主；部门/用户级 TPM 需独立规划。

---

## 6. Channel 中继（可选）

启用 `GATEWAY_CHANNEL_REGISTRY=on` 时：

![Channel 中继](/docs/svg/ent-channel-zh.svg?v=2)

*示意图：Admin 写 Channel，网关约 5s 轮询，Picker 挑选后由 Executor 重试上游。*

详见 [runbooks/gateway-channel-relay.md](../runbooks/gateway-channel-relay.md)。

---

## 7. SSO 登录流（OIDC 示例）

![OIDC 登录](/docs/svg/ent-sso-zh.svg?v=2)

*示意图：点 SSO → start → IdP authorize → callback 换 token → JIT upsert 后写 cookie。*

Admin 侧镜像路由在 `:3001`，Provider CRUD 在 `/settings/sso` + `/api/admin/sso/providers/*`。

---

## 8. Legacy JSON 迁移流

```
.runtime/admin/*.json  (历史本地文件)
  ▼
migrate-runtime-legacy.ts  (bootstrap / start-dev 自动触发)
  ▼
enterprise_runtime_* 表
  ▼
admin / portal / gateway 只读 PG
```
