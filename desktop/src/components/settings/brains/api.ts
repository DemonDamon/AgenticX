import type { KBConfig, KBStats } from "../knowledge/types";

export type BrainRecord = {
  id: string;
  name: string;
  type: "docs" | "code";
  scope: "global" | "private";
  storage_root: string;
  enabled: boolean;
  description: string;
  owner_avatar_id?: string | null;
  config: Record<string, unknown>;
  stats?: KBStats & { chunk_count?: number };
  created_at?: string;
  updated_at?: string;
};

export type ResolveBase = () => Promise<string>;

export function createBrainsApi(apiToken: string, resolveApiBase: ResolveBase) {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiToken) h["X-Agx-Desktop-Token"] = apiToken;
    return h;
  };

  return {
    async list(): Promise<BrainRecord[]> {
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/brains`, { headers: headers() });
      const body = (await res.json()) as { ok?: boolean; brains?: BrainRecord[]; error?: string };
      if (!body.ok) throw new Error(body.error || "list brains failed");
      return body.brains ?? [];
    },

    async create(payload: {
      name: string;
      type: "docs" | "code";
      scope: "global" | "private";
      owner_avatar_id?: string;
      config?: Record<string, unknown>;
    }): Promise<BrainRecord> {
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/brains`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { ok?: boolean; brain?: BrainRecord; detail?: string };
      if (!body.ok || !body.brain) throw new Error(body.detail || "create brain failed");
      return body.brain;
    },

    async remove(brainId: string): Promise<void> {
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brainId)}`, {
        method: "DELETE",
        headers: headers(),
      });
      const body = (await res.json()) as { ok?: boolean; detail?: string };
      if (!body.ok) throw new Error(body.detail || "delete brain failed");
    },

    async readKbConfig(brainId: string): Promise<{ config: KBConfig; stats: KBStats }> {
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brainId)}/config`, {
        headers: headers(),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        config?: KBConfig;
        stats?: KBStats;
        detail?: string;
      };
      if (!body.ok || !body.config) throw new Error(body.detail || "read config failed");
      return { config: body.config, stats: body.stats ?? ({} as KBStats) };
    },

    async writeKbConfig(
      brainId: string,
      config: KBConfig,
    ): Promise<{ config: KBConfig; rebuild_required: boolean }> {
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brainId)}/config`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(config),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        config?: KBConfig;
        rebuild_required?: boolean;
        detail?: string;
      };
      if (!body.ok || !body.config) throw new Error(body.detail || "write config failed");
      return { config: body.config, rebuild_required: Boolean(body.rebuild_required) };
    },

    async patchBrain(brainId: string, patch: Record<string, unknown>): Promise<BrainRecord> {
      const base = await resolveApiBase();
      const res = await fetch(`${base}/api/brains/${encodeURIComponent(brainId)}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(patch),
      });
      const body = (await res.json()) as { ok?: boolean; brain?: BrainRecord; detail?: string };
      if (!body.ok || !body.brain) throw new Error(body.detail || "patch brain failed");
      return body.brain;
    },
  };
}
