import * as React from "react";
import { buildBrandThemeVars, Card, CardContent, CardHeader, CardTitle } from "@agenticx/ui";
import { useChatStore } from "./store";
import type { ChatWorkspaceProps } from "./types";
import { MessageList } from "./components/molecules/MessageList";
import { InputArea } from "./components/molecules/InputArea";
import { ModelSelector } from "./components/molecules/ModelSelector";

const DEFAULT_MODELS = ["mock-model-v1", "deepseek-r1", "gpt-5.3", "qwen-max"];

export function ChatWorkspace({ brand, features, rulePacks = [], client, slots }: ChatWorkspaceProps) {
  const {
    sessions,
    activeSessionId,
    messages,
    status,
    activeModel,
    errorMessage,
    bootstrap,
    switchModel,
    sendMessage,
    cancel,
  } = useChatStore();

  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (!activeSessionId) {
      bootstrap({ defaultModel: DEFAULT_MODELS[0] });
    }
  }, [activeSessionId, bootstrap]);

  const modelOptions = React.useMemo(() => {
    const enabledWebSearch = features["chat.web_search"] ?? true;
    if (!enabledWebSearch) {
      return DEFAULT_MODELS.filter((model) => model !== "qwen-max");
    }
    return DEFAULT_MODELS;
  }, [features]);

  const brandVars = React.useMemo(() => buildBrandThemeVars(brand.brand), [brand.brand]);

  return (
    <div
      style={brandVars}
      className="flex min-h-[560px] w-full rounded-xl border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <aside className="w-64 shrink-0 border-r border-zinc-200 p-4 dark:border-zinc-800">
        {slots?.sidebar ?? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Sessions</h3>
            {sessions.map((session) => (
              <Card key={session.id} className={session.id === activeSessionId ? "border-[var(--ui-color-primary)]" : ""}>
                <CardHeader className="p-3">
                  <CardTitle className="text-sm">{session.title}</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {session.message_count} messages
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {slots?.header ?? (
          <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{brand.brand.short_name} Workspace</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{brand.brand.slogan}</p>
              </div>
              <ModelSelector value={activeModel} options={modelOptions} onChange={switchModel} />
            </div>
          </header>
        )}

        <div className="flex-1 px-4 py-3">
          <MessageList messages={messages} />
        </div>

        <footer className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <InputArea
            value={draft}
            status={status}
            onChange={setDraft}
            onSend={() => {
              void sendMessage(client, { content: draft });
              setDraft("");
            }}
            onCancel={() => void cancel(client)}
          />
          {errorMessage && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
          {slots?.footer}
        </footer>
      </main>

      <aside className="w-72 shrink-0 border-l border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">Tools & Rules</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          policy_engine: {features["gateway.policy_engine"] ? "enabled" : "disabled"}
        </p>
        <div className="mt-3 space-y-2">
          {rulePacks.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">No rule packs loaded.</p>}
          {rulePacks.map((pack) => (
            <Card key={pack.id}>
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm">{pack.name}</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 text-xs text-zinc-500 dark:text-zinc-400">
                {pack.description ?? "No description"}
              </CardContent>
            </Card>
          ))}
        </div>
      </aside>
    </div>
  );
}

