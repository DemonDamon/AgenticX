import { Pool } from "pg";
import { ulid } from "ulid";
import type { SettlementContractNotifyInput, SettlementWebhookConfig, SettlementWebhookEvent } from "../types";

export class SettlementContractService {
  private readonly pool: Pool;

  public constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx",
    });
  }

  public async getConfig(tenantId: string): Promise<SettlementWebhookConfig> {
    try {
      const result = await this.pool.query(
        `select tenant_id, webhook_url, enabled, updated_at from billing_settlement_webhook_config where tenant_id = $1`,
        [tenantId]
      );
      if (result.rowCount === 0) {
        return { tenant_id: tenantId, webhook_url: null, enabled: false, updated_at: new Date(0).toISOString() };
      }
      const row = result.rows[0];
      return {
        tenant_id: String(row.tenant_id),
        webhook_url: row.webhook_url == null ? null : String(row.webhook_url),
        enabled: Boolean(row.enabled),
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      };
    } catch {
      return { tenant_id: tenantId, webhook_url: null, enabled: false, updated_at: new Date(0).toISOString() };
    }
  }

  public async setConfig(tenantId: string, input: { webhook_url?: string | null; enabled?: boolean }): Promise<SettlementWebhookConfig> {
    const current = await this.getConfig(tenantId);
    const webhookUrl = input.webhook_url !== undefined ? input.webhook_url : current.webhook_url;
    const enabled = input.enabled !== undefined ? input.enabled : current.enabled;
    await this.pool.query(
      `
        insert into billing_settlement_webhook_config (tenant_id, webhook_url, enabled, updated_at)
        values ($1, $2, $3, now())
        on conflict (tenant_id) do update
        set webhook_url = excluded.webhook_url,
            enabled = excluded.enabled,
            updated_at = now()
      `,
      [tenantId, webhookUrl, enabled]
    );
    return this.getConfig(tenantId);
  }

  public async listEvents(tenantId: string, limit = 50): Promise<SettlementWebhookEvent[]> {
    try {
      const result = await this.pool.query(
        `
          select id, tenant_id, payload, status, response_status, created_at
          from billing_settlement_webhook_events
          where tenant_id = $1
          order by created_at desc
          limit $2
        `,
        [tenantId, limit]
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        payload: (row.payload ?? {}) as Record<string, unknown>,
        status: String(row.status),
        response_status: row.response_status == null ? null : Number(row.response_status),
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      }));
    } catch {
      return [];
    }
  }

  public async notifySplit(input: SettlementContractNotifyInput): Promise<{ dispatched: boolean; event_id?: string }> {
    const config = await this.getConfig(input.tenant_id);
    const payload = {
      type: "billing.split.settled",
      tenant_id: input.tenant_id,
      usage_record_id: input.usage_record_id,
      rule_id: input.rule_id,
      entries: input.entries,
      contract_stub: true,
    };

    if (!config.enabled || !config.webhook_url) {
      await this.recordEvent(input.tenant_id, payload, "skipped", null);
      return { dispatched: false };
    }

    let responseStatus: number | null = null;
    let status = "failed";
    try {
      const response = await fetch(config.webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      responseStatus = response.status;
      status = response.ok ? "delivered" : "failed";
    } catch {
      status = "failed";
    }

    const eventId = await this.recordEvent(input.tenant_id, payload, status, responseStatus);
    return { dispatched: status === "delivered", event_id: eventId };
  }

  private async recordEvent(
    tenantId: string,
    payload: Record<string, unknown>,
    status: string,
    responseStatus: number | null
  ): Promise<string> {
    const id = ulid();
    try {
      await this.pool.query(
        `
          insert into billing_settlement_webhook_events
            (id, tenant_id, payload, status, response_status, created_at)
          values ($1, $2, $3::jsonb, $4, $5, now())
        `,
        [id, tenantId, JSON.stringify(payload), status, responseStatus]
      );
    } catch {
      // best-effort audit trail
    }
    return id;
  }
}
