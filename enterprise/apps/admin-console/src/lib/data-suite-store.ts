import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SAMPLE_BOARD, type BoardSpec } from "./data-board-fixture";

export type DictionaryField = {
  name: string;
  business_def: string;
  calc_logic: string;
  update_freq: string;
  owner: string;
};

/** Seed fields mirrored from data-governance SAMPLE_FIELDS / sample_dictionary.yaml. */
export const SAMPLE_DICTIONARY_FIELDS: DictionaryField[] = [
  {
    name: "member_id",
    business_def: "Stable member primary key after OneID merge",
    calc_logic: "idmapping.merge primary",
    update_freq: "daily",
    owner: "data-platform",
  },
  {
    name: "mobile_hash",
    business_def: "Hashed mobile used as ID edge",
    calc_logic: "sha256(mobile_e164)",
    update_freq: "daily",
    owner: "data-platform",
  },
];

type DictionaryFile = { fields: DictionaryField[] };
type BoardsFile = { boards: BoardSpec[] };

function storeDir(): string {
  const env = process.env.AGX_DATA_SUITE_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/data-suite");
}

function dictionaryPath(): string {
  return path.join(storeDir(), "dictionary.json");
}

function boardsPath(): string {
  return path.join(storeDir(), "boards.json");
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function normalizeField(row: Partial<DictionaryField> & { name: string }): DictionaryField {
  return {
    name: row.name.trim(),
    business_def: String(row.business_def ?? ""),
    calc_logic: String(row.calc_logic ?? ""),
    update_freq: String(row.update_freq ?? ""),
    owner: String(row.owner ?? ""),
  };
}

function normalizeBoard(row: Partial<BoardSpec> & { id: string }): BoardSpec {
  return {
    id: row.id.trim(),
    title: String(row.title ?? row.id),
    drillLevels: Array.isArray(row.drillLevels) ? row.drillLevels.map(String) : [],
    widgets: Array.isArray(row.widgets) ? row.widgets : [],
  };
}

async function ensureDictionarySeed(): Promise<DictionaryFile> {
  const file = dictionaryPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<DictionaryFile>(file, { fields: [...SAMPLE_DICTIONARY_FIELDS] });
  } catch {
    const seeded: DictionaryFile = { fields: SAMPLE_DICTIONARY_FIELDS.map((f) => ({ ...f })) };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureBoardsSeed(): Promise<BoardsFile> {
  const file = boardsPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<BoardsFile>(file, { boards: [{ ...SAMPLE_BOARD, widgets: [...SAMPLE_BOARD.widgets] }] });
  } catch {
    const seeded: BoardsFile = {
      boards: [{ ...SAMPLE_BOARD, widgets: SAMPLE_BOARD.widgets.map((w) => ({ ...w })) }],
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

export async function listDictionaryFields(): Promise<DictionaryField[]> {
  const data = await ensureDictionarySeed();
  return [...(data.fields ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertDictionaryField(
  input: Partial<DictionaryField> & { name: string },
): Promise<DictionaryField> {
  if (!input.name?.trim()) {
    throw new Error("name required");
  }
  const field = normalizeField(input);
  const data = await ensureDictionarySeed();
  const fields = [...(data.fields ?? [])];
  const idx = fields.findIndex((f) => f.name === field.name);
  if (idx >= 0) fields[idx] = field;
  else fields.push(field);
  fields.sort((a, b) => a.name.localeCompare(b.name));
  await writeJsonFile(dictionaryPath(), { fields });
  return field;
}

export async function listBoards(): Promise<BoardSpec[]> {
  const data = await ensureBoardsSeed();
  return [...(data.boards ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getBoard(id: string): Promise<BoardSpec | null> {
  const boards = await listBoards();
  return boards.find((b) => b.id === id) ?? null;
}

export async function upsertBoard(input: Partial<BoardSpec> & { id: string }): Promise<BoardSpec> {
  if (!input.id?.trim()) {
    throw new Error("id required");
  }
  const board = normalizeBoard(input);
  const data = await ensureBoardsSeed();
  const boards = [...(data.boards ?? [])];
  const idx = boards.findIndex((b) => b.id === board.id);
  if (idx >= 0) boards[idx] = board;
  else boards.push(board);
  boards.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonFile(boardsPath(), { boards });
  return board;
}
