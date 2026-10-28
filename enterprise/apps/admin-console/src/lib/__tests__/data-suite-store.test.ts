import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_DICTIONARY_FIELDS,
  getBoard,
  listBoards,
  listDictionaryFields,
  upsertBoard,
  upsertDictionaryField,
} from "../data-suite-store";
import { SAMPLE_BOARD } from "../data-board-fixture";

const ORIGINAL_DIR = process.env.AGX_DATA_SUITE_STORE_DIR;
let tempDir: string;

function restoreEnv() {
  if (ORIGINAL_DIR === undefined) delete process.env.AGX_DATA_SUITE_STORE_DIR;
  else process.env.AGX_DATA_SUITE_STORE_DIR = ORIGINAL_DIR;
}

describe("data-suite-store", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-data-suite-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = tempDir;
  });

  afterEach(async () => {
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds dictionary on first list and persists upsert", async () => {
    const fields = await listDictionaryFields();
    expect(fields.map((f) => f.name)).toEqual(SAMPLE_DICTIONARY_FIELDS.map((f) => f.name));

    const updated = await upsertDictionaryField({
      name: "member_id",
      business_def: "Updated",
      calc_logic: "x",
      update_freq: "hourly",
      owner: "platform",
    });
    expect(updated.business_def).toBe("Updated");

    const again = await listDictionaryFields();
    expect(again.find((f) => f.name === "member_id")?.update_freq).toBe("hourly");

    const disk = JSON.parse(await readFile(path.join(tempDir, "dictionary.json"), "utf-8")) as {
      fields: { name: string; business_def: string }[];
    };
    expect(disk.fields.find((f) => f.name === "member_id")?.business_def).toBe("Updated");
  });

  it("adds a new dictionary field", async () => {
    await listDictionaryFields();
    await upsertDictionaryField({
      name: "region",
      business_def: "Member region",
      calc_logic: "raw",
      update_freq: "daily",
      owner: "data-platform",
    });
    const names = (await listDictionaryFields()).map((f) => f.name);
    expect(names).toContain("region");
  });

  it("seeds boards and roundtrips upsert by id", async () => {
    const boards = await listBoards();
    expect(boards.some((b) => b.id === SAMPLE_BOARD.id)).toBe(true);

    const created = await upsertBoard({
      id: "ops_board",
      title: "Ops",
      drillLevels: ["region"],
      widgets: [],
    });
    expect(created.id).toBe("ops_board");

    const got = await getBoard("ops_board");
    expect(got?.title).toBe("Ops");

    await upsertBoard({ id: "ops_board", title: "Ops v2", drillLevels: ["region"], widgets: [] });
    expect((await getBoard("ops_board"))?.title).toBe("Ops v2");

    const disk = JSON.parse(await readFile(path.join(tempDir, "boards.json"), "utf-8")) as {
      boards: { id: string; title: string }[];
    };
    expect(disk.boards.find((b) => b.id === "ops_board")?.title).toBe("Ops v2");
  });
});
