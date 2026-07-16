/** MySQL billing SQL helpers. */
export const mysqlBillingSql = {
  jsonCast: (p: string) => `CAST(${p} AS JSON)`,
  returning: "",
  now: "UTC_TIMESTAMP(6)",
} as const;
