/**
 * 运行模式的唯一词表。设置页、确认卡、命令面板、store 都从这里读。
 *
 * 旧取值 `manual` / `semi-auto` 只在 normalizeRunMode 里迁移一次，不要再当权威字段用。
 */

export type RunMode = "ask" | "allowlist" | "auto";

export type RunModeOption = {
  value: RunMode;
  label: string;
  description: string;
};

export const RUN_MODE_OPTIONS: ReadonlyArray<RunModeOption> = [
  {
    value: "ask",
    label: "始终询问",
    description: "编辑文件、执行命令和使用网络时都先问你",
  },
  {
    value: "allowlist",
    label: "按需确认",
    description: "只对有风险的操作询问",
  },
  {
    value: "auto",
    label: "全部允许",
    // 只承诺「不再询问」：后端沙箱与路径拒绝独立于审批，仍然生效。
    description: "不再询问，工作区隔离仍生效",
  },
];

export const RUN_MODE_CYCLE: readonly RunMode[] = RUN_MODE_OPTIONS.map((option) => option.value);

export function runModeLabel(mode: RunMode): string {
  return RUN_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? RUN_MODE_OPTIONS[0]!.label;
}

/**
 * 读配置 / 旧 localStorage 时的归一化。
 * 认不出的一律落到 ask（往严的方向兜底）。
 */
export function normalizeRunMode(raw: unknown): RunMode {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "auto") return "auto";
  if (text === "allowlist" || text === "semi-auto") return "allowlist";
  if (text === "ask" || text === "manual") return "ask";
  return "ask";
}

/** 兼容旧字段名与旧取值，只在读路径调用。 */
export function migrateRunModeFromUnknown(raw: {
  runMode?: unknown;
  run_mode?: unknown;
  confirmStrategy?: unknown;
  confirm_strategy?: unknown;
}): RunMode {
  return normalizeRunMode(
    raw.runMode ?? raw.run_mode ?? raw.confirmStrategy ?? raw.confirm_strategy,
  );
}

/** 确认卡里「这次许可管多久」的选项文案，与运行模式共用同一套用词。 */
export const CONFIRM_DIALOG_POLICY_OPTIONS = [
  { value: "ask-every-time" as const, label: "始终询问（仅本次允许）" },
  { value: "use-allowlist" as const, label: "按需确认（只问有风险的操作）" },
  { value: "run-everything" as const, label: "全部允许（之后不再询问）" },
] as const;
