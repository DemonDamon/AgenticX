import { test } from "vitest";
import assert from "node:assert/strict";
import { createListSessionsCoalescer, type ListSessionsResult } from "./list-sessions-coalesce";

const ok = (tag: string) => ({ ok: true, sessions: [{ session_id: tag }] }) as unknown as ListSessionsResult;

test("concurrent and recent polls share one request per avatar key", async () => {
  let t = 0;
  const calls: Array<string | undefined> = [];
  const list = createListSessionsCoalescer(async (id) => {
    calls.push(id);
    return ok(`r${calls.length}`);
  }, () => t);

  const [a, b] = await Promise.all([list(undefined), list(undefined)]);
  assert.equal(calls.length, 1);
  assert.strictEqual(a, b);

  t = 1000;
  await list(undefined);
  assert.equal(calls.length, 1, "within window reuses result");

  await list("avatar-1");
  assert.equal(calls.length, 2, "different avatar key fetches separately");

  t = 2000;
  await list(undefined);
  assert.equal(calls.length, 3, "after window fetches again");
});

test("a failed request is not cached", async () => {
  let n = 0;
  const list = createListSessionsCoalescer(async () => {
    n += 1;
    if (n === 1) throw new Error("boom");
    return ok("r2");
  }, () => 0);
  await assert.rejects(list(undefined));
  const r = await list(undefined);
  assert.equal(n, 2);
  assert.equal((r as { ok: boolean }).ok, true);
});
