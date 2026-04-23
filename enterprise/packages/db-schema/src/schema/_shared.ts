import { sql } from "drizzle-orm";
import { boolean, timestamp, varchar } from "drizzle-orm/pg-core";

export const ulid = (name: string) => varchar(name, { length: 26 });

export const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const softDeleteColumns = {
  isDeleted: boolean("is_deleted").default(false).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const nowTimestamp = sql`timezone('utc', now())`;

