/**
 * Resolve the AgenticX on-disk data root for Near Desktop (mirrors Python agx_home).
 *
 * Order: AGX_HOME / AGENTICX_HOME → ~/.agenticx/data_root.json → near.data_dir in
 * bootstrap ~/.agenticx/config.yaml → default ~/.agenticx.
 *
 * Author: Damon Li
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const BOOTSTRAP_DIR = path.join(os.homedir(), ".agenticx");
const DATA_ROOT_POINTER = path.join(BOOTSTRAP_DIR, "data_root.json");
const BOOTSTRAP_CONFIG = path.join(BOOTSTRAP_DIR, "config.yaml");

let cachedHome: string | null = null;

export function defaultAgenticxHomeDir(): string {
  return path.join(os.homedir(), ".agenticx");
}

function normalizeHomePath(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text || ["none", "null", "~", "~/.agenticx"].includes(text.toLowerCase())) {
    return null;
  }
  const expanded =
    text === "~" ? os.homedir() : text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
  return path.resolve(expanded);
}

function readEnvAgxHome(): string | null {
  for (const key of ["AGX_HOME", "AGENTICX_HOME"]) {
    const val = String(process.env[key] ?? "").trim();
    if (!val) continue;
    const resolved = normalizeHomePath(val);
    if (resolved) return resolved;
  }
  return null;
}

function readPointerDataDir(): string | null {
  try {
    if (!fs.existsSync(DATA_ROOT_POINTER)) return null;
    const parsed = JSON.parse(fs.readFileSync(DATA_ROOT_POINTER, "utf-8")) as {
      data_dir?: unknown;
      agenticx_home_dir?: unknown;
    };
    return normalizeHomePath(parsed.data_dir ?? parsed.agenticx_home_dir);
  } catch {
    return null;
  }
}

function readBootstrapYamlDataDir(): string | null {
  try {
    if (!fs.existsSync(BOOTSTRAP_CONFIG)) return null;
    const loaded = yaml.load(fs.readFileSync(BOOTSTRAP_CONFIG, "utf-8")) as Record<string, unknown>;
    if (!loaded || typeof loaded !== "object") return null;
    const near = loaded.near;
    if (near && typeof near === "object" && !Array.isArray(near)) {
      const n = near as Record<string, unknown>;
      const fromNear = normalizeHomePath(n.data_dir ?? n.agenticx_home_dir);
      if (fromNear) return fromNear;
    }
    for (const key of ["agenticx_home_dir", "data_dir"]) {
      const resolved = normalizeHomePath(loaded[key]);
      if (resolved) return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveAgxHomeDir(): string {
  return readEnvAgxHome() ?? readPointerDataDir() ?? readBootstrapYamlDataDir() ?? defaultAgenticxHomeDir();
}

export function getAgxHomeDir(): string {
  if (!cachedHome) {
    cachedHome = resolveAgxHomeDir();
  }
  return cachedHome;
}

export function refreshAgxHomeCache(): void {
  cachedHome = null;
}

export function agxHomePath(...segments: string[]): string {
  return path.join(getAgxHomeDir(), ...segments);
}

export function bootstrapAgenticxDir(): string {
  return BOOTSTRAP_DIR;
}

export function dataRootPointerPath(): string {
  return DATA_ROOT_POINTER;
}

export function writeDataRootPointer(dataDir: string): void {
  const resolved = normalizeHomePath(dataDir);
  if (!resolved) {
    throw new Error("data_dir must be a non-empty path");
  }
  fs.mkdirSync(BOOTSTRAP_DIR, { recursive: true });
  const payload = { data_dir: resolved };
  fs.writeFileSync(DATA_ROOT_POINTER, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  try {
    fs.chmodSync(DATA_ROOT_POINTER, 0o600);
  } catch {
    /* best-effort */
  }
}

export function clearDataRootPointer(): void {
  try {
    if (fs.existsSync(DATA_ROOT_POINTER)) fs.unlinkSync(DATA_ROOT_POINTER);
  } catch {
    /* best-effort */
  }
}

export function applyConfiguredDataDir(rawPath: string): { ok: true; resolved: string } | { ok: false; error: string } {
  const resolved = normalizeHomePath(rawPath);
  if (!resolved) {
    return { ok: false, error: "invalid_path" };
  }
  const isDefault = path.resolve(resolved) === path.resolve(defaultAgenticxHomeDir());
  if (isDefault) {
    clearDataRootPointer();
  } else {
    writeDataRootPointer(resolved);
  }
  refreshAgxHomeCache();
  return { ok: true, resolved };
}

export function agxHomeEnvForChildProcess(): Record<string, string> {
  return {
    AGX_HOME: getAgxHomeDir(),
    AGENTICX_HOME: getAgxHomeDir(),
  };
}
