export type SandboxTier = "read-only" | "workspace-write" | "danger-full-access";

/** 唯一档位词表。label 中文，description 一句话，不得过度承诺。 */
export const SANDBOX_TIER_OPTIONS: ReadonlyArray<{
  value: SandboxTier;
  label: string;
  description: string;
}> = [
  {
    value: "read-only",
    label: "只读",
    description: "不允许写任何文件",
  },
  {
    value: "workspace-write",
    label: "仅工作区可写（默认）",
    description: "只能写工作区与本次临时目录",
  },
  {
    value: "danger-full-access",
    label: "脱离隔离",
    description: "每次执行仍会要求确认",
  },
];

const SANDBOX_TIER_VALUES = new Set<SandboxTier>(
  SANDBOX_TIER_OPTIONS.map((option) => option.value),
);

/** 后端字段缺失/未知一律回落 workspace-write（与后端 normalize_command_permissions 对齐）。 */
export function normalizeSandboxTier(raw: unknown): SandboxTier {
  if (typeof raw === "string" && SANDBOX_TIER_VALUES.has(raw as SandboxTier)) {
    return raw as SandboxTier;
  }
  return "workspace-write";
}

export type SandboxNotice = { id: string; tone: "info" | "warn"; text: string };

/**
 * 把平台能力两字段翻成用户看得懂的话。
 * 必须返回**多条**，禁止合成一句——三平台说同一句话必然有一个在过度承诺。
 */
export function sandboxNotices(input: {
  shellReadIsolation?: unknown;
  pathDenyEnforcement?: unknown;
}): SandboxNotice[] {
  const notices: SandboxNotice[] = [];

  if (input.shellReadIsolation === "full") {
    notices.push({
      id: "shell-read-full",
      tone: "info",
      text: "工作区之外的文件读不到。",
    });
  } else if (input.shellReadIsolation === "none") {
    notices.push({
      id: "shell-read-none",
      tone: "warn",
      text: "工作区之外的文件仍可被读取。",
    });
  } else {
    notices.push({
      id: "shell-read-unknown",
      tone: "warn",
      text: "无法确认工作区之外的文件是否可读。",
    });
  }

  if (input.pathDenyEnforcement === "full") {
    notices.push({
      id: "path-deny-full",
      tone: "info",
      text: "拒绝规则完整生效。",
    });
  } else if (input.pathDenyEnforcement === "partial") {
    notices.push({
      id: "path-deny-partial",
      tone: "warn",
      text: "拒绝规则仅部分生效：平台限制，或规则条数超过上限（512）。",
    });
  } else {
    notices.push({
      id: "path-deny-unknown",
      tone: "warn",
      text: "无法确认拒绝规则是否完整生效。",
    });
  }

  return notices;
}
