import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ipcMain, session } from "electron";
import {
  chromeExpiryToUnixSeconds,
  cookieUrlFromHost,
  decryptChromeCookieValue,
  deriveChromeAesKeyLinux,
  deriveChromeAesKeyMac,
  mapCookieSameSite,
  shouldSkipHostKey,
} from "./chrome-cookie-crypto";

const execFileAsync = promisify(execFile);

/** Must match WorkPanel <webview partition>. */
export const WORKPANEL_BROWSER_PARTITION = "persist:near-workpanel-browser";

export type ChromeCookieProfile = {
  id: string;
  name: string;
  cookiePath: string;
};

type DumpedCookie = {
  host_key: string;
  name: string;
  value: string;
  encrypted_hex: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
};

function chromeUserDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
  }
  return path.join(os.homedir(), ".config", "google-chrome");
}

function resolveCookieDb(profileDir: string): string | null {
  const network = path.join(profileDir, "Network", "Cookies");
  const legacy = path.join(profileDir, "Cookies");
  if (fs.existsSync(network)) return network;
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

function isSkippedProfileDir(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "system profile" ||
    n === "guest profile" ||
    n.startsWith("system profile") ||
    n.includes("guest")
  );
}

export function listChromeCookieProfiles(userDataDir = chromeUserDataDir()): ChromeCookieProfile[] {
  if (!userDataDir || !fs.existsSync(userDataDir)) return [];
  const names = new Map<string, string>();
  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const raw = JSON.parse(fs.readFileSync(localStatePath, "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    const cache = raw.profile?.info_cache || {};
    for (const [id, info] of Object.entries(cache)) {
      if (typeof info?.name === "string" && info.name.trim()) {
        names.set(id, info.name.trim());
      }
    }
  } catch {
    /* scan directories instead */
  }

  const out: ChromeCookieProfile[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(userDataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    if (isSkippedProfileDir(id)) continue;
    if (id !== "Default" && !/^Profile \d+$/.test(id)) continue;
    const cookiePath = resolveCookieDb(path.join(userDataDir, id));
    if (!cookiePath) continue;
    out.push({
      id,
      name: names.get(id) || (id === "Default" ? "Default" : id),
      cookiePath,
    });
  }
  out.sort((a, b) => {
    if (a.id === "Default") return -1;
    if (b.id === "Default") return 1;
    return a.id.localeCompare(b.id);
  });
  return out;
}

function snapshotCookieDb(cookiePath: string): { dir: string; db: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "near-chrome-cookies-"));
  const db = path.join(dir, "Cookies");
  fs.copyFileSync(cookiePath, db);
  for (const suffix of ["-wal", "-shm"] as const) {
    const src = `${cookiePath}${suffix}`;
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, `${db}${suffix}`);
    } catch {
      /* locked / partial is ok */
    }
  }
  return { dir, db };
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const COOKIE_SQL =
  "SELECT host_key, name, value, hex(encrypted_value) AS encrypted_hex, path, expires_utc, is_secure, is_httponly, samesite FROM cookies";

async function whichFirst(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (c.includes("/") || c.includes("\\")) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    try {
      const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", [c], {
        timeout: 4000,
      });
      const line = String(stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (line) return line;
    } catch {
      /* try next */
    }
  }
  return null;
}

function parseDumpedRows(raw: unknown): DumpedCookie[] {
  if (!Array.isArray(raw)) return [];
  const rows: DumpedCookie[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    rows.push({
      host_key: String(r.host_key || ""),
      name: String(r.name || ""),
      value: String(r.value || ""),
      encrypted_hex: String(r.encrypted_hex || ""),
      path: String(r.path || "/"),
      expires_utc: Number(r.expires_utc || 0),
      is_secure: Number(r.is_secure || 0),
      is_httponly: Number(r.is_httponly || 0),
      samesite: Number(r.samesite || 0),
    });
  }
  return rows;
}

async function dumpCookiesViaSqlite(dbPath: string): Promise<DumpedCookie[]> {
  const cli = await whichFirst(
    process.platform === "win32"
      ? ["sqlite3.exe", "sqlite3"]
      : ["/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3", "/usr/local/bin/sqlite3", "sqlite3"],
  );
  if (!cli) {
    return dumpCookiesViaPython(dbPath);
  }
  try {
    const { stdout } = await execFileAsync(cli, ["-json", dbPath, COOKIE_SQL], {
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseDumpedRows(JSON.parse(String(stdout || "[]")));
  } catch (err) {
    const viaPy = await dumpCookiesViaPython(dbPath);
    if (viaPy.length) return viaPy;
    throw err;
  }
}

async function dumpCookiesViaPython(dbPath: string): Promise<DumpedCookie[]> {
  const py = await whichFirst(["python3", "python"]);
  if (!py) return [];
  const script = [
    "import json,sqlite3,sys",
    "con=sqlite3.connect(sys.argv[1])",
    "con.row_factory=sqlite3.Row",
    "rows=[]",
    "for r in con.execute('SELECT host_key,name,value,encrypted_value,path,expires_utc,is_secure,is_httponly,samesite FROM cookies'):",
    " ev=r['encrypted_value'] or b''",
    " rows.append({'host_key':r['host_key'] or '','name':r['name'] or '','value':r['value'] or '','encrypted_hex':ev.hex(),'path':r['path'] or '/','expires_utc':r['expires_utc'] or 0,'is_secure':r['is_secure'] or 0,'is_httponly':r['is_httponly'] or 0,'samesite':r['samesite'] or 0})",
    "print(json.dumps(rows))",
  ].join("\n");
  const { stdout } = await execFileAsync(py, ["-c", script, dbPath], {
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseDumpedRows(JSON.parse(String(stdout || "[]")));
}

async function readChromeSafeStoragePassword(): Promise<string> {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"],
      { timeout: 180_000 },
    );
    const password = String(stdout || "").replace(/\n$/, "");
    if (!password) throw new Error("keychain_empty");
    return password;
  }
  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync(
        "secret-tool",
        ["lookup", "application", "chrome"],
        { timeout: 30_000 },
      );
      const password = String(stdout || "").trim();
      if (password) return password;
    } catch {
      /* fall through to peanuts */
    }
    return "peanuts";
  }
  throw new Error("unsupported_platform");
}

async function readWindowsChromeKey(userDataDir: string): Promise<Buffer> {
  const localStatePath = path.join(userDataDir, "Local State");
  const raw = JSON.parse(fs.readFileSync(localStatePath, "utf8")) as {
    os_crypt?: { encrypted_key?: string };
  };
  const b64 = raw.os_crypt?.encrypted_key;
  if (!b64) throw new Error("missing_encrypted_key");
  const blob = Buffer.from(b64, "base64");
  const dpapi = blob.subarray(0, 5).toString("utf8") === "DPAPI" ? blob.subarray(5) : blob;
  const encB64 = dpapi.toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$enc = [Convert]::FromBase64String('${encB64}')`,
    "$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($dec)",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 20_000 },
  );
  const out = String(stdout || "").trim().split(/\r?\n/).pop() || "";
  if (!out) throw new Error("dpapi_empty");
  return Buffer.from(out, "base64");
}

async function resolveDecryptKey(): Promise<Buffer> {
  if (process.platform === "win32") {
    return readWindowsChromeKey(chromeUserDataDir());
  }
  const password = await readChromeSafeStoragePassword();
  if (process.platform === "linux") {
    return deriveChromeAesKeyLinux(password);
  }
  return deriveChromeAesKeyMac(password);
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.trim();
  if (!clean) return Buffer.alloc(0);
  return Buffer.from(clean, "hex");
}

export async function importChromeCookiesToWorkPanel(profileId: string): Promise<{
  imported: number;
  skipped: number;
}> {
  const profiles = listChromeCookieProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new Error("profile_not_found");
  }
  const snap = snapshotCookieDb(profile.cookiePath);
  let rows: DumpedCookie[] = [];
  try {
    rows = await dumpCookiesViaSqlite(snap.db);
  } finally {
    cleanupDir(snap.dir);
  }
  if (!rows.length) {
    throw new Error("cookie_db_empty");
  }
  const key = await resolveDecryptKey();
  const ses = session.fromPartition(WORKPANEL_BROWSER_PARTITION);
  const pending: Electron.CookiesSetDetails[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.name || shouldSkipHostKey(row.host_key)) {
      skipped += 1;
      continue;
    }
    let value = row.value || "";
    if (!value && row.encrypted_hex) {
      try {
        value = decryptChromeCookieValue(hexToBuffer(row.encrypted_hex), key, process.platform);
      } catch {
        skipped += 1;
        continue;
      }
    }
    if (!value) {
      skipped += 1;
      continue;
    }
    const secure = Boolean(row.is_secure);
    const url = cookieUrlFromHost(row.host_key, row.path, secure);
    if (!url) {
      skipped += 1;
      continue;
    }
    const details: Electron.CookiesSetDetails = {
      url,
      name: row.name,
      value,
      path: row.path || "/",
      secure,
      httpOnly: Boolean(row.is_httponly),
      sameSite: mapCookieSameSite(row.samesite),
    };
    if (!row.name.startsWith("__Host-")) {
      details.domain = row.host_key;
    }
    const expires = chromeExpiryToUnixSeconds(row.expires_utc);
    if (expires && expires > Date.now() / 1000) {
      details.expirationDate = expires;
    }
    pending.push(details);
  }
  let imported = 0;
  const chunkSize = 25;
  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize);
    const results = await Promise.allSettled(chunk.map((item) => ses.cookies.set(item)));
    for (const result of results) {
      if (result.status === "fulfilled") imported += 1;
      else skipped += 1;
    }
  }
  if (imported === 0) {
    throw new Error("import_zero");
  }
  return { imported, skipped };
}

export function registerChromeCookieImportIpc(): void {
  ipcMain.handle("list-chrome-cookie-profiles", async () => {
    try {
      return { ok: true, profiles: listChromeCookieProfiles() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), profiles: [] };
    }
  });
  ipcMain.handle("import-chrome-cookies", async (_event, payload: unknown) => {
    const profileId =
      payload && typeof payload === "object" && "profileId" in payload
        ? String((payload as { profileId?: unknown }).profileId || "")
        : "";
    if (!profileId) return { ok: false, error: "profile_required" };
    try {
      const result = await importChromeCookiesToWorkPanel(profileId);
      return { ok: true, ...result };
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      return { ok: false, error: code };
    }
  });
}
