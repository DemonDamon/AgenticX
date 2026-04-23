import type { MeteringQueryInput } from "../types";
import { MeteringService } from "../services/metering";

export class MeteringApi {
  private readonly service: MeteringService;

  public constructor(service?: MeteringService) {
    this.service = service ?? new MeteringService();
  }

  public async query(input: MeteringQueryInput) {
    const data = await this.service.query(input);
    return {
      code: "00000",
      message: "ok",
      data,
    };
  }
}

