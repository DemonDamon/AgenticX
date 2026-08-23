/**
 * 把企业 bootstrap 下发的能力落到本机。
 *
 * 没有企业 token 时必须立刻返回，不得改 mcp.json / skills 目录——本地未登录
 * 行为要和 Wave C 一致。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  normalizeEnterpriseCapabilities,
  planEnterpriseSkills,
  syncEnterpriseMcpDocument,
  type McpDocument,
} from "./enterprise-capabilities";

export const ENTERPRISE_SKILL_GROUP = "enterprise";
export const ENTERPRISE_SKILL_MARKER = ".enterprise-managed";
export const ENTERPRISE_SKILL_MAX_BYTES = 512 * 1024;
export const ENTERPRISE_MCP_JSON_PATH = "~/.agenticx/mcp.json";

export type EnterpriseSyncConfig = {
  enterprise?: {
    enabled?: boolean;
    base_url?: string;
    token?: string;
    capabilities?: unknown;
    managed_mcp_servers?: string[];
    managed_skills?: string[];
  };
};

export function hasEnterprisePat(cfg: EnterpriseSyncConfig): boolean {
  return Boolean(cfg.enterprise?.enabled && String(cfg.enterprise.token ?? "").trim());
}

export function enterpriseSkillsRoot(home = os.homedir()): string {
  return path.join(home, ".agenticx", "skills", ENTERPRISE_SKILL_GROUP);
}

export async function applyEnterpriseCapabilitiesToDisk(opts: {
  cfg: EnterpriseSyncConfig;
  token: string;
  capabilities: unknown;
  readMcpDocument: () => Promise<McpDocument | null>;
  writeMcpDocument: (document: McpDocument) => Promise<boolean>;
  fetchSkillBundle: (uri: string, digest: string) => Promise<string | null>;
  writeSkill: (dirName: string, content: string) => void;
  removeSkill: (dirName: string) => void;
}): Promise<{ managedMcp: string[]; managedSkills: string[]; skipped: boolean }> {
  if (!String(opts.token ?? "").trim()) {
    return {
      managedMcp: [...(opts.cfg.enterprise?.managed_mcp_servers ?? [])],
      managedSkills: [...(opts.cfg.enterprise?.managed_skills ?? [])],
      skipped: true,
    };
  }

  const capabilities = normalizeEnterpriseCapabilities(opts.capabilities);
  let managedMcp = [...(opts.cfg.enterprise?.managed_mcp_servers ?? [])];
  const document = await opts.readMcpDocument();
  if (document) {
    const result = syncEnterpriseMcpDocument(document, capabilities, opts.token, managedMcp);
    if (await opts.writeMcpDocument(result.document)) {
      managedMcp = result.managedNames;
    }
  }

  const plan = planEnterpriseSkills(capabilities, opts.cfg.enterprise?.managed_skills ?? []);
  const installed: string[] = [];
  for (const item of plan.install) {
    const content = await opts.fetchSkillBundle(item.bundleUri, item.bundleDigest);
    if (!content) continue;
    opts.writeSkill(item.dirName, content);
    installed.push(item.dirName);
  }
  for (const dirName of plan.remove) {
    opts.removeSkill(dirName);
  }
  return { managedMcp, managedSkills: installed.sort(), skipped: false };
}

export function writeManagedSkill(dirName: string, content: string, home = os.homedir()): void {
  const skillDir = path.join(enterpriseSkillsRoot(home), dirName);
  const markerPath = path.join(skillDir, ENTERPRISE_SKILL_MARKER);
  if (fs.existsSync(skillDir) && !fs.existsSync(markerPath)) {
    throw new Error(`skill directory ${dirName} is not enterprise-managed`);
  }
  fs.mkdirSync(skillDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(markerPath, "managed by enterprise capability pack\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function removeManagedSkill(dirName: string, home = os.homedir()): void {
  const skillDir = path.join(enterpriseSkillsRoot(home), dirName);
  if (!fs.existsSync(path.join(skillDir, ENTERPRISE_SKILL_MARKER))) return;
  fs.rmSync(skillDir, { recursive: true, force: true });
}

export async function readMcpDocumentViaStudio(
  studioUrl: string,
  studioToken: string,
): Promise<McpDocument | null> {
  const resp = await fetch(
    `${studioUrl}/api/mcp/raw?path=${encodeURIComponent(ENTERPRISE_MCP_JSON_PATH)}`,
    { headers: { "x-agx-desktop-token": studioToken } },
  );
  if (resp.status === 404) return {};
  if (!resp.ok) return null;
  const payload = (await resp.json().catch(() => ({}))) as { text?: string };
  try {
    const parsed = JSON.parse(payload.text || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as McpDocument)
      : {};
  } catch {
    return null;
  }
}

export async function writeMcpDocumentViaStudio(
  studioUrl: string,
  studioToken: string,
  document: McpDocument,
): Promise<boolean> {
  const resp = await fetch(`${studioUrl}/api/mcp/raw`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": studioToken,
    },
    body: JSON.stringify({
      path: ENTERPRISE_MCP_JSON_PATH,
      text: `${JSON.stringify(document, null, 2)}\n`,
    }),
  });
  return resp.ok;
}

export function digestSkillBundle(body: string, expectedDigest: string): string | null {
  if (Buffer.byteLength(body, "utf8") > ENTERPRISE_SKILL_MAX_BYTES) return null;
  const digest = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  return digest === expectedDigest.toLowerCase() ? body : null;
}
