import type { Message } from "../../store";

export type SkillPatchRange = {
  start: number;
  end: number;
  start_line: number;
  end_line: number;
};

export type SkillPatchPreviewPayload = {
  ok: boolean;
  action: "patch";
  mode: "preview";
  strategy?: string;
  match_count?: number;
  target_ranges?: SkillPatchRange[];
  patch_token?: string;
  requires_target_selection?: boolean;
  diff?: string;
  risk?: {
    verdict?: string;
    allowed?: boolean;
    reason?: string;
    findings?: string[];
  };
};

export function parseSkillPatchPreviewPayload(content: string): SkillPatchPreviewPayload | null {
  const raw = String(content ?? "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.action !== "patch") return null;
    if (parsed.mode !== "preview") return null;
    if (typeof parsed.ok !== "boolean") return null;
    const rangesRaw = Array.isArray(parsed.target_ranges) ? parsed.target_ranges : [];
    const targetRanges = rangesRaw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const s = Number(row.start);
        const e = Number(row.end);
        const sl = Number(row.start_line);
        const el = Number(row.end_line);
        if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(sl) || !Number.isFinite(el)) return null;
        return { start: s, end: e, start_line: sl, end_line: el } as SkillPatchRange;
      })
      .filter((x): x is SkillPatchRange => !!x);
    const payload: SkillPatchPreviewPayload = {
      ok: parsed.ok as boolean,
      action: "patch",
      mode: "preview",
      strategy: typeof parsed.strategy === "string" ? parsed.strategy : undefined,
      match_count: Number.isFinite(Number(parsed.match_count)) ? Number(parsed.match_count) : undefined,
      target_ranges: targetRanges,
      patch_token: typeof parsed.patch_token === "string" ? parsed.patch_token : undefined,
      requires_target_selection: Boolean(parsed.requires_target_selection),
      diff: typeof parsed.diff === "string" ? parsed.diff : undefined,
      risk:
        parsed.risk && typeof parsed.risk === "object"
          ? {
              verdict: typeof (parsed.risk as Record<string, unknown>).verdict === "string"
                ? String((parsed.risk as Record<string, unknown>).verdict)
                : undefined,
              allowed: typeof (parsed.risk as Record<string, unknown>).allowed === "boolean"
                ? Boolean((parsed.risk as Record<string, unknown>).allowed)
                : undefined,
              reason: typeof (parsed.risk as Record<string, unknown>).reason === "string"
                ? String((parsed.risk as Record<string, unknown>).reason)
                : undefined,
              findings: Array.isArray((parsed.risk as Record<string, unknown>).findings)
                ? ((parsed.risk as Record<string, unknown>).findings as unknown[])
                    .map((x) => String(x ?? "").trim())
                    .filter(Boolean)
                : undefined,
            }
          : undefined,
    };
    return payload;
  } catch {
    return null;
  }
}

export function parseSkillManageError(content: string): { code: "VALIDATION" | "POLICY"; detail: string } | null {
  const raw = String(content ?? "").trim();
  const m = raw.match(/^ERROR\[(VALIDATION|POLICY)\]:\s*(.*)$/s);
  if (!m) return null;
  return { code: m[1] as "VALIDATION" | "POLICY", detail: (m[2] || "").trim() };
}

export function isSkillManageToolMessage(message: Message): boolean {
  return String(message.toolName ?? "").trim() === "skill_manage";
}
