/** PostgreSQL billing SQL helpers. */
export const postgresqlBillingSql = {
  jsonCast: (p: string) => `${p}::jsonb`,
  returning: " returning *",
  now: "now()",
} as const;
