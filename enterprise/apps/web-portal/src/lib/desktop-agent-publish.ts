import { randomBytes } from "node:crypto";

import {
  createAgentVersion,
  createAgentWithInitialVersion,
  getAgentVersion,
  getAgentWithMa,
  listAgentsWithMa,
  previewAgentManifest,
  updateAgentMaSettings,
  type EnterpriseAgentWithMa,
} from "@agenticx/iam-core";

export type PublishInput = {
  tenantId: string;
  userId: string;
  localAvatarId: string;
  displayName: string;
  description: string | null;
  manifest: Record<string, unknown>;
  note: string | null;
};

export type PublishOkBody = {
  agent_id: string;
  version: number;
  created: boolean;
  lifecycle: "draft" | "published" | "recalled";
  routing_mode: "follow_latest" | "pinned";
  effective_version: number;
};

export type PublishResult =
  | { kind: "ok"; status: 200 | 201; body: PublishOkBody }
  | { kind: "invalid"; errors: string[] }
  | { kind: "recalled" }
  | { kind: "conflict" };

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function errorList(error: unknown): string[] {
  if (error && typeof error === "object" && "errors" in error) {
    const errors = (error as { errors?: unknown }).errors;
    if (Array.isArray(errors)) return errors.map((item) => String(item));
  }
  return [];
}

function randomSuffix(): string {
  const bytes = randomBytes(6);
  let suffix = "";
  for (const byte of bytes) {
    suffix += BASE36[byte % 36];
  }
  return suffix;
}

/** Same compacting rule as iam-core employeeSlug, with an optional collision suffix. */
export function employeePublishSlug(localAvatarId: string, suffix?: string): string {
  const compact = localAvatarId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  const slug = `e${compact}`;
  const base = slug.length >= 2 ? slug.slice(0, 63) : "employee-agent";
  if (!suffix) return base;
  return `${base.slice(0, 56)}-${suffix}`;
}

function okBody(
  agent: Pick<EnterpriseAgentWithMa, "id" | "lifecycle" | "versionRouting" | "effectiveVersion">,
  version: number,
  created: boolean,
): PublishOkBody {
  return {
    agent_id: agent.id,
    version,
    created,
    lifecycle: agent.lifecycle,
    routing_mode: agent.versionRouting,
    effective_version: agent.effectiveVersion,
  };
}

export async function publishEmployeeAgentVersion(input: PublishInput): Promise<PublishResult> {
  const agents = await listAgentsWithMa(input.tenantId);
  const existing = agents.find(
    (agent) =>
      agent.origin === "employee" &&
      agent.ownerUserId === input.userId &&
      agent.localAvatarId === input.localAvatarId,
  );
  if (!existing) {
    const versionInput = {
      manifest: input.manifest,
      note: input.note,
      createdBy: input.userId,
      source: "desktop" as const,
    };
    const create = (slug: string) =>
      createAgentWithInitialVersion(
        input.tenantId,
        {
          slug,
          displayName: input.displayName,
          description: input.description,
          model: "",
          systemPrompt: "",
          runtime: "desktop_worker",
          assignmentKeys: [input.userId],
          workerKeys: [input.userId],
          lifecycle: "draft",
          origin: "employee",
          ownerUserId: input.userId,
          localAvatarId: input.localAvatarId,
        },
        versionInput,
      );
    let created;
    try {
      created = await create(employeePublishSlug(input.localAvatarId));
    } catch (error) {
      if (errorName(error) === "AgentManifestInvalidError") {
        return { kind: "invalid", errors: errorList(error) };
      }
      if (errorName(error) === "AgentSlugConflictError") {
        try {
          created = await create(employeePublishSlug(input.localAvatarId, randomSuffix()));
        } catch (retryError) {
          if (errorName(retryError) === "AgentManifestInvalidError") {
            return { kind: "invalid", errors: errorList(retryError) };
          }
          throw retryError;
        }
      } else {
        throw error;
      }
    }
    return {
      kind: "ok",
      status: 201,
      body: okBody(created.agent, created.version.version, true),
    };
  }
  if (existing.lifecycle === "recalled") return { kind: "recalled" };
  const preview = await previewAgentManifest(input.tenantId, input.manifest);
  if (!preview.ok) return { kind: "invalid", errors: preview.errors };
  const latest = await getAgentVersion(input.tenantId, existing.id, existing.latestVersion);
  if (latest.manifestHash === preview.manifestHash) {
    return {
      kind: "ok",
      status: 200,
      body: okBody(existing, latest.version, false),
    };
  }
  if (existing.lifecycle === "published" && existing.versionRouting === "follow_latest") {
    await updateAgentMaSettings(input.tenantId, existing.id, {
      versionRouting: "pinned",
      pinnedVersion: existing.effectiveVersion,
    });
  }
  let expected = existing.latestVersion;
  let appended: Awaited<ReturnType<typeof createAgentVersion>> | undefined;
  for (const attempt of [1, 2] as const) {
    try {
      appended = await createAgentVersion(input.tenantId, existing.id, {
        manifest: input.manifest,
        expectedLatestVersion: expected,
        note: input.note,
        createdBy: input.userId,
        source: "desktop",
      });
      break;
    } catch (error) {
      if (errorName(error) === "AgentManifestInvalidError") {
        return { kind: "invalid", errors: errorList(error) };
      }
      if (errorName(error) === "AgentVersionConflictError" && attempt === 1) {
        expected = (await getAgentWithMa(input.tenantId, existing.id)).latestVersion;
        continue;
      }
      if (errorName(error) === "AgentVersionConflictError") return { kind: "conflict" };
      throw error;
    }
  }
  if (!appended) return { kind: "conflict" };
  const fresh = await getAgentWithMa(input.tenantId, existing.id);
  return {
    kind: "ok",
    status: appended.created ? 201 : 200,
    body: okBody(fresh, appended.version.version, appended.created),
  };
}
