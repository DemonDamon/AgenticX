/** Edge-case fixtures for offline PG→MySQL migration verification. */
export const EDGE_CASE_ROWS = {
  chineseEmojiUser: {
    id: "01JEDGE000000000000000001",
    email: "emoji@example.com",
    display_name: "测试用户🎉",
  },
  softDeletedDuplicateEmail: [
    {
      id: "01JEDGE000000000000000002",
      email: "dup@example.com",
      is_deleted: true,
      deleted_at: "2026-01-01T00:00:00.000000Z",
    },
    {
      id: "01JEDGE000000000000000003",
      email: "dup@example.com",
      is_deleted: false,
      deleted_at: null,
    },
  ],
  hugeBigint: {
    monthly_tokens: "9007199254740993",
  },
  jsonKeyOrder: [{ z: 1, a: { y: 2, b: 3 } }, { a: { b: 3, y: 2 }, z: 1 }],
  dstBoundary: "2026-03-08T01:30:00.000Z",
};
