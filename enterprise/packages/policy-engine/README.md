# @agenticx/policy-engine (Go)

AgenticX W3 策略引擎实现，提供：

- RulePack manifest 加载（支持 `extends` 继承链）
- 关键词检测（Trie 自动机）
- 正则与 PII 基线检测（手机号/邮箱/身份证/银行卡/API Key）
- action 处理：`block` / `redact` / `warn`
- 命中事件结构化输出（供网关审计与前端提示）

## 用法

```go
manifests, _ := policyengine.LoadRulePacks("../../plugins/moderation-*/manifest.yaml")
engine, _ := policyengine.NewEngine(manifests)
result := engine.Evaluate("测试文本", "request")
```

# @agenticx/policy-engine

JS 端规则检查引擎
