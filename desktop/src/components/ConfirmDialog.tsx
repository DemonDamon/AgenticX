import { useEffect, useState } from "react";
import { Button } from "./ds/Button";
import { Modal } from "./ds/Modal";
import {
  CONFIRM_POLICY_OPTIONS,
  type ConfirmPolicy,
} from "../constants/confirm-strategy-options";
import { parentPathForConfirmScope } from "../utils/confirm-scope";

type Props = {
  open: boolean;
  question: string;
  sourceLabel?: string;
  diff?: string;
  context?: Record<string, unknown>;
  defaultPolicy?: ConfirmPolicy;
  onApprove: (policy: ConfirmPolicy) => void;
  onReject: (policy: ConfirmPolicy) => void;
};

export type ConfirmRequestPresentation = {
  operationLabel: string;
  summary: string;
  targetLabel?: string;
  target?: string;
  allowlistScope: string;
  riskNotice?: string;
};

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fallbackPathFromQuestion(question: string): {
  operationLabel: string;
  path: string;
} | null {
  const normalized = question.trim();
  const candidates = [
    { prefix: "Write changes to ", operationLabel: "写入文件" },
    { prefix: "Apply edit to ", operationLabel: "修改文件" },
  ] as const;
  for (const candidate of candidates) {
    if (!normalized.startsWith(candidate.prefix) || !normalized.endsWith("?")) continue;
    const path = normalized.slice(candidate.prefix.length, -1).trim();
    if (path) return { operationLabel: candidate.operationLabel, path };
  }
  return null;
}

function fallbackCommandFromQuestion(question: string): string {
  const normalized = question.trim();
  const prefix = "Command '";
  const suffix = "' is not in SAFE_COMMANDS. Execute anyway?";
  if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) return "";
  return normalized.slice(prefix.length, -suffix.length).trim();
}

/**
 * Build a human-readable view from the structured confirmation context.
 * Unknown requests remain unclassified instead of being translated or guessed.
 */
export function buildConfirmRequestPresentation(
  question: string,
  context?: Record<string, unknown>,
): ConfirmRequestPresentation {
  const command = textValue(context?.command) || fallbackCommandFromQuestion(question);
  const contextPath = textValue(context?.path);
  const fallbackPath = contextPath ? null : fallbackPathFromQuestion(question);
  const path = contextPath || fallbackPath?.path || "";
  const skill = textValue(context?.skill);
  const tool = textValue(context?.tool);
  const action = textValue(context?.action);
  const risk = textValue(context?.risk);

  if (command) {
    const commandType = command.split(/\s+/u)[0] || command;
    return {
      operationLabel: risk === "high" ? "运行高风险命令" : "运行命令",
      summary: "智能体准备运行以下命令。请核对完整命令是否符合你的要求。",
      targetLabel: "完整命令",
      target: command,
      allowlistScope: `本次运行内，以「${commandType}」发起的同类命令`,
      riskNotice:
        risk === "high"
          ? "系统已将这条命令标记为高风险。确认前请仔细核对命令内容。"
          : "该命令不在默认可直接执行范围内，因此需要你的许可。",
    };
  }

  if (path) {
    const operationLabel =
      tool === "file_edit"
        ? "修改文件"
        : tool === "codegen"
          ? "生成文件"
          : fallbackPath?.operationLabel ?? "写入文件";
    const parentPath = parentPathForConfirmScope(path);
    return {
      operationLabel,
      summary: "智能体准备更改这个文件。请核对文件路径，并按需查看下方改动预览。",
      targetLabel: "文件路径",
      target: path,
      allowlistScope: parentPath
        ? `本次运行内，对「${parentPath}」目录中文件的同类更改`
        : `本次运行内，与「${path}」目标相同的文件更改`,
      riskNotice:
        risk === "destructive"
          ? "此操作可能删除或覆盖内容，请确认目标文件无误。"
          : undefined,
    };
  }

  if (skill) {
    const operationLabel =
      action === "install" ? "安装技能" : action === "delete" ? "删除技能" : "管理技能";
    return {
      operationLabel,
      summary: "智能体准备更改你的技能配置。请确认技能名称与操作符合预期。",
      targetLabel: "技能",
      target: skill,
      allowlistScope: `本次运行内，其他由「${tool || "技能管理"}」发起的同类操作`,
      riskNotice:
        risk === "high"
          ? "安全扫描已将该技能标记为高风险，请确认来源与内容可信。"
          : undefined,
    };
  }

  if (risk === "computer_use") {
    const x = typeof context?.x === "number" ? context.x : null;
    const y = typeof context?.y === "number" ? context.y : null;
    return {
      operationLabel: "操作本机桌面",
      summary: "智能体准备读取或控制本机桌面。请展开原始请求确认具体动作。",
      targetLabel: x !== null && y !== null ? "屏幕位置" : undefined,
      target: x !== null && y !== null ? `(${x}, ${y})` : undefined,
      allowlistScope: `本次运行内，其他由「${tool || "桌面操控"}」发起的同类操作`,
      riskNotice: "此操作会读取或控制本机桌面。",
    };
  }

  return {
    operationLabel: "需要授权的操作",
    summary: tool
      ? "智能体准备调用一个需要授权的工具。系统不会猜测或改写其含义，请展开原始请求核对。"
      : "系统无法可靠归类这个请求。请展开原始请求详情，确认后再执行。",
    targetLabel: tool ? "工具标识" : undefined,
    target: tool || undefined,
    allowlistScope: tool
      ? `本次运行内，其他由「${tool}」发起的同类操作`
      : "本次运行内，与这次请求完全相同的操作",
  };
}

export function ConfirmDialog({
  open,
  question,
  sourceLabel,
  diff,
  context,
  defaultPolicy = "ask-every-time",
  onApprove,
  onReject,
}: Props) {
  const [policy, setPolicy] = useState<ConfirmPolicy>("ask-every-time");
  const presentation = buildConfirmRequestPresentation(question, context);

  useEffect(() => {
    if (open) setPolicy(defaultPolicy);
  }, [defaultPolicy, open, question]);

  return (
    <Modal
      open={open}
      title="需要确认"
      panelClassName="w-[680px] max-w-[92vw] bg-surface-panel"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onReject(policy)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onApprove(policy)}>
            确认执行
          </Button>
        </div>
      )}
    >
      <div className="max-h-[calc(92vh-8.5rem)] overflow-y-auto pr-1">
        {sourceLabel ? <p className="mb-2 text-xs text-text-subtle">发起者：{sourceLabel}</p> : null}

        <section className="mb-3 rounded-lg border border-border bg-surface-card p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs text-text-subtle">准备执行</span>
            <strong className="text-sm font-semibold text-text-strong">
              {presentation.operationLabel}
            </strong>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-text-muted">{presentation.summary}</p>
          {presentation.target ? (
            <div className="mt-3 rounded-md bg-surface-panel px-3 py-2">
              <div className="text-[11px] text-text-subtle">{presentation.targetLabel}</div>
              <code className="mt-0.5 block break-all whitespace-pre-wrap text-xs text-text-strong">
                {presentation.target}
              </code>
            </div>
          ) : null}
          {presentation.riskNotice ? (
            <p className="mt-2 text-xs leading-5 text-[var(--status-warning)]">
              {presentation.riskNotice}
            </p>
          ) : null}
        </section>

        <details className="mb-3 rounded-md border border-border px-3 py-2 text-xs text-text-muted">
          <summary className="cursor-pointer select-none font-medium text-text-primary">
            查看原始请求详情
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-panel p-2 text-xs text-text-strong">
            {question}
          </pre>
        </details>

        {diff ? (
          <details className="mb-4 rounded-md border border-border px-3 py-2 text-xs text-text-muted">
            <summary className="cursor-pointer select-none font-medium text-text-primary">
              查看文件改动预览
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-panel p-3 text-xs text-text-strong">
              {diff}
            </pre>
          </details>
        ) : null}

        <div className="mb-3 rounded-md border border-border bg-surface-card p-3 text-xs text-text-muted">
          <div className="mb-2 font-medium text-text-primary">这次许可如何生效</div>
          <div className="space-y-1.5">
            {CONFIRM_POLICY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
              >
                <input
                  type="radio"
                  name="confirm-policy"
                  checked={policy === option.value}
                  onChange={() => setPolicy(option.value)}
                  className={`mt-0.5 h-4 w-4 shrink-0 border-border bg-surface-panel ${
                    option.value === "run-everything" ? "accent-amber-500" : "accent-emerald-500"
                  }`}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-text-primary">{option.label}</span>
                  <span className="mt-0.5 block leading-4 text-text-subtle">
                    {option.description}
                  </span>
                  {option.value === "use-allowlist" ? (
                    <span className="mt-1 block break-words rounded bg-surface-panel px-2 py-1 text-text-muted">
                      将自动允许：{presentation.allowlistScope}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
