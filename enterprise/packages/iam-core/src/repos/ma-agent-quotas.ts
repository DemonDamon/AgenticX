import { maAgentQuotas as pgQuotas } from "@agenticx/db-schema";
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { AgentNotFoundError, getAgent } from "./agents";
import {
  mysqlDeleteMaAgentQuota,
  mysqlFindMaAgentQuota,
  mysqlFindMaAgentQuotaBySubject,
  mysqlInsertMaAgentQuota,
  mysqlListMaAgentQuotas,
  mysqlUpdateMaAgentQuota,
} from "./mysql/ma-agent-quotas";
import { getAdminUser } from "./users";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX_TOKENS = 1_000_000_000_000;

export type MaAgentQuotaSubject = "default" | "user";

export type MaAgentQuota = {
  id: string;
  tenantId: string;
  agentId: string;
  subject: MaAgentQuotaSubject;
  userId: string | null;
  dailyTokens: number;
  weeklyTokens: number;
  monthlyTokens: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NormalizedAgentQuotaInput = {
  agentId: string;
  subject: MaAgentQuotaSubject;
  userId: string | null;
  dailyTokens: number;
  weeklyTokens: number;
  monthlyTokens: number;
};

export class MaAgentQuotaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaAgentQuotaValidationError";
  }
}

export class MaAgentQuotaNotFoundError extends Error {
  constructor(message = "quota rule not found") {
    super(message);
    this.name = "MaAgentQuotaNotFoundError";
  }
}

type QuotaRow = {
  id: string;
  tenantId: string;
  agentId: string;
  subjectKey: string;
  userId: string | null;
  dailyTokens: unknown;
  weeklyTokens: unknown;
  monthlyTokens: unknown;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function asSubject(subjectKey: string): MaAgentQuotaSubject {
  return subjectKey === "default" ? "default" : "user";
}

function mapRow(row: QuotaRow): MaAgentQuota {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.agentId,
    subject: asSubject(row.subjectKey),
    userId: row.userId,
    dailyTokens: Number(row.dailyTokens),
    weeklyTokens: Number(row.weeklyTokens),
    monthlyTokens: Number(row.monthlyTokens),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function parseTokens(body: Record<string, unknown>, field: "daily_tokens" | "weekly_tokens" | "monthly_tokens"): number {
  if (!(field in body)) throw new MaAgentQuotaValidationError(`${field}: is required`);
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MaAgentQuotaValidationError(`${field}: must be an integer`);
  }
  if (value < 0 || value > MAX_TOKENS) {
    throw new MaAgentQuotaValidationError(`${field}: must be between 0 and 1000000000000`);
  }
  return value;
}

/** Pure validation of an admin quota write. Does not touch the database. */
export function normalizeAgentQuotaInput(body: Record<string, unknown>): NormalizedAgentQuotaInput {
  const agentId = body.agent_id;
  if (typeof agentId !== "string" || !ULID_RE.test(agentId)) {
    throw new MaAgentQuotaValidationError("agent_id: is invalid");
  }
  const subject = body.subject;
  if (subject !== "default" && subject !== "user") {
    throw new MaAgentQuotaValidationError("subject: is invalid");
  }
  let userId: string | null = null;
  if (subject === "user") {
    const raw = body.user_id;
    if (typeof raw !== "string" || !ULID_RE.test(raw)) {
      throw new MaAgentQuotaValidationError("user_id: is required");
    }
    userId = raw;
  }
  const dailyTokens = parseTokens(body, "daily_tokens");
  const weeklyTokens = parseTokens(body, "weekly_tokens");
  const monthlyTokens = parseTokens(body, "monthly_tokens");
  if (dailyTokens === 0 && weeklyTokens === 0 && monthlyTokens === 0) {
    throw new MaAgentQuotaValidationError("daily_tokens: at least one limit must be greater than 0");
  }
  return { agentId, subject, userId, dailyTokens, weeklyTokens, monthlyTokens };
}

export function toAgentQuotaRecord(row: MaAgentQuota) {
  return {
    id: row.id,
    agent_id: row.agentId,
    subject: row.subject,
    user_id: row.userId,
    daily_tokens: row.dailyTokens,
    weekly_tokens: row.weeklyTokens,
    monthly_tokens: row.monthlyTokens,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function subjectKeyOf(input: NormalizedAgentQuotaInput): string {
  return input.subject === "default" ? "default" : `user:${input.userId}`;
}

export async function listMaAgentQuotas(tenantId: string, agentId: string): Promise<MaAgentQuota[]> {
  const rows = isMysql()
    ? await mysqlListMaAgentQuotas(tenantId, agentId)
    : await getIamDb()
        .select()
        .from(pgQuotas)
        .where(and(eq(pgQuotas.tenantId, tenantId), eq(pgQuotas.agentId, agentId)))
        .orderBy(asc(pgQuotas.createdAt), asc(pgQuotas.id));
  return rows.map((row) => mapRow(row));
}

async function findBySubject(tenantId: string, agentId: string, subjectKey: string): Promise<QuotaRow | null> {
  if (isMysql()) return mysqlFindMaAgentQuotaBySubject(tenantId, agentId, subjectKey);
  const rows = await getIamDb()
    .select()
    .from(pgQuotas)
    .where(and(eq(pgQuotas.tenantId, tenantId), eq(pgQuotas.agentId, agentId), eq(pgQuotas.subjectKey, subjectKey)))
    .limit(1);
  return rows[0] ?? null;
}

async function findById(tenantId: string, id: string): Promise<QuotaRow | null> {
  if (isMysql()) return mysqlFindMaAgentQuota(tenantId, id);
  const rows = await getIamDb()
    .select()
    .from(pgQuotas)
    .where(and(eq(pgQuotas.tenantId, tenantId), eq(pgQuotas.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMaAgentQuota(
  tenantId: string,
  body: Record<string, unknown>,
  actorUserId: string,
): Promise<MaAgentQuota> {
  const input = normalizeAgentQuotaInput(body);
  try {
    await getAgent(tenantId, input.agentId);
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new MaAgentQuotaValidationError("agent_id: agent not found");
    }
    throw error;
  }
  if (input.subject === "user" && input.userId) {
    const user = await getAdminUser(tenantId, input.userId);
    if (!user) throw new MaAgentQuotaValidationError("user_id: user not found");
  }
  const subjectKey = subjectKeyOf(input);
  const now = new Date();
  const existing = await findBySubject(tenantId, input.agentId, subjectKey);
  if (existing) {
    const patch = {
      userId: input.userId,
      dailyTokens: input.dailyTokens,
      weeklyTokens: input.weeklyTokens,
      monthlyTokens: input.monthlyTokens,
      updatedAt: now,
    };
    if (isMysql()) await mysqlUpdateMaAgentQuota(tenantId, existing.id, patch);
    else {
      await getIamDb().update(pgQuotas).set(patch).where(and(eq(pgQuotas.tenantId, tenantId), eq(pgQuotas.id, existing.id)));
    }
    const saved = await findById(tenantId, existing.id);
    return mapRow(saved ?? { ...existing, ...patch });
  }
  const id = ulid();
  const row = {
    id,
    tenantId,
    agentId: input.agentId,
    subjectKey,
    userId: input.userId,
    dailyTokens: input.dailyTokens,
    weeklyTokens: input.weeklyTokens,
    monthlyTokens: input.monthlyTokens,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
  if (isMysql()) await mysqlInsertMaAgentQuota(row);
  else await getIamDb().insert(pgQuotas).values(row);
  const saved = await findById(tenantId, id);
  return mapRow(saved ?? row);
}

export async function deleteMaAgentQuota(tenantId: string, id: string): Promise<void> {
  const existing = await findById(tenantId, id);
  if (!existing) throw new MaAgentQuotaNotFoundError();
  if (isMysql()) {
    await mysqlDeleteMaAgentQuota(tenantId, id);
    return;
  }
  await getIamDb().delete(pgQuotas).where(and(eq(pgQuotas.tenantId, tenantId), eq(pgQuotas.id, id)));
}

export async function getEffectiveMaAgentQuota(
  tenantId: string,
  agentId: string,
  userId: string,
): Promise<MaAgentQuota | null> {
  const rows = await listMaAgentQuotas(tenantId, agentId);
  const userRule = rows.find((row) => row.subject === "user" && row.userId === userId);
  if (userRule) return userRule;
  return rows.find((row) => row.subject === "default") ?? null;
}
