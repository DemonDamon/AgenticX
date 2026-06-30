import type { KBConfig, KBStats } from "../knowledge/types";
import { studioFetch } from "../../../utils/studio-fetch";

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

  const fetchJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const base = await resolveApiBase();
    const res = await studioFetch(path, {
      ...init,
      headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
      storeBase: base,
    });
    return (await res.json()) as T;
  };

  return {
    async list(): Promise<BrainRecord[]> {
      const body = await fetchJson<{ ok?: boolean; brains?: BrainRecord[]; error?: string }>("/api/brains");
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
      const body = await fetchJson<{ ok?: boolean; brain?: BrainRecord; detail?: string }>("/api/brains", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!body.ok || !body.brain) throw new Error(body.detail || "create brain failed");
      return body.brain;
    },

    async remove(brainId: string): Promise<void> {
      const body = await fetchJson<{ ok?: boolean; detail?: string }>(
        `/api/brains/${encodeURIComponent(brainId)}`,
        { method: "DELETE" },
      );
      if (!body.ok) throw new Error(body.detail || "delete brain failed");
    },

    async readKbConfig(brainId: string): Promise<{ config: KBConfig; stats: KBStats }> {
      const body = await fetchJson<{
        ok?: boolean;
        config?: KBConfig;
        stats?: KBStats;
        detail?: string;
      }>(`/api/brains/${encodeURIComponent(brainId)}/config`);
      if (!body.ok || !body.config) throw new Error(body.detail || "read config failed");
      return { config: body.config, stats: body.stats ?? ({} as KBStats) };
    },

    async writeKbConfig(
      brainId: string,
      config: KBConfig,
    ): Promise<{ config: KBConfig; rebuild_required: boolean }> {
      const body = await fetchJson<{
        ok?: boolean;
        config?: KBConfig;
        rebuild_required?: boolean;
        detail?: string;
      }>(`/api/brains/${encodeURIComponent(brainId)}/config`, {
        method: "PUT",
        body: JSON.stringify(config),
      });
      if (!body.ok || !body.config) throw new Error(body.detail || "write config failed");
      return { config: body.config, rebuild_required: Boolean(body.rebuild_required) };
    },

    async patchBrain(brainId: string, patch: Record<string, unknown>): Promise<BrainRecord> {
      const body = await fetchJson<{ ok?: boolean; brain?: BrainRecord; detail?: string }>(
        `/api/brains/${encodeURIComponent(brainId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );
      if (!body.ok || !body.brain) throw new Error(body.detail || "patch brain failed");
      return body.brain;
    },
  };
}
