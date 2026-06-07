import type { BusinessRevenueInput, RoiReportInput } from "../types";
import { RoiService } from "../services/roi";
import { roiRowsToCsv } from "../services/roi-utils";

export class RoiApi {
  private readonly service: RoiService;

  public constructor(service?: RoiService) {
    this.service = service ?? new RoiService();
  }

  public async report(input: RoiReportInput) {
    const data = await this.service.computeReport(input);
    return {
      code: "00000",
      message: "ok",
      data,
    };
  }

  public reportCsv(input: RoiReportInput) {
    return this.service.computeReport(input).then((result) => roiRowsToCsv(result.rows));
  }

  public async listRevenues(tenantId: string) {
    const items = await this.service.listRevenues(tenantId);
    return {
      code: "00000",
      message: "ok",
      data: { items },
    };
  }

  public async createRevenue(input: BusinessRevenueInput) {
    const item = await this.service.createRevenue(input);
    return {
      code: "00000",
      message: "ok",
      data: { item },
    };
  }

  public async updateRevenue(tenantId: string, id: string, patch: Partial<Omit<BusinessRevenueInput, "tenant_id">>) {
    const item = await this.service.updateRevenue(tenantId, id, patch);
    if (!item) {
      return {
        code: "40401",
        message: "revenue record not found",
        data: null,
      };
    }
    return {
      code: "00000",
      message: "ok",
      data: { item },
    };
  }

  public async deleteRevenue(tenantId: string, id: string) {
    const deleted = await this.service.deleteRevenue(tenantId, id);
    if (!deleted) {
      return {
        code: "40401",
        message: "revenue record not found",
        data: null,
      };
    }
    return {
      code: "00000",
      message: "ok",
      data: { deleted: true },
    };
  }
}
