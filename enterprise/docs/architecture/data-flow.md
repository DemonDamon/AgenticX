# Enterprise 数据流

> 最后更新：2026-05-21

本文描述一次完整聊天请求及关联子系统的数据流向。

---

## 1. 聊天 completions 主链路

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户浏览器
    participant P as web-portal API
    participant G as apps/gateway
    participant Pol as policy-engine
    participant Up as 上游 LLM
    participant DB as PostgreSQL

    U->>P: POST /api/chat/completions<br/>(JWT cookie + model + messages)
    P->>P: 校验 session<br/>组装 OpenAI body
    P->>G: 转发至 GATEWAY_COMPLETIONS_URL
    G->>G: 解析 JWT → tenant/dept/user/session
    G->>DB: quota.Tracker 检查配额
    G->>Pol: 请求阶段评估 (keyword/regex/pii)
    alt action=block
        Pol-->>G: 命中
        G-->>P: 业务错误（非模型拒答）
        P-->>U: 合规拦截 UI
    else 放行/redact
        G->>Up: 调用 OpenAI 兼容上游
        Up-->>G: response / SSE stream
        G->>Pol: 响应/流式阶段二次评估
        G->>DB: audit (JSONL + gateway_audit_events)
        G->>DB: metering (usage_records)
        G-->>P: completions / SSE
        P-->>U: 渲染
    end
```

### Portal 侧会话持久化

聊天历史**不经过 Gateway 持久化**，由 portal API 写入 PG：

- `POST /api/chat/sessions` → `chat_sessions`
- `POST /api/chat/sessions/:id/messages` → `chat_messages`

Gateway 只负责推理、策略、审计、计量。

---

## 2. 模型可见性

```mermaid
flowchart LR
    admin["admin-console<br/>/admin/models"] -->|CRUD| providers[("enterprise_runtime_<br/>model_providers")]
    admin -->|可见模型分配| visible[("enterprise_runtime_<br/>user_visible_models")]
    portal["web-portal<br/>GET /api/me/models"] -->|按 JWT 过滤| visible
    portal --> ui["ChatWorkspace<br/>模型下拉"]
    gateway["apps/gateway"] -. /api/internal/providers .-> providers
```

Gateway 侧通过 internal API 或 PG 读取 provider 配置（含 `api_key_cipher` 解密），与 portal 可见性**独立**：portal 控制「用户能看到哪些 model id」，gateway 控制「哪些 upstream 可调用」。

---

## 3. 策略发布流

```mermaid
flowchart LR
    draft["policy_rules<br/>status=draft"] -->|POST /api/policy/publish| publish[/发布/]
    publish --> events[("policy_publish_events")]
    publish --> snap[("enterprise_runtime_<br/>policy_snapshots")]
    snap -->|远程 URL 或本地文件| gateway["apps/gateway<br/>policy-engine 热加载"]
    note["⚠️ 仅 status=active<br/>进入快照"]:::n
    classDef n fill:#fef3c7,stroke:#f59e0b
```

**注意**：`blocked=true` 仅当 action 为 **block**；warn/redact 可有 hits 但不拦截。

测试：`POST /api/policy/test` 合并表单预览与库内规则，避免「界面选拦截仍按旧动作计算」。

---

## 4. 审计双写

```mermaid
flowchart LR
    llmCall["Gateway 每次 LLM 调用"] -->|必须成功| jsonl[("JSONL<br/>apps/gateway/<br/>.runtime/audit/")]
    llmCall -->|best-effort| pg[("gateway_audit_events")]
    pg -.->|失败| pending[(".pg-pending")]
    boot["进程启动"] -->|回灌窗口 GATEWAY_AUDIT_BACKFILL_DAYS=7| pending
    pending --> pg
```

admin-console `/audit` 查询走 PG `PgAuditStore`，可见域依赖 scope：

- `audit:read:all` — 全租户
- `audit:read:dept` — 本部门
- 旧 `audit:read`  alone 可能导致部门场景 403

IAM 管理操作审计在**另一张表** `audit_events`，与 gateway 审计分表。

---

## 5. Token 计量

```mermaid
flowchart LR
    bill["Gateway billing 结算"] --> usage[("usage_records<br/>tenant/dept/user/<br/>provider/model/time_bucket")]
    usage --> admin["admin-console /metering<br/>查询 + 导出"]
    bill -. SSE/usage .-> chip["portal 顶栏<br/>token chip"]
```

配额：`enterprise_runtime_token_quotas` → gateway `quota.Tracker`。当前以**租户级**为主；部门/用户级 TPM 需独立规划。

---

## 6. Channel 中继（可选）

启用 `GATEWAY_CHANNEL_REGISTRY=on` 时：

```mermaid
flowchart LR
    admin["admin CRUD<br/>gateway_channels"] -->|/api/internal/channels<br/>~5s 轮询| reg["channel.Registry"]
    reg --> picker["Picker<br/>权重/优先级/亲和"]
    picker --> relay["relay.Executor<br/>失败重试"]
    relay --> adaptor["adaptor 工厂"] --> upstream(["上游"])
```

详见 [runbooks/gateway-channel-relay.md](../runbooks/gateway-channel-relay.md)。

---

## 7. SSO 登录流（OIDC 示例）

```mermaid
sequenceDiagram
    participant U as 用户
    participant P as portal /auth
    participant IdP as 企业 IdP
    participant DB as PostgreSQL

    U->>P: 点击 SSO 按钮
    P->>U: 302 → GET /api/auth/sso/oidc/start
    U->>IdP: authorize
    IdP-->>U: 回调 → /api/auth/sso/oidc/callback?code=...
    U->>P: callback
    P->>IdP: token endpoint 换 token
    P->>DB: JIT 用户 upsert + 写 auth_refresh_sessions
    P-->>U: Set-Cookie + redirect /workspace
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
