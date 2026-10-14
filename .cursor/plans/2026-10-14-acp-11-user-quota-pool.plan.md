# acp-11 用户配额不进入共享池

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

用户套餐不能被记到部门共享池。原先 `poolScopeForAssignment` 在 `scopeType === "user"` 时仍返回部门池。

## 落点

- 新文件 `enterprise/apps/admin-console/src/lib/db-stores/quota-pool-scope.ts`：只接受 `tenant` 或 `dept`。
- `postgresql/quota-plans-store.ts` 与 `mysql/quota-plans-store.ts` 删除本地函数，改为引用上述文件。两个调用点在 `scopeType === "user"` 时已经直接返回。

## AC

- `cd enterprise/apps/admin-console && npx vitest run src/lib/db-stores/quota-pool-scope.test.ts` 通过。
- 部门池仍用部门 id，租户池仍用租户 id。
