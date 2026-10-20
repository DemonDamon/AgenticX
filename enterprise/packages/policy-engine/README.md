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

## 公开检索来源

`EvalContext.PublicRetrieval` 只由可信调用方设置，不能从用户元数据带入。

请求阶段且该标记为真时，个人信息类 PII（手机号、邮箱、身份证、银行卡；不含 `api-key`）的 `block` / `redact` 降为 `warn`。关键词、正则、密钥（`api-key`）和字段规则保持原动作。响应阶段不降级。未标记的普通请求行为不变。

网关只在验过门户签名后设置该标记。请求头为 `x-agenticx-policy-timestamp`、`x-agenticx-policy-nonce`、`x-agenticx-policy-signature`；请求体 `__policy_context` 的 `source` 为 `public-retrieval`，`user_text_sha256` 是原文的 SHA-256。签名串为 `HMAC-SHA256(GATEWAY_INTERNAL_TOKEN, "public-retrieval-v2\n" + Authorization 原值 + "\n" + timestamp + "\n" + nonce + "\n" + 原始请求体字节)`。时间窗 ±5 分钟，nonce 在窗口内去重。校验后清空该字段，不转发给上游模型。签名缺失、过期、不匹配、nonce 重放或原文对不上时，按普通请求审查。

原文判定：只有一条 user 且系统提示含「研究规划助手」或「调研开题助手」时，整条 user 视为原文；有多条 user 时，把全部 user 以 `\n\n` 拼接为原文。大纲、分节写作等单条 user 的生成提示不签名，仍走普通审查。用户原文里的个人信息仍按原动作处理。公开证据降级出来的提醒另写一条 `policy_hit` 审计；审计写入失败与其它策略命中一样返回错误。

`GATEWAY_INTERNAL_TOKEN`（或 `GATEWAY_INTERNAL_TOKEN_FILE`）只放在服务端，禁止放进 `NEXT_PUBLIC_*`。门户与网关必须配置同一密钥。

# @agenticx/policy-engine

JS 端规则检查引擎
