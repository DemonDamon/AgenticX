import type { AuthUser, AuthUserRepository } from "@agenticx/auth";
import { resolveDatabaseConfig } from "./database/config";
import { MysqlAuthUserRepository } from "./mysql-auth-user-repository";
import {
  loadAuthUserByEmail,
  resetFailedLoginPg,
  updatePasswordAndClearRequirementPg,
  updateFailedLoginPg,
  upsertUserRowFromAuthUser,
} from "./repos/users";

/**
 * Portal 登录用：单租户部署以 DEFAULT_TENANT_ID 隔离。
 */
export class PgAuthUserRepository implements AuthUserRepository {
  private readonly mysqlDelegate: MysqlAuthUserRepository | null;

  public constructor(private readonly tenantId: string) {
    this.mysqlDelegate =
      resolveDatabaseConfig().dialect === "mysql"
        ? new MysqlAuthUserRepository(tenantId)
        : null;
  }

  public async findByEmail(email: string): Promise<AuthUser | null> {
    if (this.mysqlDelegate) return this.mysqlDelegate.findByEmail(email);
    return loadAuthUserByEmail(this.tenantId, email);
  }

  public async updateFailedLogin(email: string, nextFailedCount: number, lockedUntil: number | null): Promise<void> {
    if (this.mysqlDelegate) {
      await this.mysqlDelegate.updateFailedLogin(email, nextFailedCount, lockedUntil);
      return;
    }
    await updateFailedLoginPg(this.tenantId, email, nextFailedCount, lockedUntil);
  }

  public async resetFailedLogin(email: string): Promise<void> {
    if (this.mysqlDelegate) {
      await this.mysqlDelegate.resetFailedLogin(email);
      return;
    }
    await resetFailedLoginPg(this.tenantId, email);
  }

  public async updatePasswordAndClearRequirement(email: string, passwordHash: string): Promise<AuthUser | null> {
    if (this.mysqlDelegate) {
      return this.mysqlDelegate.updatePasswordAndClearRequirement(email, passwordHash);
    }
    return updatePasswordAndClearRequirementPg(this.tenantId, email, passwordHash);
  }

  /** 扩展能力（非 AuthUserRepository 接口）：dev bootstrap / sync */
  public async upsertUser(user: AuthUser): Promise<void> {
    if (this.mysqlDelegate) {
      await this.mysqlDelegate.upsertUser(user);
      return;
    }
    await upsertUserRowFromAuthUser(user);
  }
}
