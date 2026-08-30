import assert from "node:assert/strict";
import { test } from "vitest";

import {
  addComposeChip,
  buildSuggestions,
  composeEnterHint,
  composePlaceholder,
  consumeCommaInput,
  formatGroupDisplayName,
  formatGroupDisplayNameFromFullNames,
  resolveGroupTitle,
  shortExpertDisplayName,
  hasExactAvatarName,
  previewTarget,
  resolveEnterCommit,
  resolveTabAdd,
  shouldDismissComposeOnOutsideClick,
} from "./quick-compose.ts";

const avatars = [
  { id: "a-del", name: "del" },
  { id: "a-kk", name: "kk" },
  { id: "a-near", name: "Near" },
  { id: "a-bob", name: "Bob" },
];

const groups = [
  { id: "g-1", name: "del、kk、Near和Bob", avatarIds: ["a-del", "a-kk", "a-near", "a-bob"] },
];

test("empty compose dismisses on outside click; chips or typed text keep the bar", () => {
  assert.equal(shouldDismissComposeOnOutsideClick("", 0), true);
  assert.equal(shouldDismissComposeOnOutsideClick("  ", 0), true);
  assert.equal(shouldDismissComposeOnOutsideClick("del", 0), false);
  assert.equal(shouldDismissComposeOnOutsideClick("", 1), false);
});

test("placeholder switches after the first chip", () => {
  assert.equal(composePlaceholder("expert", 0), "搜索或创建专家");
  assert.equal(composePlaceholder("group", 0), "搜索或添加专家");
  assert.equal(composePlaceholder("expert", 1), "添加或创建另一个专家");
});

test("enter hint is 创建 for a new name or a multi-chip commit", () => {
  assert.equal(composeEnterHint("create", 0, "oo"), "创建");
  assert.equal(composeEnterHint("avatar", 0, "del"), "打开");
  assert.equal(composeEnterHint("avatar", 2, ""), "创建");
});

test("group title uses顿号 and 和", () => {
  assert.equal(formatGroupDisplayName(["del"]), "del");
  assert.equal(formatGroupDisplayName(["del", "kk"]), "del和kk");
  assert.equal(formatGroupDisplayName(["del", "kk", "Near", "Bob"]), "del、kk、Near和Bob");
});

test("role·name experts use the given name in group titles", () => {
  assert.equal(shortExpertDisplayName("架构师·阿析"), "阿析");
  assert.equal(shortExpertDisplayName("程基岩"), "程基岩");
  assert.equal(shortExpertDisplayName("环境配置专家"), "环境配置专家");
  assert.equal(formatGroupDisplayName(["架构师·阿析", "程基岩"]), "阿析和程基岩");
  assert.equal(formatGroupDisplayName(["后端·北辰", "前端·晴空", "安全·司南"]), "北辰、晴空和司南");
  assert.equal(
    formatGroupDisplayNameFromFullNames(["架构师·阿析", "程基岩"]),
    "架构师·阿析和程基岩",
  );
  assert.equal(resolveGroupTitle("架构师·阿析和程基岩", ["架构师·阿析", "程基岩"]), "阿析和程基岩");
  assert.equal(resolveGroupTitle("项目攻坚", ["架构师·阿析", "程基岩"]), "项目攻坚");
});

test("comma split accepts ASCII and Chinese commas", () => {
  assert.deepEqual(consumeCommaInput("del,"), { token: "del", remainder: "" });
  assert.deepEqual(consumeCommaInput("kk，Near"), { token: "kk", remainder: "Near" });
  assert.equal(consumeCommaInput("del"), null);
  assert.equal(consumeCommaInput(","), null);
});

test("suggestions offer 创建 when the name does not exist", () => {
  const rows = buildSuggestions({ query: "oo", avatars, groups });
  assert.equal(rows[0]?.kind, "create");
  if (rows[0]?.kind === "create") assert.equal(rows[0].name, "oo");
  assert.equal(hasExactAvatarName(avatars, "oo"), false);
});

test("exact existing name does not offer 创建 and ranks that expert first", () => {
  const rows = buildSuggestions({ query: "del", avatars, groups });
  assert.equal(rows.some((row) => row.kind === "create"), false);
  assert.equal(rows[0]?.kind, "avatar");
  if (rows[0]?.kind === "avatar") assert.equal(rows[0].id, "a-del");
  const group = rows.find((row) => row.kind === "group");
  assert.ok(group);
});

test("already-added experts are excluded from suggestions", () => {
  const rows = buildSuggestions({
    query: "",
    avatars,
    groups,
    excludeAvatarIds: ["a-del"],
  });
  assert.equal(rows.some((row) => row.kind === "avatar" && row.id === "a-del"), false);
});

test("tab adds an existing expert; comma-created names become pending chips", () => {
  const added = resolveTabAdd({
    chips: [],
    suggestion: { kind: "avatar", id: "a-del", name: "del" },
    query: "del",
    avatars,
  });
  assert.deepEqual(added, {
    action: "add-chips",
    chips: [{ kind: "avatar", id: "a-del", name: "del" }],
  });

  const created = resolveTabAdd({
    chips: [{ kind: "avatar", id: "a-del", name: "del" }],
    suggestion: { kind: "create", name: "oo" },
    query: "oo",
    avatars,
  });
  assert.equal(created.action, "add-chips");
  if (created.action === "add-chips") {
    assert.equal(created.chips.length, 2);
    assert.deepEqual(created.chips[1], { kind: "create", name: "oo" });
  }
});

test("tab on a group adds its members instead of a group chip", () => {
  const added = resolveTabAdd({
    chips: [],
    suggestion: {
      kind: "group",
      id: "g-1",
      name: "del、kk、Near和Bob",
      memberNames: ["del", "kk", "Near", "Bob"],
    },
    query: "del",
    avatars,
  });
  assert.equal(added.action, "add-chips");
  if (added.action === "add-chips") {
    assert.equal(added.chips.length, 4);
    assert.equal(added.chips.every((chip) => chip.kind === "avatar"), true);
  }
});

test("enter on a lone existing expert opens it; unknown name creates it", () => {
  assert.deepEqual(
    resolveEnterCommit({
      chips: [],
      suggestion: { kind: "avatar", id: "a-del", name: "del" },
      query: "del",
    }),
    { action: "open-avatar", id: "a-del", name: "del" },
  );
  assert.deepEqual(
    resolveEnterCommit({
      chips: [],
      suggestion: { kind: "create", name: "oo" },
      query: "oo",
    }),
    { action: "create-avatar", name: "oo" },
  );
});

test("enter with two recipients creates a group; highlighted group opens that group", () => {
  const groupCommit = resolveEnterCommit({
    chips: [{ kind: "avatar", id: "a-del", name: "del" }],
    suggestion: { kind: "avatar", id: "a-kk", name: "kk" },
    query: "kk",
  });
  assert.deepEqual(groupCommit, {
    action: "create-group",
    avatarIds: ["a-del", "a-kk"],
    pendingNames: [],
  });

  assert.deepEqual(
    resolveEnterCommit({
      chips: [{ kind: "avatar", id: "a-del", name: "del" }],
      suggestion: { kind: "group", id: "g-1", name: "del、kk、Near和Bob", memberNames: [] },
      query: "del",
    }),
    { action: "open-group", id: "g-1", name: "del、kk、Near和Bob" },
  );
});

test("enter with existing chips plus a new name creates that expert and a group", () => {
  assert.deepEqual(
    resolveEnterCommit({
      chips: [
        { kind: "avatar", id: "a-del", name: "del" },
        { kind: "avatar", id: "a-kk", name: "kk" },
      ],
      suggestion: { kind: "create", name: "oo" },
      query: "oo",
    }),
    {
      action: "create-group",
      avatarIds: ["a-del", "a-kk"],
      pendingNames: ["oo"],
    },
  );
});

test("empty query commits the chip row", () => {
  assert.deepEqual(
    resolveEnterCommit({
      chips: [{ kind: "avatar", id: "a-del", name: "del" }],
      suggestion: { kind: "avatar", id: "a-kk", name: "kk" },
      query: "",
    }),
    { action: "open-avatar", id: "a-del", name: "del" },
  );
});

test("empty query does not add the highlighted leftover expert into the group", () => {
  assert.deepEqual(
    resolveEnterCommit({
      chips: [
        { kind: "avatar", id: "a-del", name: "del" },
        { kind: "avatar", id: "a-kk", name: "kk" },
      ],
      suggestion: { kind: "avatar", id: "a-near", name: "Near" },
      query: "",
    }),
    {
      action: "create-group",
      avatarIds: ["a-del", "a-kk"],
      pendingNames: [],
    },
  );
});

test("preview only follows an existing expert or group", () => {
  assert.deepEqual(previewTarget({ kind: "avatar", id: "a-del", name: "del" }), {
    type: "avatar",
    id: "a-del",
    name: "del",
  });
  assert.equal(previewTarget({ kind: "create", name: "oo" }), null);
});

test("duplicate chips are ignored", () => {
  const first = addComposeChip([], { kind: "avatar", id: "a-del", name: "del" });
  const again = addComposeChip(first, { kind: "avatar", id: "a-del", name: "del" });
  assert.equal(again.length, 1);
});
