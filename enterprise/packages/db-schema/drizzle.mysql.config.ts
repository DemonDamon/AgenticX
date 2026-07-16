import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/mysql-schema/index.ts",
  out: "./drizzle-mysql",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://agenticx:agenticx@127.0.0.1:3306/agenticx",
  },
  strict: true,
  verbose: true,
});
