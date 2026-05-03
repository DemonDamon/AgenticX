#!/usr/bin/env node
/**
 * 扩展 IAM 演示数据：在已有 db:seed（租户 + owner + super_admin）基础上，
 * 插入多级部门、系统角色（owner/admin/auditor/member）与 10 个示例用户。
 *
 * 用法（在 monorepo 根目录）：
 *   pnpm --filter @agenticx/db-schema run db:seed:iam
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx";

const TENANT = "01J00000000000000000000001";
const ORG = "01J00000000000000000000002";
const OWNER_USER = "01J00000000000000000000004";

/** 固定长度 id（与 seed 风格一致），便于 ON CONFLICT 幂等 */
const DEPTS = [
  { id: "01J00000000000000000001001", parentId: null, name: "华东大区", path: "/华东大区/" },
  { id: "01J00000000000000000001002", parentId: "01J00000000000000000001001", name: "销售部", path: "/华东大区/销售部/" },
  { id: "01J00000000000000000001003", parentId: "01J00000000000000000001001", name: "交付部", path: "/华东大区/交付部/" },
  { id: "01J00000000000000000001004", parentId: null, name: "总部职能", path: "/总部职能/" },
  { id: "01J00000000000000000001005", parentId: "01J00000000000000000001004", name: "法务合规", path: "/总部职能/法务合规/" },
];

const ROLE_SEED = [
  {
    id: "01J00000000000000000001101",
    code: "owner",
    name: "企业拥有者",
    scopes: JSON.stringify([
      "admin:enter",
      "workspace:chat",
      "user:create",
      "user:read",
      "user:update",
      "user:delete",
      "user:manage",
      "dept:create",
      "dept:read",
      "dept:update",
      "dept:delete",
      "dept:manage",
      "role:create",
      "role:read",
      "role:update",
      "role:delete",
      "role:manage",
      "audit:read",
      "metering:read",
      "policy:read",
      "model:read",
    ]),
  },
  {
    id: "01J00000000000000000001102",
    code: "admin",
    name: "管理员",
    scopes: JSON.stringify([
      "admin:enter",
      "workspace:chat",
      "user:create",
      "user:read",
      "user:update",
      "dept:read",
      "dept:create",
      "role:read",
      "audit:read",
      "metering:read",
    ]),
  },
  {
    id: "01J00000000000000000001103",
    code: "auditor",
    name: "审计员",
    scopes: JSON.stringify(["admin:enter", "audit:read", "metering:read"]),
  },
  {
    id: "01J00000000000000000001104",
    code: "member",
    name: "成员",
    scopes: JSON.stringify(["workspace:chat", "user:read"]),
  }
];

const DEMO_USERS = [
  { id: "01J00000000000000000001201", email: "iam-demo-01@agenticx.local", name: "演示员工01", dept: "01J00000000000000000001002" },
  { id: "01J00000000000000000001202", email: "iam-demo-02@agenticx.local", name: "演示员工02", dept: "01J00000000000000000001002" },
  { id: "01J00000000000000000001203", email: "iam-demo-03@agenticx.local", name: "演示员工03", dept: "01J00000000000000000001003" },
  { id: "01J00000000000000000001204", email: "iam-demo-04@agenticx.local", name: "演示员工04", dept: "01J00000000000000000001003" },
  { id: "01J00000000000000000001205", email: "iam-demo-05@agenticx.local", name: "演示员工05", dept: "01J00000000000000000001005" },
  { id: "01J00000000000000000001206", email: "iam-demo-06@agenticx.local", name: "演示员工06", dept: "01J00000000000000000001001" },
  { id: "01J00000000000000000001207", email: "iam-demo-07@agenticx.local", name: "演示员工07", dept: "01J00000000000000000001004" },
  { id: "01J00000000000000000001208", email: "iam-demo-08@agenticx.local", name: "演示员工08", dept: "01J00000000000000000001002" },
  { id: "01J00000000000000000001209", email: "iam-demo-09@agenticx.local", name: "演示员工09", dept: "01J00000000000000000001003" },
  { id: "01J00000000000000000001210", email: "iam-demo-10@agenticx.local", name: "演示员工10", dept: "01J00000000000000000001005" },
];

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const pwd =
    process.env.AUTH_DEV_IAM_DEMO_PASSWORD?.trim() ||
    process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
    "ChangeMe_Dev14!Aa";
  const passwordHash = await bcrypt.hash(pwd, 12);

  const memberRoleId = "01J00000000000000000001104";

  try {
    await client.query("BEGIN");

    for (const d of DEPTS) {
      await client.query(
        `
        INSERT INTO departments (id, tenant_id, org_id, parent_id, name, path)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          path = EXCLUDED.path,
          parent_id = EXCLUDED.parent_id,
          updated_at = now()
        `,
        [d.id, TENANT, ORG, d.parentId, d.name, d.path]
      );
    }

    for (const r of ROLE_SEED) {
      await client.query(
        `
        INSERT INTO roles (id, tenant_id, code, name, scopes, immutable)
        VALUES ($1, $2, $3, $4, $5::jsonb, true)
        ON CONFLICT (tenant_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          scopes = EXCLUDED.scopes,
          immutable = true,
          updated_at = now()
        `,
        [r.id, TENANT, r.code, r.name, r.scopes]
      );
    }

    for (const u of DEMO_USERS) {
      await client.query(
        `
        INSERT INTO users (id, tenant_id, dept_id, email, display_name, password_hash, status,
          failed_login_count, locked_until, is_deleted, deleted_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', 0, NULL, false, NULL)
        ON CONFLICT (tenant_id, email) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          dept_id = EXCLUDED.dept_id,
          password_hash = EXCLUDED.password_hash,
          status = 'active',
          is_deleted = false,
          deleted_at = NULL,
          updated_at = now()
        `,
        [u.id, TENANT, u.dept, u.email, u.name, passwordHash]
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
        [TENANT, u.id, memberRoleId, ORG, u.dept]
      );
    }

    const ownerDept = "01J00000000000000000000003";
    await client.query(
      `
      INSERT INTO user_roles (tenant_id, user_id, role_id, scope_org_id, scope_dept_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
      `,
      [TENANT, OWNER_USER, "01J00000000000000000000005", ORG, ownerDept]
    );

    await client.query("COMMIT");
    console.log("IAM demo seed complete: 5 departments, 4 system roles, 10 demo users.");
    console.log(
      "Demo login password: AUTH_DEV_IAM_DEMO_PASSWORD > AUTH_DEV_OWNER_PASSWORD > default ChangeMe_Dev14!Aa"
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("iam-demo-seed failed:", err);
  process.exitCode = 1;
});
