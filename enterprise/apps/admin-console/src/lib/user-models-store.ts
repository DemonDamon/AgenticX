/**
 * admin-console · 用户 ↔ 模型可见性映射
 *
 * 数据落盘到 enterprise/.runtime/admin/user-models.json，与 providers.json 同目录。
 *
 * 模型 id 形如 "<providerId>/<modelName>"，必须与 providers.json 里的 model.name 对得上。
 */

import * as fs from "node:fs";
import * as path from "node:path";

const RUNTIME_DIR = path.resolve(process.cwd(), "../../.runtime/admin");
const FILE_PATH = path.join(RUNTIME_DIR, "user-models.json");

type Mapping = Record<string, string[]>;

declare global {
  // eslint-disable-next-line no-var
  var __agenticxUserModelsCache: Mapping | undefined;
}

function ensureDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  }
}

function readFile(): Mapping {
  ensureDir();
  if (!fs.existsSync(FILE_PATH)) return {};
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as { userModels?: Mapping };
    return parsed.userModels ?? {};
  } catch {
    return {};
  }
}

function writeFile(mapping: Mapping): void {
  ensureDir();
  const tmp = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ userModels: mapping }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE_PATH);
}

function load(): Mapping {
  if (!globalThis.__agenticxUserModelsCache) {
    globalThis.__agenticxUserModelsCache = readFile();
  }
  return globalThis.__agenticxUserModelsCache;
}

function persist(): void {
  if (!globalThis.__agenticxUserModelsCache) return;
  writeFile(globalThis.__agenticxUserModelsCache);
}

export function getUserModels(userId: string): string[] {
  const mapping = load();
  return mapping[userId] ? [...mapping[userId]] : [];
}

export function setUserModels(userId: string, modelIds: string[]): string[] {
  const mapping = load();
  const unique = Array.from(new Set(modelIds.map((m) => m.trim()).filter(Boolean)));
  mapping[userId] = unique;
  persist();
  return [...unique];
}

export function listAllAssignments(): Mapping {
  const mapping = load();
  return Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, [...v]]));
}

export function deleteUserAssignment(userId: string): void {
  const mapping = load();
  if (mapping[userId]) {
    delete mapping[userId];
    persist();
  }
}

export function userModelsFilePath(): string {
  return FILE_PATH;
}

/** Reset cache (test only). */
export function __resetUserModelsCache(): void {
  globalThis.__agenticxUserModelsCache = undefined;
}
