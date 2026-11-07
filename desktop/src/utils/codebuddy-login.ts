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

/** Persisted assistant text when harness_wiring strips the raw error (backend). */
export const CODEBUDDY_LOGIN_PERSISTED_BODY =
  "CodeBuddy Tencent login is required. Use the re-login action in the chat.";

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
function turnStartBeforeAssistant(messages: CodebuddyLoginMessage[], assistantIndex: number): number {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index + 1;
  }
  return 0;
}

function messageIndexById(
  messages: Array<CodebuddyLoginMessage & { id?: string }>,
  message: CodebuddyLoginMessage & { id?: string },
): number {
  const id = String(message.id ?? "").trim();
  if (id) {
    return messages.findIndex((row) => row.id === id);
  }
  return messages.indexOf(message);
}

function lastAssistantIndex(messages: CodebuddyLoginMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return index;
  }
  return -1;
}

/** True when this row should show the live re-login CTA (last failing assistant turn). */
export function assistantTurnNeedsCodebuddyLogin(
  message: CodebuddyLoginMessage & { id?: string },
  messages: Array<CodebuddyLoginMessage & { id?: string }>,
  activeHarnessId?: string | null,
): boolean {
  if (message.role !== "assistant") return false;
  if (!sessionShowsCodebuddyLoginPrompt(messages, activeHarnessId)) return false;
  const assistantIndex = messageIndexById(messages, message);
  if (assistantIndex < 0 || assistantIndex !== lastAssistantIndex(messages)) return false;
  const start = turnStartBeforeAssistant(messages, assistantIndex);
  const slice = messages.slice(start, assistantIndex + 1);
  return sessionShowsCodebuddyLoginPrompt(slice, activeHarnessId);
}

function isLoginPersistedBody(text: string): boolean {
  const trimmed = String(text ?? "").trim();
  return trimmed === CODEBUDDY_LOGIN_PERSISTED_BODY;
}

/** Hide harness 400/401 banners and backend login placeholder from the bubble body. */
export function shouldSuppressCodebuddyHarnessErrorBody(
  message: CodebuddyLoginMessage & { id?: string },
  messages: Array<CodebuddyLoginMessage & { id?: string }>,
  activeHarnessId?: string | null,
): boolean {
  const raw = String(message.content ?? "");
  if (loginFlag(message.metadata)) {
    return (
      HARNESS_ERROR_RE.test(raw)
      || isLoginPersistedBody(raw)
      || isCodebuddyAuthFailureText(raw)
    );
  }
  if (!assistantTurnNeedsCodebuddyLogin(message, messages, activeHarnessId)) return false;
  return HARNESS_ERROR_RE.test(raw) || isLoginPersistedBody(raw) || isCodebuddyAuthFailureText(raw);
}

/** Historical login turns (resolved): short notice, no CTA. */
export function assistantShowsResolvedCodebuddyLoginNotice(
  message: CodebuddyLoginMessage & { id?: string },
  messages: Array<CodebuddyLoginMessage & { id?: string }>,
  activeHarnessId?: string | null,
): boolean {
  if (message.role !== "assistant" || !loginFlag(message.metadata)) return false;
  if (assistantTurnNeedsCodebuddyLogin(message, messages, activeHarnessId)) return false;
  return shouldSuppressCodebuddyHarnessErrorBody(message, messages, activeHarnessId);
}

export function sessionShowsCodebuddyLoginPrompt(
  messages: CodebuddyLoginMessage[],
  activeHarnessId?: string | null,
  opts?: { suppressWhileAwaitingRetry?: boolean },
): boolean {
  if (opts?.suppressWhileAwaitingRetry) return false;
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

export const CODEBUDDY_LOGIN_SHELL_BANNER =
  "echo '=== Near codebuddy-login shell (native zsh) — NOT harness REPL ==='";

const POSIX_LOGIN = [
  CODEBUDDY_LOGIN_SHELL_BANNER,
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
  "Write-Output '=== Near codebuddy-login shell (native) — NOT harness REPL ==='",
  "$cb = $null",
  "if (Test-Path -LiteralPath '.\\.cb\\bin\\codebuddy.exe') { $cb = '.\\.cb\\bin\\codebuddy.exe' }",
  "elseif (Test-Path -LiteralPath '.\\.cb\\bin\\codebuddy') { $cb = '.\\.cb\\bin\\codebuddy' }",
  "elseif (Get-Command codebuddy -ErrorAction SilentlyContinue) { $cb = (Get-Command codebuddy).Source }",
  "elseif (Get-Command cbc -ErrorAction SilentlyContinue) { $cb = (Get-Command cbc).Source }",
  "if (-not $cb) { Write-Output 'codebuddy was not found. Install the CLI, then run: codebuddy login' }",
  "else { Write-Output 'Complete CodeBuddy login in this terminal.'; & $cb login }",
].join("; ");

/** True when a terminal payload is the full shell login snippet (not bare REPL "login"). */
export function isCompleteCodebuddyLoginCommand(command: string): boolean {
  const text = String(command ?? "");
  if (!text.includes("login")) return false;
  return (
    text.includes('"$CB" login')
    || text.includes("& $cb login")
    || text.includes("command -v codebuddy")
    || text.includes("Get-Command codebuddy")
  );
}

export function isNativeShellTerminalSessionId(sessionId: string | undefined | null): boolean {
  const id = String(sessionId ?? "").trim();
  if (!id || id.includes(":bridge:")) return false;
  return true;
}

async function waitForNextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

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
  /** Must create a dedicated shell tab and return its id. */
  addTab: (cwd: string, label: string) => string | null;
  /** Write into native shell PTY for tabId only (never harness/cc-bridge REPL). */
  writePty: (
    tabId: string,
    data: string,
  ) => Promise<{ ok?: boolean; id?: string; error?: string } | null | undefined>;
  /** Wait until main process has a registered native shell PTY (never bridge). */
  waitPtyReady?: (tabId: string) => Promise<boolean>;
  /** Focus UI on the new tab before waiting for PTY (avoids stale bridge tab focus). */
  onTabReady?: (tabId: string) => void | Promise<void>;
  beforeWrite?: () => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ ok: boolean; tabId: string | null; sessionId?: string | null }> {
  if (!isCompleteCodebuddyLoginCommand(args.command)) {
    return { ok: false, tabId: null, sessionId: null };
  }
  const cwd = String(args.cwd || "").trim() || "~";
  if (args.beforeWrite) {
    await args.beforeWrite();
  }
  const tabId = args.addTab(cwd, args.label);
  if (!tabId) return { ok: false, tabId: null, sessionId: null };
  await args.onTabReady?.(tabId);
  await waitForNextPaint();
  await waitForNextPaint();
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const ready = args.waitPtyReady ?? (async () => true);
  const data = `${args.command}\n`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await ready(tabId)) {
      try {
        const wrote = await args.writePty(tabId, data);
        const sessionId = typeof wrote?.id === "string" ? wrote.id : null;
        if (wrote?.ok && isNativeShellTerminalSessionId(sessionId)) {
          return { ok: true, tabId, sessionId };
        }
      } catch {
        // Terminal pty may still be spawning.
      }
    }
    await sleep(200);
  }
  return { ok: false, tabId, sessionId: null };
}

export function paneAwaitingCodebuddyLoginRetry(
  sessionId: string | null | undefined,
  awaitingSessionId: string | null | undefined,
): boolean {
  const sid = String(sessionId ?? "").trim();
  const awaiting = String(awaitingSessionId ?? "").trim();
  return Boolean(sid && awaiting && sid === awaiting);
}
