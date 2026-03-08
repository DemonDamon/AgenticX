export {};

declare global {
  interface Window {
    agenticxDesktop: {
      version: string;
      getApiBase: () => Promise<string>;
      getApiAuthToken: () => Promise<string>;
      platform: () => Promise<string>;
      onOpenSettings: (cb: () => void) => void;
      saveConfig: (payload: { provider?: string; model?: string; apiKey?: string }) => Promise<{ ok: boolean; path: string }>;
      nativeSay: (text: string) => Promise<{ ok: boolean; reason?: string }>;
    };
  }
}
