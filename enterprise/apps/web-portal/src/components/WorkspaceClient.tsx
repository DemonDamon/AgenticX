"use client";

import * as React from "react";
import { DEFAULT_BRAND_CONFIG, DEFAULT_FEATURE_FLAGS } from "@agenticx/config";
import { ChatWorkspace } from "@agenticx/feature-chat";
import { HttpChatClient, MockChatClient } from "@agenticx/sdk-ts";

type WorkspaceClientProps = {
  userEmail: string;
};

export function WorkspaceClient({ userEmail }: WorkspaceClientProps) {
  const client = React.useMemo(() => {
    const mode = process.env.NEXT_PUBLIC_CHAT_CLIENT_MODE;
    if (mode === "mock") {
      return new MockChatClient();
    }
    return new HttpChatClient({ endpoint: "/api/chat/completions" });
  }, []);

  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-6">
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        当前登录用户：{userEmail}
      </div>
      <ChatWorkspace brand={DEFAULT_BRAND_CONFIG} features={DEFAULT_FEATURE_FLAGS} client={client} />
    </main>
  );
}

