import type { AuthContext } from "@agenticx/auth";
import { IamUserService } from "../services/user";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "../types";

type JsonResponse<T> = {
  code: string;
  message: string;
  data?: T;
};

function ok<T>(data: T): JsonResponse<T> {
  return {
    code: "00000",
    message: "ok",
    data,
  };
}

export class IamUsersApi {
  private readonly service: IamUserService;

  public constructor(service: IamUserService) {
    this.service = service;
  }

  public async create(auth: AuthContext, input: CreateUserInput) {
    const user = await this.service.createUser(auth, input);
    return ok(user);
  }

  public async list(auth: AuthContext, query?: ListUsersQuery) {
    const result = await this.service.listUsers(auth, query);
    return ok(result);
  }

  public async update(auth: AuthContext, userId: string, input: UpdateUserInput) {
    const user = await this.service.updateUser(auth, userId, input);
    return ok(user);
  }

  public async remove(auth: AuthContext, userId: string) {
    await this.service.deleteUser(auth, userId);
    return ok({ userId });
  }

  public async enable(auth: AuthContext, userId: string) {
    const user = await this.service.enableUser(auth, userId);
    return ok(user);
  }

  public async disable(auth: AuthContext, userId: string) {
    const user = await this.service.disableUser(auth, userId);
    return ok(user);
  }

  public async resetPassword(auth: AuthContext, userId: string, nextPasswordHash: string) {
    const user = await this.service.resetPassword(auth, userId, nextPasswordHash);
    return ok(user);
  }
}

