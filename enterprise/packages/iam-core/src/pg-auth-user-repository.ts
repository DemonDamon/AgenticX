import type { AuthUser, AuthUserRepository } from "@agenticx/auth";
import {
  loadAuthUserByEmail,
  resetFailedLoginPg,
  updateFailedLoginPg,
  upsertUserRowFromAuthUser,
} from "./repos/users";

/**
 * Portal 登录用：单租户部署以 DEFAULT_TENANT_ID 隔离。
 */
export class PgAuthUserRepository implements AuthUserRepository {
  public constructor(private readonly tenantId: string) {}

  public async findByEmail(email: string): Promise<AuthUser | null> {
    return loadAuthUserByEmail(this.tenantId, email);
  }

  public async updateFailedLogin(email: string, nextFailedCount: number, lockedUntil: number | null): Promise<void> {
    await updateFailedLoginPg(this.tenantId, email, nextFailedCount, lockedUntil);
  }

  public async resetFailedLogin(email: string): Promise<void> {
    await resetFailedLoginPg(this.tenantId, email);
  }

  /** 扩展能力（非 AuthUserRepository 接口）：dev bootstrap / sync */
  public async upsertUser(user: AuthUser): Promise<void> {
    await upsertUserRowFromAuthUser(user);
  }
}
