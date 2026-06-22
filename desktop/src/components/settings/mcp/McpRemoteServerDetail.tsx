import { useEffect, useState } from "react";
import {
  extractRemoteMcpServerConfig,
  getMcpServersMap,
  headerKeysOnly,
  mcpTransportBadgeLabel,
  parseMcpJsonDocument,
} from "../../../utils/mcp-remote-config";

type Props = {
  serverName: string;
  url?: string;
  transport?: string;
  locateServerPath: (name: string) => Promise<string>;
};

export function McpRemoteServerDetail({ serverName, url, transport, locateServerPath }: Props) {
  const [headerKeys, setHeaderKeys] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const path = await locateServerPath(serverName);
        const raw = await window.agenticxDesktop.mcpGetRaw({ path });
        if (!raw.ok || typeof raw.text !== "string") {
          throw new Error(raw.error ?? "无法读取配置");
        }
        const doc = parseMcpJsonDocument(raw.text);
        const servers = getMcpServersMap(doc);
        const entry = extractRemoteMcpServerConfig(servers[serverName]);
        if (!entry) {
          if (!cancelled) setHeaderKeys([]);
          return;
        }
        if (!cancelled) setHeaderKeys(headerKeysOnly(entry.headers));
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverName, locateServerPath]);

  return (
    <div className="border-t border-border px-3 pb-2.5 pt-2 text-[11px] text-text-faint">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-text-subtle">🌐 {url ?? "—"}</span>
        <span className="rounded border border-border bg-surface-panel px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
          {mcpTransportBadgeLabel(transport)}
        </span>
      </div>
      <div>
        Headers（仅 key）：
        {loadError ? (
          <span className="text-rose-400"> {loadError}</span>
        ) : headerKeys === null ? (
          <span className="text-text-faint"> 加载中…</span>
        ) : headerKeys.length === 0 ? (
          <span className="text-text-faint"> 无</span>
        ) : (
          <span className="text-text-subtle"> {headerKeys.join(", ")}</span>
        )}
      </div>
    </div>
  );
}
