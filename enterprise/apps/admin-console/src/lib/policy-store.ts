import * as fs from "node:fs";
import * as path from "node:path";

export type PolicyPackState = {
  name: string;
  version: string;
  description: string;
  source: string;
  enabled: boolean;
};

type OverrideFile = {
  disabledPacks: string[];
  updatedAt?: string;
};

const ROOT = path.resolve(process.cwd(), "../..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const RUNTIME_DIR = process.env.ENTERPRISE_ADMIN_RUNTIME_DIR || path.join(ROOT, ".runtime/admin");
const OVERRIDE_FILE = process.env.ENTERPRISE_POLICY_OVERRIDE_FILE || path.join(RUNTIME_DIR, "policy-overrides.json");

function ensureRuntimeDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  }
}

function parseManifestLite(manifestPath: string): { name: string; version: string; description: string } {
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const pick = (key: string) => {
    const match = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return (match?.[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
  };
  return {
    name: pick("name"),
    version: pick("version") || "0.1.0",
    description: pick("description") || "",
  };
}

function readOverrides(): OverrideFile {
  ensureRuntimeDir();
  if (!fs.existsSync(OVERRIDE_FILE)) {
    return { disabledPacks: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf-8")) as OverrideFile;
    return {
      disabledPacks: Array.isArray(parsed.disabledPacks)
        ? parsed.disabledPacks.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [],
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { disabledPacks: [] };
  }
}

function writeOverrides(next: OverrideFile): void {
  ensureRuntimeDir();
  const tmp = `${OVERRIDE_FILE}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ disabledPacks: Array.from(new Set(next.disabledPacks)).sort(), updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  fs.renameSync(tmp, OVERRIDE_FILE);
}

export function listPolicyPacks(): PolicyPackState[] {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const overrides = readOverrides();
  const disabled = new Set(overrides.disabledPacks);
  const dirs = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("moderation-"))
    .map((d) => d.name)
    .sort();
  const rows: PolicyPackState[] = [];
  for (const dirName of dirs) {
    const manifestPath = path.join(PLUGINS_DIR, dirName, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) continue;
    const parsed = parseManifestLite(manifestPath);
    const name = parsed.name || dirName;
    rows.push({
      name,
      version: parsed.version,
      description: parsed.description,
      source: path.relative(ROOT, manifestPath),
      enabled: !disabled.has(name),
    });
  }
  return rows;
}

export function setPolicyPackEnabled(packName: string, enabled: boolean): PolicyPackState[] {
  const clean = packName.trim();
  if (!clean) throw new Error("packName is required");
  const all = listPolicyPacks();
  if (!all.some((p) => p.name === clean)) {
    throw new Error(`unknown policy pack: ${clean}`);
  }
  const overrides = readOverrides();
  const next = new Set(overrides.disabledPacks);
  if (enabled) next.delete(clean);
  else next.add(clean);
  writeOverrides({ disabledPacks: Array.from(next) });
  return listPolicyPacks();
}

export function policyOverridePath(): string {
  return OVERRIDE_FILE;
}
