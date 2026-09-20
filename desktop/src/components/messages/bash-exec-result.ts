/**
 * Display-only parser for bash_exec tool results.
 *
 * Studio still returns the machine envelope for the model:
 *   exit_code=N
 *   stdout:
 *   ...
 *   stderr:
 *   ...
 * This module strips that protocol so the desktop card does not dump
 * `exit_code` / `stdout:` / `(empty)` at users.
 */

export type BashExecUserView = {
  matched: boolean;
  exitCode: number | null;
  /** Real command output. Empty when both streams were blank/placeholder. */
  output: string;
};

const PLACEHOLDER_RE = /^(?:\(empty\)|\(none\))$/;
const TRAILING_HINT_RE = /\n(?:\n)?(?:\[HINT\]|HINT:|OUTPUT_HINT:)[\s\S]*$/u;

function normalizeStream(text: string): string {
  const stripped = text.replace(/\r\n/g, "\n").replace(TRAILING_HINT_RE, "");
  const trimmed = stripped.replace(/^\uFEFF/, "").trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) return "";
  return trimmed;
}

function splitStdoutStderr(rest: string): { stdout: string; stderr: string } | null {
  const body = rest.replace(/\r\n/g, "\n");
  if (!body) return { stdout: "", stderr: "" };

  if (body.startsWith("stderr:\n") || body === "stderr:") {
    return { stdout: "", stderr: body.replace(/^stderr:\n?/, "") };
  }

  if (!body.startsWith("stdout:")) return null;

  const afterStdout = body.startsWith("stdout:\n")
    ? body.slice("stdout:\n".length)
    : body === "stdout:"
      ? ""
      : body.replace(/^stdout:\n?/, "");
  const sep = "\nstderr:\n";
  const sepAt = afterStdout.lastIndexOf(sep);
  if (sepAt < 0) {
    if (afterStdout === "stderr:" || afterStdout === "stderr:\n") {
      return { stdout: "", stderr: "" };
    }
    return { stdout: afterStdout, stderr: "" };
  }
  return {
    stdout: afterStdout.slice(0, sepAt),
    stderr: afterStdout.slice(sepAt + sep.length),
  };
}

export function formatBashExecUserView(raw: string): BashExecUserView {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  const head = text.match(/^exit_code=(-?\d+|null)(?:\n|$)/);
  if (!head) {
    return { matched: false, exitCode: null, output: text };
  }

  const exitRaw = head[1];
  const exitCode = exitRaw === "null" ? null : Number(exitRaw);
  const rest = text.slice(head[0].length);
  const streams = splitStdoutStderr(rest);
  if (!streams) {
    return { matched: false, exitCode: null, output: text };
  }

  const stdout = normalizeStream(streams.stdout);
  const stderr = normalizeStream(streams.stderr);
  const parts = [stdout, stderr].filter(Boolean);
  return {
    matched: true,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    output: parts.join("\n"),
  };
}

export function resolveBashExecCardText(
  raw: string,
  failedLabel: (code: number) => string,
): { matched: boolean; text: string } {
  const view = formatBashExecUserView(raw);
  if (!view.matched) return { matched: false, text: String(raw ?? "") };
  if (view.output) return { matched: true, text: view.output };
  if (view.exitCode != null && view.exitCode !== 0) {
    return { matched: true, text: failedLabel(view.exitCode) };
  }
  return { matched: true, text: "" };
}
