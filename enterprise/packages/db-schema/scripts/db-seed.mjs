import { Client } from "pg";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx";

const ids = {
  tenant: "01J00000000000000000000001",
  org: "01J00000000000000000000002",
  dept: "01J00000000000000000000003",
  user: "01J00000000000000000000004",
  role: "01J00000000000000000000005",
};

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const seedPassword = process.env.AUTH_DEV_OWNER_PASSWORD?.trim() || "ChangeMe_Dev14!Aa";
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO tenants (id, code, name, plan)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        plan = EXCLUDED.plan,
        updated_at = now()
      `,
      [ids.tenant, "default", "Default Tenant", "enterprise"]
    );

    await client.query(
      `
      INSERT INTO organizations (id, tenant_id, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, name) DO UPDATE SET
        updated_at = now()
      `,
      [ids.org, ids.tenant, "总部"]
    );

    await client.query(
      `
      INSERT INTO departments (id, tenant_id, org_id, parent_id, name, path)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, path) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      `,
      [ids.dept, ids.tenant, ids.org, null, "平台研发部", "/总部/平台研发部/"]
    );

    await client.query(
      `
      INSERT INTO users (id, tenant_id, dept_id, email, display_name, password_hash, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, email) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        status = EXCLUDED.status,
        updated_at = now()
      `,
      [ids.user, ids.tenant, ids.dept, "owner@agenticx.local", "Seed Owner", passwordHash, "active"]
    );

    await client.query(
      `
      INSERT INTO roles (id, tenant_id, code, name, scopes, immutable)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (tenant_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        scopes = EXCLUDED.scopes,
        immutable = EXCLUDED.immutable,
        updated_at = now()
      `,
      [ids.role, ids.tenant, "super_admin", "Super Admin", JSON.stringify(["*"]), true]
    );

    await client.query(
      `
      INSERT INTO user_roles (tenant_id, user_id, role_id, scope_org_id, scope_dept_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, user_id, role_id) DO UPDATE SET
        scope_org_id = EXCLUDED.scope_org_id,
        scope_dept_id = EXCLUDED.scope_dept_id,
        updated_at = now()
      `,
      [ids.tenant, ids.user, ids.role, ids.org, ids.dept]
    );

    await client.query("COMMIT");
    console.log("Seed complete: default tenant + owner + super_admin.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});

