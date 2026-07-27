# Admin 策略规则中心快速关停

Planned-with: grok-4.5  
Suggested-Impl-Model: grok-4.5

## Goal

策略规则中心增加「全部关停」与单条「关停」，方便联调时快速软停用规则。

## In scope

- `enterprise/apps/admin-console/src/app/policy/page.tsx`
- `messages/zh.json` / `en.json` 文案

## Out of scope

- Gateway 引擎、策略存储 schema
- 永久删除语义变更（删除仍为确认后的软停用）

## Requirements

- FR-1: 顶栏「全部关停」：确认后停用全部未停用规则并自动发布
- FR-2: 规则行「编辑」与「删除」之间「关停」：一键软停用，提示再发布
- FR-3: 复用现有 `PATCH status=disabled` / 发布接口

## Acceptance

- AC-1: 单条关停后状态为已停用，可恢复
- AC-2: 全部关停后规则均停用且触发发布
