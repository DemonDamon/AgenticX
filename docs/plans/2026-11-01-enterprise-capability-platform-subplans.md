# Enterprise Capability Platform — Subplan Index

> Parent: `docs/plans/2026-10-31-enterprise-capability-platform-master-plan.md`  
> Status: executing (serial)  
> Date: 2026-11-01  
> Execution: **串行** E1→E2→E3→E4→E5；每期合入前跑该期 E2E；E5 跑完整闭环 case。不并行多 agent 改同一底座，避免 schema/API 打架。

| ID | File | Delivers | Depends |
|---|---|---|---|
| E1 | `2026-11-01-ecp-e1-distribution.md` | 跨租户 grant/revoke + 平台物只读元数据 | — |
| E2 | `2026-11-01-ecp-e2-shelf-lifecycle.md` | draft/publish + 版本 + scan 门禁 | E1 |
| E3 | `2026-11-01-ecp-e3-approval-workflow.md` | 可配置 1～N 级审核 | E2 |
| E4 | `2026-11-01-ecp-e4-expert-package.md` | expert_package + 目录分层 + 安装副本开关 | E1+E2 |
| E5 | `2026-11-01-ecp-e5-harden-e2e.md` | 文档硬化 + 完整 E2E 闭环 | E1–E4 |

## Global constraints (every subplan)
- Main 准入：只进通用平台能力；客户文案/云盘席位/固定三级审核路径禁止进 `agenticx/` 与 enterprise 通用层。
- 作者：commit / squash-merge 仅 Damon Li（DemonDamon）；无 AI Co-authored-by。
- Revoke 默认：停新下发与后续更新，**保留已同步副本**；立即剥离为可选。
- 阶段 1–2：**不做**安装副本；副本仅 E4 企业策略开关（默认关）。
- 验收：合成多租户 E2E，不绑真实客户配置。
