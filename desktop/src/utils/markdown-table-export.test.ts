import assert from "node:assert/strict";
import test from "node:test";
import { extractTableRows, rowsToCsv, rowsToTsv } from "./markdown-table-export";

test("extractTableRows reads header and body cells", () => {
  const mkCell = (text: string) => ({ textContent: text });
  const mkRow = (texts: string[]) => ({
    querySelectorAll: (sel: string) => (sel === "th, td" ? texts.map(mkCell) : []),
  });
  const table = {
    querySelectorAll: (sel: string) =>
      sel === "tr" ? [mkRow(["A", "B"]), mkRow(["1", "2"])] : [],
  } as unknown as HTMLTableElement;

  assert.deepEqual(extractTableRows(table), [
    ["A", "B"],
    ["1", "2"],
  ]);
});

test("rowsToCsv escapes commas and quotes", () => {
  const csv = rowsToCsv([
    ["name", "note"],
    ["foo", 'say "hi", world'],
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"say ""hi"", world"/);
});

test("rowsToTsv joins with tabs", () => {
  assert.equal(
    rowsToTsv([
      ["差距维度", "优先级"],
      ["信息摄入", "P0"],
    ]),
    "差距维度\t优先级\n信息摄入\tP0",
  );
});
