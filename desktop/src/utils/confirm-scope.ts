function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type NormalizedConfirmRisk = "low" | "protected";

/**
 * Mirror the backend's fail-closed confirmation policy. Only an explicit
 * `risk: "low"` may be auto-approved; missing and future values stay protected.
 */
export function normalizeConfirmRisk(
  context?: Record<string, unknown>,
): NormalizedConfirmRisk {
  return text(context?.risk).toLowerCase() === "low" ? "low" : "protected";
}

export function isProtectedConfirmContext(
  context?: Record<string, unknown>,
): boolean {
  return normalizeConfirmRisk(context) === "protected";
}

export function shouldAutoApproveConfirm(
  strategy: "manual" | "semi-auto" | "auto",
  scopeAlreadyAllowed: boolean,
  context?: Record<string, unknown>,
): boolean {
  if (isProtectedConfirmContext(context)) return false;
  return strategy === "auto" || scopeAlreadyAllowed;
}

export function parentPathForConfirmScope(pathValue: unknown): string {
  const path = text(pathValue).replace(/[\\/]+$/, "");
  if (!path) return "";
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return path;
  if (separator === 0) return path.slice(0, 1);
  if (separator === 2 && /^[A-Za-z]:[\\/]/u.test(path)) return path.slice(0, 3);
  return path.slice(0, separator);
}

export function buildConfirmScope(
  question: string,
  context?: Record<string, unknown>,
): string {
  const tool = text(context?.tool);
  if (tool === "bash_exec") {
    const command = text(context?.command);
    const commandName = command.split(/\s+/u)[0] || "unknown";
    return `bash_exec:${commandName}`;
  }
  if (tool === "file_write" || tool === "file_edit") {
    const path = text(context?.path);
    const folder = parentPathForConfirmScope(path);
    return `${tool}:${folder || "/"}`;
  }
  if (tool) return `tool:${tool}`;
  return `question:${question}`;
}
