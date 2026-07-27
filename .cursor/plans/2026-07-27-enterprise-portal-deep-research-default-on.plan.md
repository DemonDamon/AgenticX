# Enterprise Portal 深度研究默认开启与入口跟随开关

Planned-with: grok-4.5  
Suggested-Impl-Model: grok-4.5

## Goal

深度研究租户开关默认 ON；设置关闭时隐藏侧栏「深度研究」入口，避免入口与总闸不一致。

## In scope

- `enterprise/packages/db-schema`：schema default + PG `0034` / MySQL `0006` 迁移
- `tenant-config.ts` / `orchestrator.ts` 无行回落默认 true
- `WorkspaceShell` 按 `/api/me/web-search` 显隐入口
- `SettingsPanel` 初始态与文案；保存后广播配置事件

## Out of scope

- 深度研究 BFF 流水线逻辑变更
- Desktop

## Requirements

- FR-1: 新建租户 / 无配置行时 deepResearchEnabled 默认为 true
- FR-2: 迁移将既有 false 刷为 true，并改列 DEFAULT
- FR-3: 设置关闭时侧栏不展示深度研究按钮；开启时展示
- FR-4: 设置页文案改为「默认开启」

## Acceptance

- AC-1: 迁移后设置页开关为开
- AC-2: 关闭开关后侧栏入口消失，再开后恢复
