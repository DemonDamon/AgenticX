import type { AuditActor, AuditQueryInput, AuditStore } from "../types";

export class AuditApi {
  private readonly store: AuditStore;

  public constructor(store: AuditStore) {
    this.store = store;
  }

  public async query(actor: AuditActor, input: AuditQueryInput) {
    const data = await this.store.query(actor, input);
    return {
      code: "00000",
      message: "ok",
      data,
    };
  }

  public async exportCsv(actor: AuditActor, input: AuditQueryInput) {
    const csv = await this.store.exportCsv(actor, input);
    return {
      code: "00000",
      message: "ok",
      data: { csv },
    };
  }
}

