import { sql } from "drizzle-orm";
import { boolean, datetime, varchar } from "drizzle-orm/mysql-core";

export const ulid = (name: string) => varchar(name, { length: 26 });

export const auditColumns = {
  createdAt: datetime("created_at", { fsp: 6 }).default(sql`UTC_TIMESTAMP(6)`).notNull(),
  updatedAt: datetime("updated_at", { fsp: 6 }).default(sql`UTC_TIMESTAMP(6)`).notNull(),
};

export const softDeleteColumns = {
  isDeleted: boolean("is_deleted").default(false).notNull(),
  deletedAt: datetime("deleted_at", { fsp: 6 }),
};

export const nowTimestamp = sql`UTC_TIMESTAMP(6)`;
