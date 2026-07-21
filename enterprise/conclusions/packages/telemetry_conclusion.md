# @agenticx/telemetry 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/telemetry` 当前仍是**空占位 stub**——`src/index.ts` 仅 `export const packageName = "telemetry" as const` 并标注 `// TODO: implement`，无任何实现、无测试、无依赖。预留给"埋点 · 审计上报"统一通道，但**尚未落地**，也**无任何 app 消费**（仅出现在 `tsconfig.base.json` 与 docs 中）。

## 目录结构

```
packages/telemetry/
├── package.json             # @agenticx/telemetry，private，main/types → ./src/index.ts
├── README.md                # 一行说明
├── tsconfig.json
└── src/
    └── index.ts             # 仅 packageName 常量 + TODO: implement
```

## 关键导出

只有：`packageName = "telemetry"`（const）

## 显著模式

- 与 `branding`（早期）、`policy-engine`（TS 侧）同属占位模板：一个 const + `TODO: implement` marker
- `package.json` 无 `dependencies`、无 `test` 脚本（仅 `lint`/`typecheck` placeholder）
- **审计事件形状已在 `@agenticx/core-api/audit.ts` 定义**（`AuditEvent` / `AuditPolicyHit` / `AuditQueryInput` / `AuditQueryResult`，含 tenant/user/dept/session 四主体、token 用量、哈希链 `prev_checksum`/`checksum`/`signature`、跨境 `cross_border`/`residency_rule`）——本包将来变成这些 payload 的 reporter

## 状态

**尚未实现**。当前 enterprise 内的审计上报由各 app（admin-console / web-portal）自行写入 PG，或由 gateway 的 `audit/` 包（append-only JSONL + PG `gateway_audit_events` best-effort 双写 + Blake2b 哈希链）负责。本包是预留的统一上报通道，**目前无人调用**。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/core-api` | 类型契约（计划） | 将上送 `core-api/audit.ts` 中的 `AuditEvent` |
| `apps/gateway` | 计划替代 | gateway 现有自己的 `audit/` 包；未来可能统一到此 |
| 各 feature 包 | 计划消费 | 业务方将来通过本包做埋点（当前 0 消费） |
| `tsconfig.base.json` | 路径注册 | 仅被 tsconfig 路径映射引用，无运行时引用 |
