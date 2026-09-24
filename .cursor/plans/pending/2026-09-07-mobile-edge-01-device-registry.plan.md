# 01 · 设备登记与授权 API

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Master:** `.cursor/plans/pending/2026-09-07-mobile-edge-control-master.plan.md`  
**Goal:** 在 PG / MySQL 落地设备与授权表，并提供 Desktop PAT 与 portal Cookie 两套只读/写入 API。不含任何 UI。

**Architecture:** 新表不改 `desktop_device_auth`。服务放 `iam-core`，portal 路由只做鉴权与 JSON。在线阈值写死 45s。

**Tech Stack:** Drizzle（PG + MySQL 双份）、`@agenticx/iam-core`、Next.js route handlers、vitest。

---

## In scope

- `enterprise_edge_devices` / `enterprise_edge_grants` 的 schema、SQL、journal、schema-parity
- `edge-device-service.ts` + 单测
- portal：Desktop PAT 路由 + Cookie 会话路由 + 单测
- `iam-core/src/index.ts` 增加一行 export

## Out of scope

- Desktop / portal / admin 任何 UI
- `enterprise_edge_jobs`（05 才建）
- 改 `desktop-device-auth-service.ts` 或 `/api/desktop/auth/*`
- 改 `AuditClientType`、Gateway、`server.py`
- 真派发、目录 ACL 强制

---

## 根因与证据

跨设备需要「哪台电脑、是否在线、是否允许被手机控制」。现有 `desktop_device_auth`（`enterprise/packages/db-schema/src/schema/desktop-device-auth.ts`）只是登录设备码状态机（pending → consumed），PAT 明文不存。不能把「允许控制」塞进该表，否则登录与授权耦合、过期语义冲突。

Desktop 已有 PAT 解析：`enterprise/apps/web-portal/src/lib/desktop-auth.ts` 的 `resolveDesktopIdentity`。Portal 用户会话：`getWorkspaceSessionFromCookies`（`enterprise/apps/web-portal/src/lib/session.ts` L134）。

最新迁移：PG `0049_enterprise_collab_rooms`，MySQL `0023_enterprise_collab_rooms`。本计划用 **0050** / **0024**。

---

## 数据模型（写死，禁止改列名）

### `enterprise_edge_devices`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | varchar(26) | PK，ULID |
| `tenant_id` | varchar(26) | NOT NULL，FK tenants |
| `user_id` | varchar(26) | NOT NULL，FK users |
| `kind` | varchar(16) | `desktop` \| `mobile` |
| `display_name` | varchar(128) | NOT NULL |
| `fingerprint` | varchar(64) | NOT NULL；桌面=本机稳定 id，手机=浏览器生成后存 localStorage |
| `last_seen_at` | timestamptz | NOT NULL |
| `created_at` / `updated_at` | timestamptz | auditColumns |

唯一索引：`(tenant_id, user_id, kind, fingerprint)`  
查询索引：`(tenant_id, user_id, last_seen_at)`

### `enterprise_edge_grants`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | varchar(26) | PK |
| `tenant_id` | varchar(26) | NOT NULL |
| `user_id` | varchar(26) | NOT NULL |
| `desktop_device_id` | varchar(26) | NOT NULL，FK devices ON DELETE CASCADE |
| `status` | varchar(16) | `active` \| `revoked` \| `expired` |
| `scope` | varchar(32) | 固定 `mobile_control` |
| `folder_scope` | varchar(32) | 固定 `created_tasks` |
| `expires_at` | timestamptz | NOT NULL |
| `revoked_at` | timestamptz | 可空 |
| `created_at` / `updated_at` |  | auditColumns |

部分唯一：同一 `desktop_device_id` 同时只能有一行 `status = active`。PG 用部分唯一索引；MySQL 没有部分唯一时改为应用层：写入前把该设备旧 active 行改为 revoked，再 insert。单测必须覆盖「第二次 enable 不产生两行 active」。

常量：

```ts
export const EDGE_ONLINE_AFTER_MS = 45_000;
export const EDGE_GRANT_TTL_DAYS = 180;
export const EDGE_GRANT_SCOPE = "mobile_control";
export const EDGE_FOLDER_SCOPE = "created_tasks";
```

`isDeviceOnline(lastSeenAt, now = Date.now())`：`now - lastSeenAt.getTime() <= EDGE_ONLINE_AFTER_MS`。

`effectiveGrantStatus(row, now)`：若 `status === 'active' && expires_at <= now` 视为 `expired`（读时计算，不必扫表改库；吊销仍写库）。

---

## FR / AC

- **FR-01-1** 双库表与 parity 绿。
  - **AC-01-1** `pnpm --filter @agenticx/db-schema exec vitest run src/__tests__/schema-parity.test.ts` 绿。
- **FR-01-2** upsert 设备 + heartbeat 更新 `last_seen_at`。
  - **AC-01-2** `enterprise/packages/iam-core/src/edge-device-service.test.ts`：同 fingerprint 第二次 upsert 不新增行；`last_seen_at` 前进。
- **FR-01-3** enable grant：180 天、单 active。
  - **AC-01-3** 同上测试：`expires_at` 在 179–181 天窗口；第二次 enable 仍一行 active。
- **FR-01-4** disable / admin revoke 写 `revoked`。
  - **AC-01-4** 列表接口该设备 `controllable: false`。
- **FR-01-5** Desktop PAT 可 register / heartbeat / grant；无 PAT 返回 401。
  - **AC-01-5** `enterprise/apps/web-portal/src/app/api/desktop/edge/__tests__/route.test.ts`。
- **FR-01-6** Cookie 用户可列电脑、上报 mobile presence；未登录 401。
  - **AC-01-6** `enterprise/apps/web-portal/src/app/api/me/edge/__tests__/route.test.ts`。
- **FR-01-7** 列表项含 `online`（45s 规则）与 `controllable`（active 且未过期）。
  - **AC-01-7** 把 `last_seen_at` stub 成 46s 前则 `online: false`。

---

### Task 1: 失败测试（服务层）

**Files:**

- Create: `enterprise/packages/iam-core/src/edge-device-service.test.ts`

先写测试，import 尚不存在的函数，确认失败。

```ts
import { describe, expect, it, vi } from "vitest";
import {
  EDGE_GRANT_TTL_DAYS,
  EDGE_ONLINE_AFTER_MS,
  effectiveGrantStatus,
  isDeviceOnline,
} from "./edge-device-service";

describe("edge presence math", () => {
  it("treats last seen within 45s as online", () => {
    const now = 1_700_000_000_000;
    expect(isDeviceOnline(new Date(now - 44_000), now)).toBe(true);
    expect(isDeviceOnline(new Date(now - EDGE_ONLINE_AFTER_MS - 1), now)).toBe(false);
  });

  it("exposes 180-day default ttl", () => {
    expect(EDGE_GRANT_TTL_DAYS).toBe(180);
  });

  it("computes expired without requiring a sweep", () => {
    const now = new Date("2026-09-07T00:00:00.000Z");
    expect(
      effectiveGrantStatus(
        { status: "active", expiresAt: new Date("2026-09-06T00:00:00.000Z") },
        now,
      ),
    ).toBe("expired");
  });
});
```

Run: `pnpm --filter @agenticx/iam-core exec vitest run src/edge-device-service.test.ts`  
Expected: FAIL module not found。

---

### Task 2: Schema 双份

**Files:**

- Create: `enterprise/packages/db-schema/src/schema/edge-devices.ts`
- Create: `enterprise/packages/db-schema/src/mysql-schema/edge-devices.ts`（列逻辑一致，见 collab-rooms 双份写法）
- Modify: `enterprise/packages/db-schema/src/schema/index.ts` 在 collab-rooms 后加 `export * from "./edge-devices";`
- Modify: `enterprise/packages/db-schema/src/mysql-schema/index.ts` 同样一行
- Create: `enterprise/packages/db-schema/drizzle/0050_enterprise_edge_devices.sql`
- Create: `enterprise/packages/db-schema/drizzle-mysql/0024_enterprise_edge_devices.sql`
- Modify: `enterprise/packages/db-schema/drizzle/meta/_journal.json` 追加 idx 49 / tag `0050_enterprise_edge_devices`
- Modify: `enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json` 追加 idx 24 / tag `0024_enterprise_edge_devices`
- Modify: `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts` 的 MySQL 文件列表与 journal entries，在 `0023_enterprise_collab_rooms` 后加 `0024_enterprise_edge_devices.sql`

PG SQL 骨架（多语句必须 `--> statement-breakpoint`）：

```sql
CREATE TABLE IF NOT EXISTS "enterprise_edge_devices" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" varchar(26) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL,
  "display_name" varchar(128) NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_edge_devices_owner_kind_fp_uq"
  ON "enterprise_edge_devices" ("tenant_id", "user_id", "kind", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enterprise_edge_devices_owner_seen_idx"
  ON "enterprise_edge_devices" ("tenant_id", "user_id", "last_seen_at");
```

grants 表同样写全。MySQL 用反引号、`datetime`/`timestamp` 与现有 mysql-schema 风格对齐；禁止 `CHARSET`/`COLLATE` 子句（parity 测试会打）。

Drizzle 表名必须是 `enterprise_edge_devices` / `enterprise_edge_grants`，导出 `enterpriseEdgeDevices` / `enterpriseEdgeGrants`。

---

### Task 3: 服务实现

**Files:**

- Create: `enterprise/packages/iam-core/src/edge-device-service.ts`
- Create: `enterprise/packages/iam-core/src/repos/pg/edge-devices.ts` 与 `repos/mysql/edge-devices.ts`（或单文件内按现有 `desktop-device-auth-service.ts` 的动态 import 分支）
- Modify: `enterprise/packages/iam-core/src/index.ts` 增加 `export * from "./edge-device-service";`

对照 `desktop-device-auth-service.ts` 的 PG/MySQL 分支，**不要改那个文件**。

必须导出的函数：

```ts
upsertEdgeDevice(input: {
  tenantId: string;
  userId: string;
  kind: "desktop" | "mobile";
  displayName: string;
  fingerprint: string;
  now?: Date;
}): Promise<{ id: string; lastSeenAt: Date }>;

setDesktopMobileControlGrant(input: {
  tenantId: string;
  userId: string;
  desktopDeviceId: string;
  enabled: boolean;
  ttlDays?: number;
  now?: Date;
}): Promise<{ grantId: string | null; status: "active" | "revoked" | "expired"; expiresAt: string | null }>;

revokeGrantById(input: { tenantId: string; grantId: string; now?: Date }): Promise<boolean>;

listEdgeDevicesForUser(input: {
  tenantId: string;
  userId: string;
  now?: Date;
}): Promise<Array<{
  id: string;
  kind: "desktop" | "mobile";
  displayName: string;
  lastSeenAt: string;
  online: boolean;
  controllable: boolean;
  grantExpiresAt: string | null;
}>>;

listEdgeDevicesForAdmin(input: {
  tenantId: string;
  deptId?: string | null;
  readAll: boolean;
  now?: Date;
}): Promise<Array<{ /* 同上 + userId + userEmail */ }>>;
```

`controllable` = 该桌面存在 effective `active` grant。手机行永远 `controllable: false`。

`listEdgeDevicesForAdmin`：`readAll === false` 时只返回 `users.dept_id = deptId` 的用户设备（join users）。部门管理员不得看全租户。

在 `edge-device-service.test.ts` 用 vi.mock 掉 repo，覆盖 upsert / 单 active / revoke / online。不要连真库。

---

### Task 4: Desktop PAT 路由

**Files:**

- Create: `enterprise/apps/web-portal/src/app/api/desktop/edge/register/route.ts`
- Create: `enterprise/apps/web-portal/src/app/api/desktop/edge/heartbeat/route.ts`
- Create: `enterprise/apps/web-portal/src/app/api/desktop/edge/grant/route.ts`
- Create: `enterprise/apps/web-portal/src/app/api/desktop/edge/status/route.ts`
- Create: `enterprise/apps/web-portal/src/app/api/desktop/edge/__tests__/route.test.ts`

统一鉴权：

```ts
const identity = await resolveDesktopIdentity(request);
if (!identity) {
  return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
}
```

成功体一律 `{ code: "00000", message: "ok", data: ... }`。

| 方法 | 路径 | body | data |
|---|---|---|---|
| POST | `/api/desktop/edge/register` | `{ fingerprint, displayName }` | `{ deviceId, lastSeenAt }` |
| POST | `/api/desktop/edge/heartbeat` | `{ fingerprint }` | `{ deviceId, online: true, lastSeenAt }` |
| POST | `/api/desktop/edge/grant` | `{ enabled: boolean }` | `{ status, expiresAt }`；内部用该 PAT 用户的 desktop 设备 id |
| GET | `/api/desktop/edge/status` | 无 | `{ deviceId, online, controllable, expiresAt, preventSleepHint: null }` |

`grant` 若尚未 register：先 409 `{ code: "40910", message: "请先登记这台电脑" }`。

fingerprint / displayName：非空字符串，fingerprint 最长 64，displayName 最长 128，否则 400 `{ code: "40001" }`。

测试 mock `resolveDesktopIdentity` 与 `edge-device-service`，照抄 `enterprise/apps/web-portal/src/app/api/desktop/rooms/__tests__/route.test.ts` 的 vi.mock 写法。

---

### Task 5: Cookie 用户路由

**Files:**

- Create: `enterprise/apps/web-portal/src/app/api/me/edge/computers/route.ts`（GET）
- Create: `enterprise/apps/web-portal/src/app/api/me/edge/presence/route.ts`（POST）
- Create: `enterprise/apps/web-portal/src/app/api/me/edge/__tests__/route.test.ts`

Cookie 鉴权：

```ts
const result = await getWorkspaceSessionFromCookies();
if (result.status === "unauthenticated") return NextResponse.json({ code: "40100" }, { status: 401 });
if (result.status === "password_change_required") return passwordChangeRequiredResponse();
const session = result.session;
```

GET `/api/me/edge/computers`：`listEdgeDevicesForUser` 后 **只返回 `kind === 'desktop'`**。

POST `/api/me/edge/presence` body `{ fingerprint, displayName? }`：`upsertEdgeDevice({ kind: "mobile", ... })`。

测试 mock session 与 service。

---

### Task 6: 自测命令（必须全跑）

```bash
pnpm --filter @agenticx/db-schema exec vitest run src/__tests__/schema-parity.test.ts
pnpm --filter @agenticx/iam-core exec vitest run src/edge-device-service.test.ts
pnpm --filter @agenticx/web-portal exec vitest run src/app/api/desktop/edge/__tests__/route.test.ts src/app/api/me/edge/__tests__/route.test.ts
```

Expected: 全绿。

---

## 实施顺序

1. Task 1 红  
2. Task 2 schema  
3. Task 3 服务让 Task 1 绿并补 mock 用例  
4. Task 4–5 路由  
5. Task 6  

禁止改 Desktop / admin UI。完成后列出文件清单。未要求 commit 则不要 commit。
