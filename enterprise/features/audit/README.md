# @agenticx/feature-audit

> 🛡️ **审计日志** — 自研 · 多租户 · 不可篡改 · 支持 OTLP 标准导出

企业级 AI 调用审计模块。完整记录调用链路（人员 · 模型 · 对话摘要 · 调用时间 · 算力消耗 · 工具调用 · 策略命中），满足客户 A技术规范书 §1.5(1)「日志管理」要求。

---

## 设计原则

1. **自研实现**：不 fork 任何开源审计系统（Langfuse / LangSmith / Helicone 代码一律不嵌入）
2. **标准协议**：通过 **OpenTelemetry OTLP** 协议导出，客户可选对接任意 APM / LLMOps 后端
3. **数据不出域**：默认所有审计数据留在客户环境（PG + ClickHouse + 本地 JSON）
4. **安全优先**：日志追加、签名、不可篡改
5. **租户隔离**：所有查询走 `tenant_id` 强制过滤

---

## 架构

```
                 写入路径（高吞吐、异步）
  ┌─────────┐    ┌──────────────┐
  │ Gateway │───►│ Audit Ingest │
  └─────────┘    │ （OTel Agent）│
  ┌─────────┐    │              │───┬───►  本地 JSON 文件（当期）
  │Web Portal│──►│ - 脱敏       │   │       append-only + checksum 链
  └─────────┘    │ - 结构化      │   │       mode 0600
  ┌─────────┐    │ - 签名        │   │
  │Admin UI │───►│              │   ├───►  ClickHouse（远期）
  └─────────┘    └──────────────┘   │       高压缩分区表
                                    │
                                    └───►  OTel Exporter（可选）
                                          └── Langfuse / Jaeger / Datadog
                                              （客户自选，非强依赖）

                 查询路径（RBAC · 只读 · 签名校验）
  ┌─────────────┐    ┌──────────────┐
  │  Admin UI   │───►│ Audit Query  │───► 数据源（JSON / CH）
  │ （审计员）   │    │ - RBAC        │
  └─────────────┘    │ - 签名校验    │
                     │ - 导出审计    │
                     └──────────────┘
```

---

## 核心字段（我们的 schema，不抄任何开源项目）

```typescript
// packages/core-api/src/audit.ts
export interface AuditEvent {
  // 元信息
  id: string;                    // ULID（时序可排序）
  tenant_id: string;             // 租户隔离必填
  event_time: Date;              // UTC
  event_type: AuditEventType;    // chat_call | tool_call | policy_hit | ...

  // 主体
  user_id: string | null;
  user_email?: string;           // 冗余便于查询
  department_id?: string;
  session_id?: string;
  client_type: "web-portal" | "desktop" | "edge-agent";
  client_ip?: string;

  // 模型相关
  provider?: string;             // openai / anthropic / client-a-private / ...
  model?: string;
  route: "local" | "private-cloud" | "third-party";

  // 消耗
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;             // 精度 8 位小数
  latency_ms?: number;

  // 对话摘要（⚠️ 绝非原文）
  digest?: {
    prompt_hash: string;         // blake2b(prompt)
    response_hash: string;       // blake2b(response)
    prompt_summary?: string;     // ≤500 字脱敏摘要
    response_summary?: string;
  };

  // 工具调用
  tools_called?: string[];       // 仅工具名，不含参数

  // 策略命中
  policies_hit?: Array<{
    policy_id: string;
    severity: "low" | "medium" | "high" | "critical";
    action: "allow" | "redact" | "block";
    matched_rule?: string;       // 规则 id，不记原文
  }>;

  // 完整性
  prev_checksum: string;         // 链式 checksum
  signature?: string;            // Ed25519 签名（高密级环境）
}
```

---

## 安全基线

### S1. 日志不可篡改

- **Append-only**：文件以 `O_APPEND` 打开，写入后不修改
- **Checksum 链**：每条 event 的 `prev_checksum = blake2b(prev.checksum || prev.raw_json)`，构成单向链
- **定期签名**：每 N 条或每分钟，对链尾做 Ed25519 签名并落盘
- **异常检测**：查询时校验链完整性，断链立即告警

### S2. 原文不外发

- **哈希 + 摘要**：原始 prompt/response 只记 hash，摘要经脱敏后最多 500 字
- **绝不写明文**：即使 DEBUG 日志也不输出原始对话
- **本地保留可选**：客户可配置"原文暂存 N 天仅用于事故回放"，默认关闭

### S3. 查询权限

| 角色 | 可查询范围 |
|---|---|
| 合规审计员（auditor）| 本租户全量 + 导出权限 |
| 部门管理员（dept-admin）| 本部门成员 |
| 普通员工（member）| 只看自己 |
| 超管（super-admin）| 跨租户（仅 SaaS 模式）|

RBAC 在 `@agenticx/feature-iam` 中定义，本模块强制检查。

### S4. 导出审计

- **每次导出**本身是审计事件（防止「导出后删库」）
- 导出文件自带签名证明出处
- 导出频率限流（防止撞库）

### S5. 租户隔离

- 所有 SQL / CH 查询**必须**带 `WHERE tenant_id = ?`
- 通过 ORM 层中间件强制注入（参考 Drizzle RLS plugin）
- 单租户私有化部署：`tenant_id = 'default'`

### S6. 字段脱敏

- 写入前过滤掉 PII（手机 / 邮箱 / 身份证 / 银行卡）
- 客户自定义规则通过 `@agenticx/policy-engine` 注入
- 脱敏规则变更本身留审计

### S7. 留存与销毁

- 留存期可配置（默认 ≥ 项目服务期，首个客户项目配 365 天）
- 到期自动归档到冷存储（S3 / MinIO，加密）
- 销毁时记录销毁事件（包括操作人和时间）

---

## 存储策略（分层）

| 层 | 用途 | 选型 | 保留期 |
|---|---|---|---|
| **热** | 最近 7 天实时查询 | ClickHouse 热分区 | 短 |
| **温** | 7 天 ~ 90 天查询 | ClickHouse 冷分区 | 中 |
| **冷** | ≥ 90 天合规归档 | S3/MinIO + 加密 + 签名 | 长 |
| **本地** | 网关/Edge Agent 本地应急日志 | JSON append-only | 随合同期 |

**首个客户项目当期策略（对齐技术规范书 §1.5(3)）：**
- 仅启用「本地 JSON」层 → 本地磁盘 append-only 文件
- ClickHouse 为远期规划
- 存储期 ≥ 项目服务期，不自动清理
- 支持基础指令或简易界面查看

---

## OTel 集成（可选后端）

本模块通过 **OpenTelemetry OTLP Exporter** 允许客户选择对接外部 LLMOps 平台：

```yaml
# customers/<client-name>/config/audit.yaml
audit:
  storage:
    - type: local-json
      dir: /var/log/agenticx/audit
      rotation: daily
      retention_days: 365
  exporters:
    - type: otlp-http
      endpoint: https://langfuse.internal.client-a.com/api/public/otel
      enabled: false  # 客户决定是否启用
```

**关键**：
- Langfuse 只是**可选后端**，enterprise 不强依赖
- 不 import 任何 `@langfuse/*` npm 包
- 通过 OTel 标准协议对接，更换后端零改动

---

## 当期实现范围（MVP，对齐首个客户项目）

- [x] AuditEvent schema 定义（`packages/core-api`）
- [ ] 本地 JSON 写入 + checksum 链
- [ ] 基础查询 API + RBAC
- [ ] Admin UI：列表 + 过滤 + 导出
- [ ] 四维查询数据源对接（`features/metering`）

**远期**：
- [ ] ClickHouse 集成
- [ ] OTel Exporter
- [ ] 链完整性定期审计任务
- [ ] 冷归档 + 销毁策略

---

## 相关

- [ADR-0001 开源基座选型](../../docs/adr/0001-oss-foundations-selection.md)
- [Edge Agent 安全模型](../../apps/edge-agent/docs/security-model.md)
- [主架构 §5 多租户 · §6 插件协议](/docs/plans/2026-04-21-agenticx-enterprise-architecture.md)
