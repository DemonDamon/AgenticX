const DEFAULT_REGISTRY_URL = "http://127.0.0.1:8090";
const ALLOWED_VERDICTS = new Set(["safe", "caution", "dangerous"]);

export type RegistryScanResult = {
  verdict: string;
  findings: unknown[];
  source: string;
};

/**
 * 把一次扫描交给已有的 skill-registry 服务。
 *
 * 取包和扫描都在那边完成；这里只转发 slug，再把 verdict 写回企业技能表。
 * 本文件不复制扫描规则。
 */
export async function scanSkillViaRegistry(name: string): Promise<RegistryScanResult> {
  const slug = name.trim();
  if (!slug) throw new Error("skill slug is required");
  const base = (process.env.SKILL_REGISTRY_URL ?? DEFAULT_REGISTRY_URL).replace(/\/$/, "");
  const token = process.env.SKILL_REGISTRY_INTERNAL_TOKEN?.trim();
  if (!token) throw new Error("SKILL_REGISTRY_INTERNAL_TOKEN is required to scan skills");

  const response = await fetch(`${base}/registry/scan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agx-internal-token": token,
    },
    body: JSON.stringify({ name: slug, source: "community" }),
  });
  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    verdict?: unknown;
    findings?: unknown;
    error?: unknown;
  };
  if (!response.ok || json.ok === false) {
    const detail = typeof json.error === "string" && json.error ? json.error : `HTTP ${response.status}`;
    throw new Error(`skill-registry scan failed: ${detail}`);
  }
  const verdict = typeof json.verdict === "string" ? json.verdict.trim() : "";
  if (!ALLOWED_VERDICTS.has(verdict)) {
    throw new Error(`skill-registry returned an unknown verdict: ${verdict || "(empty)"}`);
  }
  return {
    verdict,
    findings: Array.isArray(json.findings) ? json.findings : [],
    source: "community",
  };
}
