/** Opt-in integration suite: migrate isolated databases before providing SSO_TEST_*_URL. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { Pool } from "pg";
import { createConnection } from "mysql2/promise";
import { findSsoIdentityLink, bindSsoIdentityLink, insertSsoUserIfAbsent, loadSsoAuthUserById } from "../sso-identity-links";
import { loadAuthUserByEmail } from "../users";
import { withTenantIamTransaction } from "../../database/tenant-iam-transaction";
import { __resetDatabaseForTests } from "../../database/factory";

const targets = [
  { dialect: "postgresql", url: process.env.SSO_TEST_POSTGRES_URL },
  { dialect: "mysql", url: process.env.SSO_TEST_MYSQL_URL },
] as const;
for (const target of targets) {
  describe.skipIf(!target.url)(`SSO identity links (${target.dialect}, real database)`, () => {
    const tenant = ulid(); const otherTenant = ulid(); const users: string[] = [];
    const savedUrl = process.env.DATABASE_URL; const savedDialect = process.env.DATABASE_DIALECT;
    let query: (sql: string, values?: unknown[]) => Promise<void>;
    let close: () => Promise<void>;
    const key = (suffix = ulid()) => ({ providerId: `provider-${suffix}`, issuer: "https://identity.example.test/Realm", subject: "StableSubject" });
    const user = async (tenantId = tenant) => {
      const id = ulid(); users.push(id);
      await query("INSERT INTO users (id, tenant_id, email, display_name, password_hash, status) VALUES (?, ?, ?, ?, ?, ?)", [id, tenantId, `${id.toLowerCase()}@identity.test`, "Synthetic user", "unused", "active"]);
      return id;
    };
    beforeAll(async () => {
      process.env.DATABASE_URL = target.url!; process.env.DATABASE_DIALECT = target.dialect;
      await __resetDatabaseForTests();
      if (target.dialect === "postgresql") {
        const pool = new Pool({ connectionString: target.url });
        query = async (sql, values) => { let n = 0; await pool.query(sql.replace(/\?/g, () => `$${++n}`), values); };
        close = () => pool.end();
      } else {
        const connection = await createConnection(target.url!);
        query = async (sql, values) => { await connection.query(sql, values); };
        close = () => connection.end();
      }
      for (const id of [tenant, otherTenant]) await query("INSERT INTO tenants (id, code, name) VALUES (?, ?, ?)", [id, id, "Synthetic tenant"]);
    });
    afterAll(async () => {
      for (const id of users) await query("DELETE FROM users WHERE id = ?", [id]);
      for (const id of [tenant, otherTenant]) await query("DELETE FROM tenants WHERE id = ?", [id]);
      await __resetDatabaseForTests(); await close();
      if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
      if (savedDialect === undefined) delete process.env.DATABASE_DIALECT; else process.env.DATABASE_DIALECT = savedDialect;
    });
    it("uses byte-exact provider, issuer and subject identity despite database collation", async () => {
      const id = await user(); const identity = key();
      await bindSsoIdentityLink(tenant, identity, id);
      expect((await findSsoIdentityLink(tenant, identity))?.userId).toBe(id);
      for (const changed of [{ ...identity, subject: "stablesubject" }, { ...identity, providerId: identity.providerId.toUpperCase() }, { ...identity, issuer: identity.issuer.toLowerCase() }]) {
        expect(await findSsoIdentityLink(tenant, changed)).toBeNull();
      }
      expect(await findSsoIdentityLink(otherTenant, identity)).toBeNull();
    });
    it("cannot overwrite an occupied identity or attach a second subject to its provider/user", async () => {
      const [a, b] = await Promise.all([user(), user()]); const identity = key();
      await bindSsoIdentityLink(tenant, identity, a);
      await expect(bindSsoIdentityLink(tenant, identity, b)).rejects.toThrow("oidc.identity_conflict");
      await expect(bindSsoIdentityLink(tenant, { ...identity, subject: "other" }, a)).rejects.toThrow("oidc.identity_conflict");
      expect((await findSsoIdentityLink(tenant, identity))?.userId).toBe(a);
    });
    it("enforces tenant ownership at the database foreign key", async () => {
      const id = await user(); const identity = key();
      await expect(bindSsoIdentityLink(otherTenant, identity, id)).rejects.toThrow();
      expect(await findSsoIdentityLink(otherTenant, identity)).toBeNull();
    });
    it("rolls back identity creation with its enclosing transaction", async () => {
      const id = await user(); const identity = key();
      await expect(withTenantIamTransaction(tenant, async () => { await bindSsoIdentityLink(tenant, identity, id); throw new Error("synthetic rollback"); })).rejects.toThrow("synthetic rollback");
      expect(await findSsoIdentityLink(tenant, identity)).toBeNull();
    });
    it("serializes independent concurrent first bindings without changing their winner", async () => {
      const [a, b] = await Promise.all([user(), user()]); const identity = key();
      const results = await Promise.allSettled([bindSsoIdentityLink(tenant, identity, a), bindSsoIdentityLink(tenant, identity, b)]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
      expect([a, b]).toContain((await findSsoIdentityLink(tenant, identity))?.userId);
    });
    it("keeps the original link while its user is soft deleted", async () => {
      const id = await user(); const identity = key(); await bindSsoIdentityLink(tenant, identity, id);
      await query("UPDATE users SET is_deleted = ?, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [true, id]);
      expect((await findSsoIdentityLink(tenant, identity))?.userId).toBe(id);
    });
    it("does not replace account credentials or status on a concurrent JIT email conflict", async () => {
      const id = await user(); const email = `${id.toLowerCase()}@identity.test`;
      await query("UPDATE users SET status = ? WHERE id = ?", ["disabled", id]);
      const attemptedId = ulid(); users.push(attemptedId);
      await withTenantIamTransaction(tenant, () => insertSsoUserIfAbsent({
        id: attemptedId, tenantId: tenant, email, displayName: "Replacement", passwordHash: "must-not-replace",
        status: "active", mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, scopes: [],
      }));
      const original = await loadAuthUserByEmail(tenant, email);
      expect(original?.id).toBe(id); expect(original?.passwordHash).toBe("unused"); expect(original?.status).toBe("disabled");
    });
    it("reads established identities concurrently without waiting for an unrelated first-bind transaction", async () => {
      const accounts = [];
      for (let n = 0; n < 4; n++) {
        const id = await user(); const identity = key(); await bindSsoIdentityLink(tenant, identity, id);
        accounts.push({ id, identity });
      }
      const pendingUser = await user(); const pendingIdentity = key();
      let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
      let release!: () => void; const unblock = new Promise<void>(resolve => { release = resolve; });
      const writer = withTenantIamTransaction(tenant, async () => {
        await bindSsoIdentityLink(tenant, pendingIdentity, pendingUser); entered(); await unblock;
      });
      await ready;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const reads = Promise.all(accounts.map(async account => {
          const link = await findSsoIdentityLink(tenant, account.identity);
          const current = await loadSsoAuthUserById(tenant, link!.userId);
          expect(current?.id).toBe(account.id);
        })).then(() => true);
        const timedOut = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); });
        expect(await Promise.race([reads, timedOut])).toBe(true);
        await reads;
      } finally { if (timer) clearTimeout(timer); release(); await writer; }
    });
    it("reuses a nested same-tenant transaction and rejects cross-tenant nesting", async () => {
      await withTenantIamTransaction(tenant, async () => {
        await expect(withTenantIamTransaction(tenant, async () => "same")).resolves.toBe("same");
        await expect(withTenantIamTransaction(otherTenant, async () => "other")).rejects.toThrow("Invalid IAM transaction context");
      });
    });
  });
}
