import * as React from "react";
import { getChatCopy, type ChatCopy, type PortalLocale } from "./chat-copy";

const ChatLocaleContext = React.createContext<PortalLocale>("zh");

export function ChatLocaleProvider({
  locale,
  children,
}: {
  locale: PortalLocale;
  children: React.ReactNode;
}) {
  const value: PortalLocale = locale === "en" ? "en" : "zh";
  return <ChatLocaleContext.Provider value={value}>{children}</ChatLocaleContext.Provider>;
}

export function useChatLocale(): PortalLocale {
  return React.useContext(ChatLocaleContext);
}

export function useChatCopy(): ChatCopy {
  return getChatCopy(useChatLocale());
}
