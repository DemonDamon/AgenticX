# 插件协议（Plugin Protocol）

Enterprise 插件通过 YAML **manifest** 描述，Gateway 与管理台策略中心共同消费。源码目录：`enterprise/plugins/`。

---

## Manifest 类型

| type | 用途 | 状态 |
|---|---|---|
| `rule-pack` | 合规/敏感词/PII 规则 | **已实现**（3 个 moderation 包） |
| `tool-pack` | 工具能力扩展模板 | Stub（watermark/doc-review） |
| `theme-pack` | 白标主题 | Stub（theme-default） |

---

## rule-pack 规范

### 顶层字段

```yaml
name: moderation-pii-baseline    # 唯一标识，extends 引用此 name
version: 0.1.0
type: rule-pack
description: 人类可读描述
extends: moderation-pii-baseline  # 可选，继承另一 rule-pack（Go loader：单字符串）
rules:
  - id: pii-email
    kind: pii | keyword | regex
    action: block | warn | redact
    severity: critical | high | medium | low
    message: 命中时对用户/审计展示的文案
    # kind 专属字段见下
```

### kind: pii

```yaml
kind: pii
pii_type: email | mobile | id-card | bank-card | api-key
```

Go policy-engine 内置 detector；`redact` 替换占位符，`block` 中断请求。

### kind: keyword

```yaml
kind: keyword
keywords:
  - 关键词1
  - 关键词2
```

### kind: regex

```yaml
kind: regex
pattern: "(?i)正则表达式"
```

---

## 动作语义

| action | Gateway 行为 | UI blocked 标志 |
|---|---|---|
| `block` | 中断，返回业务错误 | true |
| `warn` | 放行，记录 hits | false |
| `redact` | 替换敏感片段后继续 | false |

Admin 策略测试 `POST /api/policy/test`：`blocked` **仅** action=block 时为 true。

---

## extends 继承

示例：`moderation-finance/manifest.yaml`

```yaml
extends: moderation-pii-baseline
rules:
  - id: finance-keyword-insider
    kind: keyword
    ...
```

**限制（Go loader）**：

- `extends` 类型为**单个字符串**，数组会导致反序列化失败或只取首项
- 继承链在加载时合并 rules；子 pack 可覆盖同 id（以实现为准）

---

## 官方 rule-pack

| 目录 | extends | 说明 |
|---|---|---|
| `moderation-pii-baseline` | — | 邮箱/手机/身份证/银行卡/API Key |
| `moderation-finance` | pii-baseline | 金融关键词 + 正则 warn |
| `moderation-medical` | pii-baseline | 医疗 PHI 关键词 warn |

Gateway 默认扫描：`../../plugins/moderation-*/manifest.yaml`（见 `apps/gateway/internal/config/config.go`）。

---

## PG 策略与 manifest 关系

1. **Plugins** — 内置基线，随 Gateway 部署
2. **Admin 策略中心** — 租户自定义规则写 `policy_rules`，发布进 `enterprise_runtime_policy_snapshots`
3. **Gateway** — 合并快照 + override 文件热加载

客户专属规则应优先放 **PG 策略中心** 或 `customers/*/rules/`，而非改 `@agenticx/*` 源码。

---

## tool-pack / theme-pack（预留）

```yaml
name: tool-watermark
version: 0.1.0
type: tool-pack
description: PDF 水印工具模板
# 当前 manifest 为空壳 TODO
```

实现路线图：与 Machi tool registry / enterprise 工具市场对接，协议待稳定后补全 schema 文档。

---

## 客户自定义插件

1. 在 `customers/<client>/plugins/<name>/manifest.yaml` 定义 rule-pack
2. 部署时将 manifest 路径加入 Gateway 配置或导入 admin 策略包
3. 遵循 [guides/enterprise-customers-collaboration.md](../guides/enterprise-customers-collaboration.md)：**不改** enterprise 主干

---

## 相关文档

- [gateway/policy-engine.md](../gateway/policy-engine.md) — 三通道评估
- [runbooks/policy-snapshot-rollback.md](../runbooks/policy-snapshot-rollback.md)
- Admin UI：策略规则中心 `/policy`
