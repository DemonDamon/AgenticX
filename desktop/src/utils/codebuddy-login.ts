/**
 * In-app CodeBuddy login prompt.
 *
 * Credentials stay with the CodeBuddy CLI. Near only notices an auth failure
 * and runs `codebuddy login` in the session terminal.
 */

import { canonicalizeHarnessId, resolveMessageHarnessId } from "./harness-display";

export type CodebuddyLoginPlatform = "posix" | "windows";

export type CodebuddyLoginMessage = {
  role: string;
  content?: string;
  metadata?: Record<string, unknown>;
  toolName?: string;
  toolResultPreview?: string;
};

const HARNESS_ERROR_RE =
  /\[harness\s+\S+\s+turn\s+(?:error|failed|exited|timeout|blocked)\]/i;

const EXPLICIT_LOGIN = [
  "codebuddy login",
  "please login",
  "please log in",
  "not logged in",
  "login required",
  "login failed",
  "sign in to",
  "登录已失效",
  "请重新登录",
  "请先登录",
];

function loginFlag(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return metadata.codebuddy_login_required === true || metadata.codebuddyLoginRequired === true;
}

function messageText(message: CodebuddyLoginMessage): string {
  return [message.content, message.toolResultPreview, message.toolName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function hasAuthStatus(lowered: string): boolean {
  return (
    lowered.includes("401")
    || lowered.includes("unauthorized")
    || lowered.includes("authorization")
    || lowered.includes("login")
  );
}

function loose401(lowered: string): boolean {
  if (!lowered.includes("401")) return false;
  return (
    lowered.includes("unauthorized")
    || lowered.includes("authorization")
    || lowered.includes("login")
  );
}

/** Same signals as the Python detector, for banners and tool previews already on screen. */
export function isCodebuddyAuthFailureText(text: string): boolean {
  const raw = String(text ?? "");
  const lowered = raw.toLowerCase();
  if (!lowered.trim()) return false;
  if (
    lowered.includes("authorization required")
    && (lowered.includes("401") || lowered.includes("unauthorized"))
  ) {
    return true;
  }
  if (lowered.includes("web search api request failed") && lowered.includes("401")) {
    return true;
  }
  if (lowered.includes("copilot.tencent.com") && hasAuthStatus(lowered)) {
    return true;
  }
  if (EXPLICIT_LOGIN.some((phrase) => lowered.includes(phrase) || raw.includes(phrase))) {
    return true;
  }
  if (
    HARNESS_ERROR_RE.test(raw)
    && lowered.includes("codebuddy")
    && (loose401(lowered) || lowered.includes("login") || lowered.includes("apikeysource"))
  ) {
    return true;
  }
  return false;
}

function isFailedHarnessTurn(message: CodebuddyLoginMessage): boolean {
  const status = String(message.metadata?.harness_status ?? "").trim().toLowerCase();
  if (status === "success" || status === "running") return false;
  if (status && status !== "success") return true;
  return HARNESS_ERROR_RE.test(String(message.content ?? ""));
}

function isSuccessfulHarnessTurn(message: CodebuddyLoginMessage): boolean {
  const status = String(message.metadata?.harness_status ?? "").trim().toLowerCase();
  return status === "success" && !HARNESS_ERROR_RE.test(String(message.content ?? ""));
}

/**
 * Show the login CTA when the latest assistant turn is a CodeBuddy auth failure.
 * A later successful answer hides it.
 */
export function sessionShowsCodebuddyLoginPrompt(
  messages: CodebuddyLoginMessage[],
  activeHarnessId?: string | null,
): boolean {
  let lastAssistant = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      lastAssistant = index;
      break;
    }
  }
  if (lastAssistant < 0) return false;

  const assistant = messages[lastAssistant];
  let start = 0;
  for (let index = lastAssistant - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      start = index + 1;
      break;
    }
  }
  const slice = messages.slice(start, lastAssistant + 1);
  const stamped = resolveMessageHarnessId(assistant.metadata);
  const active = canonicalizeHarnessId(activeHarnessId);
  const banner = String(assistant.content ?? "");
  const codebuddy =
    stamped === "codebuddy"
    || active === "codebuddy"
    || slice.some((message) => resolveMessageHarnessId(message.metadata) === "codebuddy")
    || /\[harness\s+codebuddy\s+turn\b/i.test(banner);
  if (!codebuddy) return false;
  if (loginFlag(assistant.metadata) || slice.some((message) => loginFlag(message.metadata))) {
    return true;
  }
  if (isSuccessfulHarnessTurn(assistant)) return false;

  const failed = isFailedHarnessTurn(assistant);
  for (const message of slice) {
    const text = messageText(message);
    if (isCodebuddyAuthFailureText(text)) return true;
    if (failed && message.role === "assistant" && loose401(text.toLowerCase())) return true;
  }
  return false;
}

export function pickLoginCwd(
  workspaces: Array<{ id?: string; path?: string }>,
  activeId: string | null | undefined,
): string {
  const rows = Array.isArray(workspaces) ? workspaces : [];
  const active = activeId ? rows.find((row) => row.id === activeId) : undefined;
  const path = String(active?.path || rows[0]?.path || "").trim();
  return path || "~";
}

const POSIX_LOGIN = [
  'CB=""',
  'if [ -x .cb/bin/codebuddy ]; then CB=".cb/bin/codebuddy"',
  'elif [ -x "$HOME/.cb/bin/codebuddy" ]; then CB="$HOME/.cb/bin/codebuddy"',
  'elif command -v codebuddy >/dev/null 2>&1; then CB="$(command -v codebuddy)"',
  'elif command -v cbc >/dev/null 2>&1; then CB="$(command -v cbc)"',
  'elif [ -x "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy" ]; then CB="/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"',
  'elif [ -x "$HOME/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy" ]; then CB="$HOME/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"',
  "fi",
  'if [ -z "$CB" ]; then echo "codebuddy was not found. Install the CLI, then run: codebuddy login"',
  'else echo "Complete CodeBuddy login in this terminal / 请在本终端完成 CodeBuddy 登录。"; "$CB" login',
  "fi",
].join("; ");

const WINDOWS_LOGIN = [
  "$cb = $null",
  "if (Test-Path -LiteralPath '.\\.cb\\bin\\codebuddy.exe') { $cb = '.\\.cb\\bin\\codebuddy.exe' }",
  "elseif (Test-Path -LiteralPath '.\\.cb\\bin\\codebuddy') { $cb = '.\\.cb\\bin\\codebuddy' }",
  "elseif (Get-Command codebuddy -ErrorAction SilentlyContinue) { $cb = (Get-Command codebuddy).Source }",
  "elseif (Get-Command cbc -ErrorAction SilentlyContinue) { $cb = (Get-Command cbc).Source }",
  "if (-not $cb) { Write-Output 'codebuddy was not found. Install the CLI, then run: codebuddy login' }",
  "else { Write-Output 'Complete CodeBuddy login in this terminal.'; & $cb login }",
].join("; ");

/** Shell snippet that resolves the same binaries wb-bridge prefers, then runs login. */
export function buildCodebuddyLoginCommand(platform: CodebuddyLoginPlatform): string {
  switch (platform) {
    case "posix":
      return POSIX_LOGIN;
    case "windows":
      return WINDOWS_LOGIN;
    default: {
      const unreachable: never = platform;
      return unreachable;
    }
  }
}

export async function writeCommandToTerminalTab(args: {
  cwd: string;
  label: string;
  command: string;
  addTab: (cwd: string, label: string) => void;
  readActiveTabId: () => string | null;
  write: (tabId: string, data: string) => Promise<{ ok?: boolean } | null | undefined>;
  onTabReady?: (tabId: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ ok: boolean; tabId: string | null }> {
  const cwd = String(args.cwd || "").trim() || "~";
  args.addTab(cwd, args.label);
  const tabId = args.readActiveTabId();
  if (!tabId) return { ok: false, tabId: null };
  args.onTabReady?.(tabId);
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const data = `${args.command}\n`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const wrote = await args.write(tabId, data);
      if (wrote?.ok) return { ok: true, tabId };
    } catch {
      // Terminal pty may still be spawning.
    }
    await sleep(180);
  }
  return { ok: false, tabId };
}
