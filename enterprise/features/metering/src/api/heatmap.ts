import type { HeatmapQueryInput } from "../types";
import { MeteringService } from "../services/metering";

export class HeatmapApi {
  private readonly service: MeteringService;

  public constructor(service?: MeteringService) {
    this.service = service ?? new MeteringService();
  }

  public async query(input: HeatmapQueryInput) {
    const data = await this.service.queryHeatmap(input);
    return {
      code: "00000",
      message: "ok",
      data,
    };
  }
}
