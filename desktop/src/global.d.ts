export {};

type ProviderConfig = {
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: string[];
};

type LoadConfigResult = {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  userMode?: "pro" | "lite";
  onboardingCompleted?: boolean;
  confirmStrategy?: "manual" | "semi-auto" | "auto";
};

type ValidateKeyResult = { ok: boolean; error?: string; status?: number };
type FetchModelsResult = { ok: boolean; models: string[]; error?: string };
type HealthCheckResult = { ok: boolean; error?: string; latencyHint?: string };
type McpServerItem = { name: string; connected: boolean; command?: string };
type McpStatusResult = {
  ok: boolean;
  count?: number;
  connected_count?: number;
  servers: McpServerItem[];
  error?: string;
};

declare global {
  interface Window {
    agenticxDesktop: {
      version: string;
      getApiBase: () => Promise<string>;
      getApiAuthToken: () => Promise<string>;
      platform: () => Promise<string>;
      onOpenSettings: (cb: () => void) => void;

      loadConfig: () => Promise<LoadConfigResult>;
      loadMcpStatus: (sessionId: string) => Promise<McpStatusResult>;
      importMcpConfig: (payload: { sessionId: string; sourcePath: string }) => Promise<{
        ok: boolean;
        imported?: string[];
        skipped?: string[];
        total_imported?: number;
        total_servers?: number;
        error?: string;
      }>;
      connectMcp: (payload: { sessionId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
      saveUserMode: (mode: "pro" | "lite") => Promise<{ ok: boolean }>;
      saveOnboardingCompleted: (completed: boolean) => Promise<{ ok: boolean }>;
      saveConfirmStrategy: (strategy: "manual" | "semi-auto" | "auto") => Promise<{ ok: boolean }>;
      saveProvider: (payload: {
        name: string;
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        models?: string[];
      }) => Promise<{ ok: boolean }>;
      setDefaultProvider: (name: string) => Promise<{ ok: boolean }>;
      deleteProvider: (name: string) => Promise<{ ok: boolean }>;
      validateKey: (payload: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
      }) => Promise<ValidateKeyResult>;
      fetchModels: (payload: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
      }) => Promise<FetchModelsResult>;
      healthCheckModel: (payload: {
        provider: string;
        apiKey: string;
        baseUrl?: string;
        model: string;
      }) => Promise<HealthCheckResult>;

      saveConfig: (payload: {
        provider?: string;
        model?: string;
        apiKey?: string;
      }) => Promise<{ ok: boolean; path: string }>;
      nativeSay: (text: string) => Promise<{ ok: boolean; reason?: string }>;
    };
  }
}
