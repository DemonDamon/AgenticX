import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { agxHomePath } from "./agx-home";

export type LocalSpace = {
  id: string;
  name: string;
  path: string;
  created_at: number;
};

export type LocalSpacesFile = {
  version: 1;
  spaces: LocalSpace[];
  session_space: Record<string, string>;
};

const EMPTY = (): LocalSpacesFile => ({ version: 1, spaces: [], session_space: {} });

let spacesFileOverride: string | null = null;

export function setLocalSpacesFileForTests(filePath: string | null): void {
  spacesFileOverride = filePath;
}

function spacesFilePath(): string {
  if (spacesFileOverride && spacesFileOverride.trim()) return spacesFileOverride;
  return agxHomePath("spaces.json");
}

function canonicalDir(dirPath: string): string {
  try {
    return fs.realpathSync(dirPath);
  } catch {
    return path.resolve(dirPath);
  }
}

export function readLocalSpaces(): LocalSpacesFile {
  try {
    const raw = fs.readFileSync(spacesFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalSpacesFile> | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.spaces)) return EMPTY();
    const spaces: LocalSpace[] = [];
    for (const item of parsed.spaces) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id ?? "").trim();
      const dir = String(item.path ?? "").trim();
      if (!id || !dir) continue;
      const created = Number(item.created_at);
      const name = String(item.name ?? "").trim();
      spaces.push({
        id,
        name: name || path.basename(dir),
        path: dir,
        created_at: Number.isFinite(created) ? created : 0,
      });
    }
    const session_space: Record<string, string> = {};
    if (parsed.session_space && typeof parsed.session_space === "object" && !Array.isArray(parsed.session_space)) {
      for (const [sessionId, spaceId] of Object.entries(parsed.session_space)) {
        if (!sessionId.trim() || typeof spaceId !== "string" || !spaceId.trim()) continue;
        session_space[sessionId] = spaceId;
      }
    }
    return { version: 1, spaces, session_space };
  } catch {
    return EMPTY();
  }
}

export function writeLocalSpaces(data: LocalSpacesFile): void {
  const file = spacesFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const payload: LocalSpacesFile = {
    version: 1,
    spaces: data.spaces,
    session_space: data.session_space,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, file);
}

export function createLocalSpace(input: {
  path: string;
  name?: string;
}): { ok: true; space: LocalSpace } | { ok: false; error: "not-a-directory" } {
  const raw = String(input.path ?? "").trim();
  if (!raw) return { ok: false, error: "not-a-directory" };
  const resolved = path.resolve(raw);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, error: "not-a-directory" };
  }
  if (!stat.isDirectory()) return { ok: false, error: "not-a-directory" };
  const canonical = canonicalDir(resolved);
  const data = readLocalSpaces();
  const existing = data.spaces.find((space) => canonicalDir(space.path) === canonical);
  if (existing) return { ok: true, space: existing };
  const baseName = path.basename(canonical) || canonical;
  const name = String(input.name ?? "").trim() || baseName;
  const space: LocalSpace = {
    id: crypto.randomUUID(),
    name,
    path: canonical,
    created_at: Date.now(),
  };
  data.spaces.push(space);
  writeLocalSpaces(data);
  return { ok: true, space };
}

export function removeLocalSpace(id: string): { ok: true } {
  const target = String(id ?? "").trim();
  const data = readLocalSpaces();
  data.spaces = data.spaces.filter((space) => space.id !== target);
  const session_space: Record<string, string> = {};
  for (const [sessionId, spaceId] of Object.entries(data.session_space)) {
    if (spaceId !== target) session_space[sessionId] = spaceId;
  }
  data.session_space = session_space;
  writeLocalSpaces(data);
  return { ok: true };
}

export function assignSessionToSpace(input: { sessionId: string; spaceId: string }): { ok: true } {
  const sessionId = String(input.sessionId ?? "").trim();
  const spaceId = String(input.spaceId ?? "").trim();
  if (!sessionId || !spaceId) return { ok: true };
  const data = readLocalSpaces();
  if (!data.spaces.some((space) => space.id === spaceId)) return { ok: true };
  data.session_space[sessionId] = spaceId;
  writeLocalSpaces(data);
  return { ok: true };
}
