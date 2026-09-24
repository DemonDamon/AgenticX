# 04 · 控制台：设备与授权

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Master:** `.cursor/plans/pending/2026-09-07-mobile-edge-control-master.plan.md`  
**依赖:** 01 已合并（`listEdgeDevicesForAdmin` / `revokeGrantById`）。  
**Goal:** admin-console 增加「设备」页：按权限看本租户桌面/手机、在线、授权到期；可吊销控制授权。

**Architecture:** 新路由挂在 ops 分组。API 用现有 `requireAdminSomeScope`。列表真查 PG，禁止 mock store。

**Tech Stack:** Next.js admin-console、`@agenticx/ui`（PageHeader / Badge / Button / Card）、next-intl。

---

## 实施前必读 skill

1. `.agents/skills/redesign-existing-projects/SKILL.md`
2. `.agents/skills/emil-design-eng/SKILL.md`
3. Master 第 5 节（admin 密度 5）

**Design Read：** 与 Master 同一句。这是管理页，不是营销页。

对齐现有 `enterprise/apps/admin-console/src/app/admin/session-grants/page.tsx`：PageHeader、toast、`adminFetch`、二次确认删除。设备页用 **卡片网格**（IAM 部门卡片偏好），不要新上层级树。

- 一用户一卡片，内列该用户设备
- 在线绿点 / 离线灰点，与 portal 同源字段，前端不重算 45s
- 吊销用主题 Button + 确认 Dialog（`@agenticx/ui` Dialog），禁止 `window.confirm`
- 无外发光、无新色板；状态只用已有 `Badge variant="success"` / muted

---

## In scope

- `GET/DELETE` admin API + 测试
- 页面 `/iam` 不合适：挂 **ops**，路径 `/admin/devices`
- nav + zh/en
- 吊销二次确认

## Out of scope

- Desktop / portal UI
- 远程擦除、推送、定位
- 改审计写入、改 IAM 角色种子以外的大规模权限模型
- 新 scope 字符串（复用已有）

---

## 权限（写死）

| 操作 | scopes（任一即可） |
|---|---|
| 列表 | `audit:read:all` 或 `audit:read:dept` |
| 吊销 | `audit:manage` |

`readAll = scopes.includes("audit:read:all")`。部门管理员只看本 `deptId` 用户（01 的 `listEdgeDevicesForAdmin`）。

无权限：403，页面 toast「没有权限查看设备」。不要把表名或 SQL 拼进 message。

---

## FR / AC

- **FR-04-1** 侧栏 ops 出现「设备」，路由高亮跟随 `/admin/devices`。
  - **AC-04-1** `AppShell.tsx` `NAV_GROUPS` ops 数组含该 href；点进页面后该项 `bg-sidebar-accent`（现有逻辑，勿改高亮算法）。
- **FR-04-2** GET 返回真数据，含 email、kind、online、grantExpiresAt、controllable。
  - **AC-04-2** `enterprise/apps/admin-console/src/app/api/admin/edge-devices/__tests__/route.test.ts` mock service。
- **FR-04-3** DELETE 吊销该桌面 active grant；无 grant 返回 404。
  - **AC-04-3** 同上测试。
- **FR-04-4** 空态：`EmptyState`（`@agenticx/ui` 若已有）文案「还没有已登记的设备」。
- **FR-04-5** 文案中文，无路径、无表名、无外部产品名、无 `—`。
- **FR-04-6** 卡片在 390 宽单列，`md` 两列。

---

### Task 1: API

**Files:**

- Create: `enterprise/apps/admin-console/src/app/api/admin/edge-devices/route.ts`
- Create: `enterprise/apps/admin-console/src/app/api/admin/edge-devices/[deviceId]/revoke/route.ts`
- Create: `enterprise/apps/admin-console/src/app/api/admin/edge-devices/__tests__/route.test.ts`

对照 `enterprise/apps/admin-console/src/app/api/portal-logs/query/route.ts` 的 `requireAdminSomeScope` mock 测试写法。

GET `/api/admin/edge-devices`：

```ts
const guard = await requireAdminSomeScope(["audit:read:all", "audit:read:dept"]);
if (guard instanceof Response) return guard;
const readAll = guard.scopes.includes("audit:read:all");
const items = await listEdgeDevicesForAdmin({
  tenantId: guard.tenantId,
  deptId: guard.deptId ?? null,
  readAll,
});
return Response.json({ code: "00000", message: "ok", data: { items } });
```

`guard` 的真实字段名以 `admin-auth.ts` 为准（可能是 `session.tenantId`）。**先读** `enterprise/apps/admin-console/src/lib/admin-auth.ts` 再写，不要猜。

DELETE `/api/admin/edge-devices/:deviceId/revoke`：

- `requireAdminSomeScope(["audit:manage"])`
- 调 service：找到该 `deviceId` 的 active grant 再 `revokeGrantById`
- 成功 `{ code: "00000" }`
- 找不到 `{ code: "40410", message: "没有可吊销的授权" }` status 404

若 01 未导出「按 device 吊销」，允许在 `edge-device-service.ts` **只加** `revokeActiveGrantForDesktopDevice({ tenantId, desktopDeviceId })`，不要改其它服务。

---

### Task 2: 页面

**Files:**

- Create: `enterprise/apps/admin-console/src/app/admin/devices/page.tsx`
- Modify: `enterprise/apps/admin-console/src/components/AppShell.tsx` ops items，插在 `portal-logs` 后：

```ts
{ href: "/admin/devices", labelKey: "devices", icon: Smartphone },
```

`Smartphone` 从 lucide-react 引，该文件已有大量 lucide import。

页面：

- `PageHeader` 标题来自 i18n
- Breadcrumb：运维监控 / 设备
- `adminFetch("/api/admin/edge-devices")`
- 按 `userId` group
- 卡片内行：种类（电脑/手机）、名称、在线 Badge、授权到期或「未授权」、电脑行才有「吊销」
- 吊销：Dialog「吊销后手机将不能把任务派到这台电脑。确定吊销？」主按钮危险色；取消在保存/确认左侧（Master/AGENTS 按钮顺序）

加载：骨架用现有 `Skeleton`，不要只转圈超过 2s 无文字。失败 toast，保留页。

---

### Task 3: i18n

**Files:**

- Modify: `enterprise/apps/admin-console/messages/zh.json` `nav.items.devices`: `设备`
- Modify: `enterprise/apps/admin-console/messages/en.json` `nav.items.devices`: `Devices`
- 同文件增加 `devices` 页文案块（标题、空态、在线、离线、电脑、手机、吊销、确认）

禁止用户文案写 `enterprise_edge_devices`。

---

### Task 4: 自测

```bash
pnpm --filter @agenticx/admin-console exec vitest run src/app/api/admin/edge-devices/__tests__/route.test.ts
```

浏览器（admin 已登录）：

1. 侧栏出现「设备」，进入后高亮在「设备」不是「Portal 日志」
2. 有 01/02 登记过的桌面则能看见
3. 吊销后刷新，该行「未授权」；portal 电脑 `controllable` 应变 false（若 03 已就绪）

长页：侧栏 `lg:sticky` 已有，不要改成跟内容一起滚。

---

## no-scope-creep

禁止改 dashboard 数字、禁止改 IAM 用户页、禁止在 Help/tooltip 写运行时 JSON 路径。
