# Enterprise 数据流

本文描述一次完整聊天请求及关联子系统的数据流向。

---

## 1. 聊天 completions 主链路

```
用户 (浏览器)
  │
  ▼
web-portal  /workspace
  │  ChatWorkspace → POST /api/chat/completions
  │  附带 JWT Cookie + model + messages
  ▼
web-portal API Route
  │  校验 session · 组装 OpenAI body
  │  转发至 GATEWAY_COMPLETIONS_URL (默认 http://127.0.0.1:8088/v1/chat/completions)
  ▼
apps/gateway  handleChatCompletions
  │
  ├─ 1. JWT 解析 → tenant_id / dept_id / user_id / session_id
  ├─ 2. quota.Tracker 检查租户配额
  ├─ 3. policy-engine 请求阶段评估 (keyword/regex/pii)
  │      action=block → 直接返回业务错误（非模型拒答）
  ├─ 4. routing.Decider 或 Channel Registry 选上游
  ├─ 5. provider/adaptor 调用 OpenAI-compatible 上游
  ├─ 6. 流式/非流式响应阶段二次策略评估
  ├─ 7. audit 双写 JSONL + gateway_audit_events (checksum 链)
  └─ 8. metering 写入 usage_records
  ▼
上游 LLM
```

### Portal 侧会话持久化

聊天历史**不经过 Gateway 持久化**，由 portal API 写入 PG：

- `POST /api/chat/sessions` → `chat_sessions`
- `POST /api/chat/sessions/:id/messages` → `chat_messages`

Gateway 只负责推理、策略、审计、计量。

---

## 2. 模型可见性

```
admin-console  /admin/models
  │  CRUD enterprise_runtime_model_providers
  │  用户详情 → 可见模型分配 → enterprise_runtime_user_visible_models
  ▼
web-portal  GET /api/me/models
  │  按当前用户 JWT 过滤
  ▼
ChatWorkspace 模型下拉
```

Gateway 侧通过 internal API 或 PG 读取 provider 配置（含 `api_key_cipher` 解密），与 portal 可见性**独立**：portal 控制「用户能看到哪些 model id」，gateway 控制「哪些 upstream 可调用」。

---

## 3. 策略发布流

```
admin-console  /policy
  │  草稿规则 policy_rules (status=draft)
  │  POST /api/policy/publish
  ▼
policy_publish_events + enterprise_runtime_policy_snapshots
  │
  ├─ Gateway 读 GATEWAY_REMOTE_POLICY_SNAPSHOT_URL 或本地文件
  └─ 仅 status=active 的规则进入快照
```

**注意**：`blocked=true` 仅当 action 为 **block**；warn/redact 可有 hits 但不拦截。

测试：`POST /api/policy/test` 合并表单预览与库内规则，避免「界面选拦截仍按旧动作计算」。

---

## 4. 审计双写

```
Gateway 每次 LLM 调用
  │
  ├─ 必须成功：append-only JSONL (apps/gateway/.runtime/audit/)
  └─ best-effort：gateway_audit_events (PG)
         失败 → .runtime/audit/.pg-pending
         启动回灌窗口 GATEWAY_AUDIT_BACKFILL_DAYS (默认 7)
```

admin-console `/audit` 查询走 PG `PgAuditStore`，可见域依赖 scope：

- `audit:read:all` — 全租户
- `audit:read:dept` — 本部门
- 旧 `audit:read`  alone 可能导致部门场景 403

IAM 管理操作审计在**另一张表** `audit_events`，与 gateway 审计分表。

---

## 5. Token 计量

```
Gateway billing 结算
  ▼
usage_records (tenant/dept/user/provider/model/time_bucket)
  ▼
admin-console /metering 查询与导出
portal 顶栏 token chip（SSE/响应 usage 累加）
```

配额：`enterprise_runtime_token_quotas` → gateway `quota.Tracker`。当前以**租户级**为主；部门/用户级 TPM 需独立规划。

---

## 6. Channel 中继（可选）

启用 `GATEWAY_CHANNEL_REGISTRY=on` 时：

```
admin  CRUD gateway_channels
  ▼
GET /api/internal/channels → Gateway registry (~5s)
  ▼
channel.Picker + relay.Executor（权重/优先级/亲和/重试）
  ▼
adaptor 工厂 → 上游
```

详见 [runbooks/gateway-channel-relay.md](../runbooks/gateway-channel-relay.md)。

---

## 7. SSO 登录流（OIDC 示例）

```
portal /auth → GET /api/auth/sso/oidc/start
  │  302 → IdP authorize
  ▼
IdP callback → GET /api/auth/sso/oidc/callback
  │  换 token · JIT 用户 · 写 refresh session
  ▼
Set-Cookie → redirect /workspace
```

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
