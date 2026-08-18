/**
 * web-portal · 能力包相关表的方言解析。
 *
 * PG 与 MySQL 的 drizzle 句柄类型不同，联合类型会让链式调用无法解析。这里按实际
 * 用到的最小结构各收敛一次；表对象本身仍是各自方言的强类型，字段写错照样报错。
 */

import {
  enterpriseCapabilityAssignments as pgAssignments,
  enterpriseCapabilityOptOuts as pgOptOuts,
  enterpriseCapabilityPackMembers as pgMembers,
  enterpriseCapabilityPacks as pgPacks,
  enterpriseSkills as pgSkills,
  mcpServers as pgMcpServers,
} from "@agenticx/db-schema";
import {
  enterpriseCapabilityAssignments as myAssignments,
  enterpriseCapabilityOptOuts as myOptOuts,
  enterpriseCapabilityPackMembers as myMembers,
  enterpriseCapabilityPacks as myPacks,
  enterpriseSkills as mySkills,
  mcpServers as myMcpServers,
} from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";

/** 本包用到的 drizzle 读查询子集。 */
export type DialectQuery = {
  select: (fields?: unknown) => {
    from: (table: unknown) => {
      innerJoin: (table: unknown, on: unknown) => { where: (cond: unknown) => Promise<unknown[]> };
      where: (cond: unknown) => Promise<unknown[]>;
    };
  };
};

/** 本包用到的 drizzle 写查询子集。 */
export type DialectMutation = {
  insert: (table: unknown) => { values: (rows: unknown) => Promise<unknown> };
  delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown> };
};

export function requiredCapabilityTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required to resolve enterprise capabilities.");
  return t;
}

export async function dialectCapabilityTables() {
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw: db } = await createMysqlDb(config);
    return {
      db,
      packs: myPacks,
      assignments: myAssignments,
      members: myMembers,
      optOuts: myOptOuts,
      skills: mySkills,
      mcp: myMcpServers,
    } as const;
  }
  return {
    db: getIamDb(),
    packs: pgPacks,
    assignments: pgAssignments,
    members: pgMembers,
    optOuts: pgOptOuts,
    skills: pgSkills,
    mcp: pgMcpServers,
  } as const;
}
