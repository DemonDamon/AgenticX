import assert from "node:assert/strict";
import test from "node:test";

import { getVisibleBoundSession } from "./session-history-logic.ts";

type Row = {
  session_id: string;
  avatar_id: string | null;
  session_name: string | null;
  updated_at: number;
};

test("does not surface a bound session that belongs to another pane", () => {
  const rows: Row[] = [
    {
      session_id: "meta-session",
      avatar_id: null,
      session_name: "meta",
      updated_at: 1,
    },
    {
      session_id: "avatar-session",
      avatar_id: "avatar-a",
      session_name: "avatar",
      updated_at: 2,
    },
  ];

  assert.equal(getVisibleBoundSession("avatar-session", rows, null), null);
  assert.equal(getVisibleBoundSession("meta-session", rows, "avatar-a"), null);
});

test("returns the real row when the bound session belongs to current pane", () => {
  const rows: Row[] = [
    {
      session_id: "avatar-session",
      avatar_id: "avatar-a",
      session_name: "avatar",
      updated_at: 2,
    },
  ];

  assert.deepEqual(
    getVisibleBoundSession("avatar-session", rows, "avatar-a"),
    rows[0],
  );
});
