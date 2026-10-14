# acp-10 用量接口不再返回配额文件路径

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

`GET/PUT /api/metering/quota` 只返回配额内容，不再带 `file` 字段。该字段以前指向遗留的 `quotas.json` 路径。

## 落点

- `enterprise/apps/admin-console/src/app/api/metering/quota/route.ts`：去掉 `quotaFilePath()` 与响应里的 `file`。
- 额度页只读 `data.quota`，不改页面。

## AC

- `cd enterprise/apps/admin-console && npx vitest run src/app/api/metering/quota/route.test.ts` 通过。
- 响应 JSON 不含 `file`，也不含 `quotas.json`。
