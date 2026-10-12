export type TaskCompleteNotifyPayload = {
  title?: unknown;
  body?: unknown;
  paneId?: unknown;
  sessionId?: unknown;
  showBanner?: unknown;
  playSound?: unknown;
};

export type ParsedTaskCompleteNotify =
  | {
      ok: true;
      title: string;
      body: string;
      paneId: string;
      sessionId: string;
      showBanner: boolean;
      playSound: boolean;
    }
  | { ok: false; error: string };

export type LoginItemSettingsShape = {
  openAtLogin: boolean;
  openAsHidden?: boolean;
  type?: "mainAppService";
  args?: string[];
};

type NotificationLike = {
  show: () => void;
  on: (event: "click", listener: () => void) => void;
};

type NotificationConstructor = new (options: {
  title: string;
  body: string;
  silent?: boolean;
}) => NotificationLike;

const TITLE_BODY_LIMIT = 80;

function clipField(value: string): string {
  if (value.length <= TITLE_BODY_LIMIT) return value;
  return value.slice(0, TITLE_BODY_LIMIT);
}

export function parseTaskCompleteNotifyPayload(raw: unknown): ParsedTaskCompleteNotify {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid payload" };
  }
  const row = raw as TaskCompleteNotifyPayload;
  if (typeof row.title !== "string" || typeof row.body !== "string") {
    return { ok: false, error: "title and body must be strings" };
  }
  if (typeof row.showBanner !== "boolean" || typeof row.playSound !== "boolean") {
    return { ok: false, error: "showBanner and playSound must be booleans" };
  }
  const title = clipField(row.title.trim());
  if (!title) {
    return { ok: false, error: "title required" };
  }
  return {
    ok: true,
    title,
    body: clipField(row.body.trim()),
    paneId: typeof row.paneId === "string" ? row.paneId.trim() : "",
    sessionId: typeof row.sessionId === "string" ? row.sessionId.trim() : "",
    showBanner: row.showBanner,
    playSound: row.playSound,
  };
}

export function buildLoginItemSettings(input: {
  openAtLogin: boolean;
  platform: NodeJS.Platform;
}): LoginItemSettingsShape {
  if (!input.openAtLogin) {
    return { openAtLogin: false };
  }
  if (input.platform === "darwin") {
    return { openAtLogin: true, openAsHidden: true, type: "mainAppService" };
  }
  if (input.platform === "win32") {
    return { openAtLogin: true, args: ["--hidden"] };
  }
  return { openAtLogin: true };
}

export function shouldStartHidden(input: {
  argv: string[];
  wasOpenedAtLogin: boolean;
  wasOpenedAsHidden?: boolean;
  isPackaged: boolean;
}): boolean {
  if (!input.isPackaged && !input.argv.includes("--hidden")) return false;
  return input.argv.includes("--hidden") || input.wasOpenedAtLogin || input.wasOpenedAsHidden === true;
}

export function resolveTaskCompleteBanner(input: {
  desktopNotify: boolean;
  windowActive: boolean;
}): boolean {
  return input.desktopNotify && !input.windowActive;
}

export function isMainWindowActive(input: {
  exists: boolean;
  visible: boolean;
  focused: boolean;
}): boolean {
  return input.exists && input.visible && input.focused;
}

export function shouldUseOsascriptBanner(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}): boolean {
  return input.platform === "darwin" && !input.isPackaged;
}

export function resolveBannerTransport(input: {
  notificationSupported: boolean;
  platform: NodeJS.Platform;
}): "electron" | "osascript" | "none" {
  if (input.notificationSupported) return "electron";
  if (input.platform === "darwin") return "osascript";
  return "none";
}

export function escapeOsascriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

export function buildOsascriptNotificationArgs(title: string, body: string): string[] {
  return [
    "-e",
    `display notification "${escapeOsascriptString(body)}" with title "${escapeOsascriptString(title)}"`,
  ];
}

export function showOsascriptNotification(
  execFileFn: typeof import("node:child_process").execFile,
  title: string,
  body: string,
): void {
  execFileFn("/usr/bin/osascript", buildOsascriptNotificationArgs(title, body), (err) => {
    if (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[desktop-notify] osascript banner failed:", message);
    }
  });
}

export function planTaskCompleteDelivery(input: {
  showBanner: boolean;
  playSound: boolean;
}): {
  useNotification: boolean;
  playStandaloneSound: boolean;
  notificationSilent: boolean;
} {
  return {
    useNotification: input.showBanner,
    playStandaloneSound: input.playSound,
    notificationSilent: true,
  };
}

export function playCompletionSound(
  execFileFn: typeof import("node:child_process").execFile,
  platform: NodeJS.Platform,
): void {
  const warn = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[desktop-notify] sound failed:", message);
  };
  try {
    if (platform === "darwin") {
      execFileFn("/usr/bin/afplay", ["/System/Library/Sounds/Glass.aiff"], (err) => {
        if (err) warn(err);
      });
      return;
    }
    if (platform === "win32") {
      execFileFn(
        "powershell",
        ["-NoProfile", "-Command", "[System.Media.SystemSounds]::Asterisk.Play()"],
        (err) => {
          if (err) warn(err);
        },
      );
      return;
    }
    execFileFn("paplay", ["/usr/share/sounds/freedesktop/stereo/complete.oga"], (err) => {
      if (err) warn(err);
    });
  } catch (err) {
    warn(err);
  }
}

export function deliverTaskCompleteNotification(opts: {
  NotificationCtor: NotificationConstructor;
  payload: Extract<ParsedTaskCompleteNotify, { ok: true }>;
  onClick: () => void;
  silent?: boolean;
}): void {
  const note = new opts.NotificationCtor({
    title: opts.payload.title,
    body: opts.payload.body,
    silent: opts.silent ?? !opts.payload.playSound,
  });
  note.on("click", opts.onClick);
  note.show();
}

export function welcomeNotificationCopy(locale: "zh" | "en"): { title: string; body: string } {
  if (locale === "en") {
    return {
      title: "Near is ready",
      body: "You'll get a banner here when a task finishes.",
    };
  }
  return {
    title: "Near 已就绪",
    body: "任务完成后会在这里提醒你。",
  };
}
