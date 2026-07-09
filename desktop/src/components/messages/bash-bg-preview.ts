export type BashBgAuth = {
  jobId: string | null;
  status: "running" | "exited" | null;
  cwd: string | null;
  command: string | null;
  authUrls: string[];
};

function parseKeyValue(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return null;
  const value = String(match[1] ?? "").trim();
  return value || null;
}

export function parseBashBgStart(content: string): BashBgAuth | null {
  const raw = String(content ?? "");
  const jobId = parseKeyValue(raw, "job_id");
  if (!jobId) return null;

  const statusRaw = parseKeyValue(raw, "status");
  const status: BashBgAuth["status"] =
    statusRaw === "running" || statusRaw === "exited" ? statusRaw : null;
  const cwd = parseKeyValue(raw, "cwd");
  const command = parseKeyValue(raw, "command");

  const authUrls: string[] = [];
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "auth_urls:");
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i]?.trim() ?? "";
      if (!line) continue;
      if (line === "(none)") break;
      if (/^[A-Z][A-Z_]+:/.test(line)) break;
      const match = line.match(/^-\s*(https?:\/\/\S+)\s*$/);
      if (match) {
        const url = String(match[1] ?? "").trim();
        if (url && !authUrls.includes(url)) authUrls.push(url);
        continue;
      }
      // Reaching non-URL bullets (like NOTE guidance) means auth list ended.
      break;
    }
  }

  return {
    jobId,
    status,
    cwd,
    command,
    authUrls,
  };
}
