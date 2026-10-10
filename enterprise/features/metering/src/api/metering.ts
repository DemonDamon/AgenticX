import type { HourlyRidgeResult, OverviewQueryInput, OverviewStatsResult, MeteringQueryInput, MeteringQueryResult, RequestSizeDistResult, TraceListResult } from "../types";
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

  public async overview(input: OverviewQueryInput): Promise<{ code: string; message: string; data: OverviewStatsResult }> {
    const data = await this.service.queryOverviewStats(input);
    return { code: "00000", message: "ok", data };
  }

  public async traceList(input: OverviewQueryInput & { limit?: number }): Promise<{ code: string; message: string; data: TraceListResult }> {
    const data = await this.service.queryTraceList(input);
    return { code: "00000", message: "ok", data };
  }

  public async hourlyRidge(input: OverviewQueryInput & { top_n?: number }): Promise<{ code: string; message: string; data: HourlyRidgeResult }> {
    const data = await this.service.queryHourlyModelRidge(input);
    return { code: "00000", message: "ok", data };
  }

  public async requestDistribution(input: OverviewQueryInput & { top_n?: number }): Promise<{ code: string; message: string; data: RequestSizeDistResult }> {
    const data = await this.service.queryRequestSizeDistribution(input);
    return { code: "00000", message: "ok", data };
  }
}

