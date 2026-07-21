# @agenticx/policy-engine 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/policy-engine` 表面是 npm `package.json`（description 写 "JS 端规则检查引擎"），但 **TS 侧仅是 stub 占位**——`src/index.ts` 只导出 `packageName = "policy-engine"` 并标注 `// TODO: implement`，没有任何 JS 端可用逻辑。**真正的实现在 Go**：本目录下的 `.go` 文件组成 Go module `github.com/agenticx/enterprise/policy-engine`（go 1.22，依赖 `gopkg.in/yaml.v3`），由 `apps/gateway` 通过 `go.mod` 的 `replace github.com/agenticx/enterprise/policy-engine => ../../packages/policy-engine` 在进程内引入。引擎在 chat 文本与 JSON payload 上**评估合规 / PII / 字段规则**，规则种类与动作可插拔。

## 目录结构

```
packages/policy-engine/
├── package.json                # @agenticx/policy-engine（TS stub，main → ./src/index.ts）
├── tsconfig.json
├── go.mod                      # module github.com/agenticx/enterprise/policy-engine（go 1.22）
├── src/index.ts                # TS stub：仅 packageName 常量 + TODO
├── engine.go                   # Engine、NewEngine、Evaluate/EvaluateWithContext、compileRule、matchesAppliesTo、applyHit、baselinePIIRegex
├── types.go                    # Rule、RulePackManifest、AppliesTo、EvalContext、HitEvent、EvaluateResult、RuleKind、Action
├── loader.go                   # LoadRulePacks/LoadRulePacksWithDisabled（YAML glob + extends DFS + 循环检测 + disabled）
├── fields.go                   # EvaluateJSONFields（field kind，JSON path + [*] 通配，allow/deny/redact）
├── keyword_trie.go             # 基础前缀树（trie，非 Aho-Corasick，无 failure 链）
├── engine_test.go              # 引擎评估测试
├── engine_fields_test.go       # 字段规则测试
├── engine_applies_to_test.go   # AppliesTo 维度匹配测试
└── loader_test.go              # extends 解析 / 循环检测测试
```

## 关键导出（Go）

**函数**：
- `NewEngine([]RulePackManifest) (*Engine, error)`——遍历 manifest 编译每条 rule
- `Engine.Evaluate(text, stage)`——便捷入口，构造全通配 `EvalContext` 后转 `EvaluateWithContext`
- `Engine.EvaluateWithContext(text, EvalContext)`——文本类规则评估（keyword/regex/pii）
- `Engine.EvaluateJSONFields(raw, ctx)`——字段类规则评估（field kind）
- `LoadRulePacks(glob)` / `LoadRulePacksWithDisabled(glob, disabledPacks)`

**类型**：`Rule`、`RulePackManifest`、`AppliesTo`、`EvalContext`、`HitEvent`、`EvaluateResult`、`compiledRule`（私有）

**枚举**：
- `RuleKind` = `keyword | regex | pii | field`
- `Action` = `block | redact | warn`
- `FieldTarget` = `request | response`；`FieldAction` = `allow | deny | redact`

## 显著模式

- **Pack 继承（extends 为单字符串）**：`RulePackManifest.Extends` 在 `types.go` 中是 `string`（**非数组**），`loader.go` 用 DFS 解析继承链，`stack`/`visited` 做循环检测，父 pack 的 `Rules` 前置 append；`disabledPacks` 中的 pack 跳过
- **规则一次编译**：`compileRule` 按 `Kind` 编译成 `compiledRule`——keyword → `keywordTrie`；regex → `regexp.Compile`；pii → `baselinePIIRegex`（mobile / email / id-card / bank-card / api-key 五类基线正则）；field → 校验 `JSONPath` 非空
- **keyword_trie 是基础前缀树，不是 Aho-Corasick**：`findAll` 用双层循环（外层每个起点、内层沿 trie 下行），大小写不敏感，**没有 failure 链**，复杂度 O(n·m)；不要误认为 Aho 自动机
- **EvaluateWithContext 流程**：先按 `tenant_id` 过滤（任一端空则跳过该过滤）→ `matchesAppliesTo`（依次：`UserExcludeIDs` 命中则弃 → `Stages` 必匹配 → `ClientTypes` 必匹配 → `UserIDs` 非空则必须包含 → `deptMatch || roleMatch` 并集）→ switch 仅处理 `keyword/regex/pii`（**field kind 在此路径不处理，需走 `EvaluateJSONFields`**）→ 命中送 `applyHit`
- **applyHit 动作语义**：`block` 置 `Blocked=true`；`redact` 把命中片段替换为 `[REDACTED]`；`warn` 仅记录 `HitEvent`，不改文本
- **字段规则（fields.go）**：`EvaluateJSONFields` 只处理 `field kind`，按 `target`（request/response，默认 response）与 stage 匹配，`splitJSONPath` 支持 `[*]` 数组通配，`collectFieldMatches` 递归定位；`deny` 置 `Blocked`，`redact` 直接改写 `parent[key] = "[REDACTED]"`，`allow` 仅记录命中不改值
- **Go 引擎能力边界**：只识别 `keyword/regex/pii/field`（不含 `keyword-list`）；17 种密钥检测仍留在主仓 AgenticX Python 框架，**未进** Go 网关

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/gateway` | Go `replace` 引入 | 在 gateway 进程内执行；`internal/server`（`server.go`/`protocol_handlers.go`/`rbac_integration.go`）与 `internal/mcphost/host.go` 调用，从 admin-console 发布的 snapshot 加载 pack |
| `apps/admin-console` | 间接 | 在 `/policy/*` 路由编辑规则、发布快照，snapshot 端点供 gateway 拉取 |
| `packages/db-schema` | 间接 | rule pack / version / publish 表在那 |
| TS `src/index.ts` | 仅占位 | 没有 JS 端可用导出，`// TODO: implement` |
