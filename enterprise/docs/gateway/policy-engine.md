# Gateway 策略引擎

实现：`packages/policy-engine/go/`（Gateway 内嵌）  
Admin 管理：`@agenticx/feature-policy` + `/policy` UI  
插件 manifest：[plugin-protocol/README.md](../plugin-protocol/README.md)

---

## 三通道评估

| 通道 | 时机 | 说明 |
|---|---|---|
| Request | 收到用户 messages 后、调用上游前 | block 直接返回，不消耗上游 |
| Response | 非流式完整响应 | 可对 assistant 内容 block/warn/redact |
| Stream | SSE 分片扫描 | 流式 idle timeout + buffer 上限防挂起 |

源码入口：`apps/gateway/internal/server/server.go` 策略调用点。

---

## 规则类型（Go 引擎）

| kind | 说明 | payload / manifest 字段 |
|---|---|---|
| `keyword` | 关键词 Trie | `keywords[]` |
| `regex` | 正则 | `pattern` |
| `pii` | 内置 detector | `pii_type`: email, mobile, id-card, bank-card, api-key |

**不支持**（与 Python 框架差异）：`keyword-list` 作为独立 kind。

---

## 动作

| action | 行为 |
|---|---|
| `block` | 中断；Portal 须展示合规拦截 UI（非模型自然语言拒答） |
| `warn` | 记录 hits，继续 |
| `redact` | 替换敏感片段后继续 |

Admin 测试接口：`blocked` **仅** action=block 时为 true。

---

## 规则来源合并

```
1. plugins/moderation-*/manifest.yaml     (部署内置)
2. enterprise_runtime_policy_snapshots    (admin 发布)
3. GATEWAY_POLICY_OVERRIDE_FILE           (本地覆盖，调试)
```

发布流程：

- 草稿：`policy_rules.status = draft` — **不**进快照
- 发布：`POST /api/policy/publish` → snapshot JSON
- 回滚：`POST /api/policy/publishes/:id/rollback`

Runbook：[runbooks/policy-snapshot-rollback.md](../runbooks/policy-snapshot-rollback.md)

---

## applies_to 范围

规则/规则包可选 JSONB `applies_to`：

- `departmentIds` + `departmentRecursive`
- `roleCodes`
- `userIds` / `userExcludeIds`
- `clientTypes`, `stages`

**陷阱**：`userIds` 填占位示例（如 `u1,u2`）会导致真实 JWT 用户不匹配，规则永不生效。全员规则宜留空。

---

## 审计命中结构

Gateway 审计 `policies_hit` JSONB 含：

- `matched_rule` — 规则 id/code
- `severity`, `action`
- 消息摘要

**不是** `rule_id` / `reason` 旧字段名（排查历史数据时注意）。

---

## Admin 策略测试

```
POST /api/policy/test
```

- 合并**当前表单预览**（未保存 action/payload）与库内已发布规则
- 避免「界面选拦截仍按库里旧动作计算」

UI 中文展示：拦截/警告/脱敏；关键词/正则/PII。

---

## 行业插件包

| Pack | extends | 场景 |
|---|---|---|
| moderation-pii-baseline | — | 通用 PII |
| moderation-finance | pii-baseline | 金融 |
| moderation-medical | pii-baseline | 医疗 PHI warn |

客户专属规则：PG 策略中心或 `customers/*/rules/`，见协作手册。

---

## 流式加固

| 环境变量 | 用途 |
|---|---|
| `GATEWAY_STREAM_IDLE_TIMEOUT` | SSE 空闲切断 |
| `GATEWAY_STREAM_SCANNER_MAX_BUFFER_MB` | 单 chunk 缓冲上限 |

防止恶意/异常流式响应占满内存。

---

## 相关文档

- [overview.md](./overview.md)
- [../plugin-protocol/README.md](../plugin-protocol/README.md)
