import type { CodeIndexConfig, CodeIndexTaskStatus } from "./types";

type ResolveBase = () => Promise<string>;

export function createCodeIndexApi(apiToken: string, resolveApiBase: ResolveBase) {
  async function headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiToken) h["x-agx-desktop-token"] = apiToken;
    return h;
  }

  return {
    async readConfig(): Promise<CodeIndexConfig> {
      const res = await window.agenticxDesktop.loadCodeIndexConfig();
      if (!res?.ok || !res.config) {
        throw new Error(res?.error ?? "读取代码索引配置失败");
      }
      return res.config as CodeIndexConfig;
    },
    async writeConfig(config: CodeIndexConfig): Promise<void> {
      const res = await window.agenticxDesktop.saveCodeIndexConfig(config);
      if (!res?.ok) throw new Error(res?.error ?? "保存代码索引配置失败");
    },
    async preloadModel(): Promise<void> {
      const base = await resolveApiBase();
      const h = await headers();
      const res = await fetch(`${base}/api/code-index/preload`, { method: "POST", headers: h });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "预热失败");
    },
    async listTasks(): Promise<CodeIndexTaskStatus[]> {
      const base = await resolveApiBase();
      const h = await headers();
      const res = await fetch(`${base}/api/code-index/status`, { headers: h });
      const body = (await res.json()) as { ok?: boolean; tasks?: CodeIndexTaskStatus[]; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "读取索引状态失败");
      return body.tasks ?? [];
    },
    async clearIndex(codebasePath: string): Promise<void> {
      const base = await resolveApiBase();
      const h = await headers();
      const res = await fetch(`${base}/api/code-index/clear`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ codebase_path: codebasePath }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "清除索引失败");
    },
  };
}
