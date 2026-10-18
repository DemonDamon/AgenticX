/**
 * Enterprise case library persistence (PostgreSQL and MySQL).
 *
 * Author: Damon Li
 */

import { enterpriseCases as pgCases } from "@agenticx/db-schema";
import { canTransitionCase, isCaseStatus, type CaseStatus } from "@agenticx/db-schema";
import { enterpriseCases as mysqlCases } from "@agenticx/db-schema/mysql";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { createMysqlDb, getIamDb } from "../db";

export type EnterpriseCase = {
  id: string;
  tenantId: string;
  title: string;
  summary: string;
  sourceRepo: string;
  status: CaseStatus;
  submitterUserId: string;
  manifest: Record<string, unknown>;
  packagePath: string;
  createdAt: string;
  updatedAt: string;
};

export class CaseTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseTransitionError";
  }
}

export class CaseNotFoundError extends Error {
  constructor() {
    super("case not found");
    this.name = "CaseNotFoundError";
  }
}

type CaseRow = {
  id: string;
  tenantId: string;
  title: string;
  summary: string;
  sourceRepo: string;
  status: string;
  submitterUserId: string;
  manifest: unknown;
  packagePath: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toCase(row: CaseRow): EnterpriseCase {
  if (!isCaseStatus(row.status)) {
    throw new Error(`unknown case status: ${row.status}`);
  }
  const manifest =
    row.manifest && typeof row.manifest === "object" && !Array.isArray(row.manifest)
      ? (row.manifest as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    summary: row.summary,
    sourceRepo: row.sourceRepo,
    status: row.status,
    submitterUserId: row.submitterUserId,
    manifest,
    packagePath: row.packagePath,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function useMysql(): Promise<boolean> {
  return resolveDatabaseConfig().dialect === "mysql";
}

export async function listEnterpriseCases(
  tenantId: string,
  filter?: { status?: CaseStatus; submitterUserId?: string },
): Promise<EnterpriseCase[]> {
  if (await useMysql()) {
    const { raw: db } = await createMysqlDb(resolveDatabaseConfig() as Extract<ReturnType<typeof resolveDatabaseConfig>, { dialect: "mysql" }>);
    const where = [eq(mysqlCases.tenantId, tenantId)];
    if (filter?.status) where.push(eq(mysqlCases.status, filter.status));
    if (filter?.submitterUserId) where.push(eq(mysqlCases.submitterUserId, filter.submitterUserId));
    const rows = await db
      .select()
      .from(mysqlCases)
      .where(and(...where))
      .orderBy(desc(mysqlCases.updatedAt));
    return rows.map((row) => toCase(row));
  }
  const db = getIamDb();
  const where = [eq(pgCases.tenantId, tenantId)];
  if (filter?.status) where.push(eq(pgCases.status, filter.status));
  if (filter?.submitterUserId) where.push(eq(pgCases.submitterUserId, filter.submitterUserId));
  const rows = await db
    .select()
    .from(pgCases)
    .where(and(...where))
    .orderBy(desc(pgCases.updatedAt));
  return rows.map((row) => toCase(row));
}

export async function getEnterpriseCase(tenantId: string, id: string): Promise<EnterpriseCase | null> {
  if (await useMysql()) {
    const { raw: db } = await createMysqlDb(resolveDatabaseConfig() as Extract<ReturnType<typeof resolveDatabaseConfig>, { dialect: "mysql" }>);
    const rows = await db
      .select()
      .from(mysqlCases)
      .where(and(eq(mysqlCases.tenantId, tenantId), eq(mysqlCases.id, id)))
      .limit(1);
    return rows[0] ? toCase(rows[0]) : null;
  }
  const db = getIamDb();
  const rows = await db
    .select()
    .from(pgCases)
    .where(and(eq(pgCases.tenantId, tenantId), eq(pgCases.id, id)))
    .limit(1);
  return rows[0] ? toCase(rows[0]) : null;
}

export async function createEnterpriseCase(input: {
  id?: string;
  tenantId: string;
  title: string;
  summary: string;
  sourceRepo: string;
  submitterUserId: string;
  manifest: Record<string, unknown>;
  packagePath: string;
}): Promise<EnterpriseCase> {
  const now = new Date();
  const row = {
    id: input.id?.trim() || ulid(),
    tenantId: input.tenantId,
    title: input.title.slice(0, 128),
    summary: input.summary,
    sourceRepo: input.sourceRepo.slice(0, 512),
    status: "submitted" as const,
    submitterUserId: input.submitterUserId,
    manifest: input.manifest,
    packagePath: input.packagePath,
    createdAt: now,
    updatedAt: now,
  };
  if (await useMysql()) {
    const { raw: db } = await createMysqlDb(resolveDatabaseConfig() as Extract<ReturnType<typeof resolveDatabaseConfig>, { dialect: "mysql" }>);
    await db.insert(mysqlCases).values(row);
  } else {
    await getIamDb().insert(pgCases).values(row);
  }
  return toCase(row);
}

export async function transitionEnterpriseCase(
  tenantId: string,
  id: string,
  to: CaseStatus,
): Promise<EnterpriseCase> {
  const current = await getEnterpriseCase(tenantId, id);
  if (!current) throw new CaseNotFoundError();
  if (!canTransitionCase(current.status, to)) {
    throw new CaseTransitionError(`cannot move case from ${current.status} to ${to}`);
  }
  const updatedAt = new Date();
  if (await useMysql()) {
    const { raw: db } = await createMysqlDb(resolveDatabaseConfig() as Extract<ReturnType<typeof resolveDatabaseConfig>, { dialect: "mysql" }>);
    await db
      .update(mysqlCases)
      .set({ status: to, updatedAt })
      .where(and(eq(mysqlCases.tenantId, tenantId), eq(mysqlCases.id, id)));
  } else {
    await getIamDb()
      .update(pgCases)
      .set({ status: to, updatedAt })
      .where(and(eq(pgCases.tenantId, tenantId), eq(pgCases.id, id)));
  }
  return { ...current, status: to, updatedAt: updatedAt.toISOString() };
}
