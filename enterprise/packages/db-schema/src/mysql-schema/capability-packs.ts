/**
 * 企业能力包：把若干 Skill / MCP 打成一组，由管理员统一录入凭据并分配给全员、
 * 部门或指定用户，员工登录后自动同步，不再自己配 Key、装 Skill、连 MCP。
 *
 * 两条贯穿性的设计：
 *
 * 1. 能力一律按 `mcp:<ulid>` / `skill:<ulid>` 引用，不用 `name`/`slug`。
 *    名字是管理员起的可变标签，改一次就会让分配记录、用户偏好、用量与审计
 *    全部指空；用量归属错乱对后续按能力计费尤其致命。前缀用来区分该去哪张表查。
 *
 * 2. Skill 自身不存凭据，只声明依赖（requiredCapabilities）。凭据留在被依赖的
 *    MCP 上由网关代持——Skill 是要落到员工机器上的文件，Key 一旦进了 bundle，
 *    轮换等于重新分发文件，撤销之后旧文件还留在本地。
 */
import { index, json, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

import { auditColumns, ulid } from "./_shared";
import { tenants } from "./tenants";

/** 企业 Skill 注册表。 */
export const enterpriseSkills = mysqlTable(
  "enterprise_skills",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 128 }).notNull(),
    displayName: varchar("display_name", { length: 128 }),
    description: text("description"),
    /** 固定版本分发；灰度与回滚等有真实需求再引入。 */
    version: varchar("version", { length: 32 }).notNull().default("0.0.0"),
    bundleUri: text("bundle_uri"),
    /** 内容摘要，供 Desktop 校验同步下来的 bundle 未被篡改。 */
    bundleDigest: varchar("bundle_digest", { length: 128 }),
    /** 依赖的能力 id（`mcp:<ulid>` 等）；此处只声明，不含任何凭据。 */
    requiredCapabilities: json("required_capabilities").$type<string[]>().notNull().default([]),
    /**
     * 安全扫描结论。null 表示从未扫过——手工登记的技能就是这个状态，货架上要能和
     * 「扫过且判定安全」区分开，否则管理员会把「没查过」看成「查过没问题」。
     *
     * 企业侧一个人决定、全公司承受，所以结论必须留痕：谁在什么时候、按什么可信度扫的。
     */
    scanVerdict: varchar("scan_verdict", { length: 16 }),
    scanSource: varchar("scan_source", { length: 32 }),
    scannedAt: varchar("scanned_at", { length: 32 }),
    scannedBy: varchar("scanned_by", { length: 128 }),
    /** 命中的规则条目，原样存扫描器的 payload，不在这里二次解释。 */
    scanFindings: json("scan_findings").$type<unknown[]>().notNull().default([]),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => ({
    tenantSlugUq: uniqueIndex("enterprise_skills_tenant_slug_uq").on(table.tenantId, table.slug),
    tenantStatusIdx: index("enterprise_skills_tenant_status_idx").on(table.tenantId, table.status),
  })
);

/** 能力包本体。`status` 即企业侧开关，也就是用户那一位的上限。 */
export const enterpriseCapabilityPacks = mysqlTable(
  "enterprise_capability_packs",
  {
    id: ulid("id").primaryKey(),
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 128 }).notNull(),
    displayName: varchar("display_name", { length: 128 }),
    description: text("description"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    metadata: json("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    ...auditColumns,
  },
  (table) => ({
    tenantSlugUq: uniqueIndex("enterprise_capability_packs_tenant_slug_uq").on(table.tenantId, table.slug),
    tenantStatusIdx: index("enterprise_capability_packs_tenant_status_idx").on(table.tenantId, table.status),
  })
);

/** 包内成员：`mcp:<ulid>` / `skill:<ulid>`。 */
export const enterpriseCapabilityPackMembers = mysqlTable(
  "enterprise_capability_pack_members",
  {
    packId: ulid("pack_id")
      .notNull()
      .references(() => enterpriseCapabilityPacks.id, { onDelete: "cascade" }),
    capabilityId: varchar("capability_id", { length: 64 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.packId, table.capabilityId] }),
    capabilityIdx: index("enterprise_capability_pack_members_capability_idx").on(table.capabilityId),
  })
);

/**
 * 分配范围。`assignmentKey` 沿用可见模型那套约定：`all` / `dept:<id>` / 用户 ulid，
 * 好处是级联收窄的语义与已跑通的实现一致，不必另立一套。
 */
export const enterpriseCapabilityAssignments = mysqlTable(
  "enterprise_capability_assignments",
  {
    tenantId: ulid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    packId: ulid("pack_id")
      .notNull()
      .references(() => enterpriseCapabilityPacks.id, { onDelete: "cascade" }),
    assignmentKey: varchar("assignment_key", { length: 128 }).notNull(),
    ...auditColumns,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.packId, table.assignmentKey] }),
    tenantKeyIdx: index("enterprise_capability_assignments_tenant_key_idx").on(
      table.tenantId,
      table.assignmentKey
    ),
  })
);


export type EnterpriseSkillRow = typeof enterpriseSkills.$inferSelect;
export type NewEnterpriseSkillRow = typeof enterpriseSkills.$inferInsert;
export type EnterpriseCapabilityPackRow = typeof enterpriseCapabilityPacks.$inferSelect;
export type NewEnterpriseCapabilityPackRow = typeof enterpriseCapabilityPacks.$inferInsert;
export type EnterpriseCapabilityPackMemberRow = typeof enterpriseCapabilityPackMembers.$inferSelect;
export type EnterpriseCapabilityAssignmentRow = typeof enterpriseCapabilityAssignments.$inferSelect;
