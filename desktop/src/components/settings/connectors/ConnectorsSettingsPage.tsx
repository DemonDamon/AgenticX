/**
 * 设置「连接器」页：嵌入与市场「连接器」Tab 同一套 ConnectorsHub + useConnectorsController，
 * 仅负责读取本机 MCP 名册（状态 + mcp.json 元数据）与「进入对话」时关闭设置。
 */

import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../../../store";
import { usePaneNavigation } from "../../../hooks/usePaneNavigation";
import { parseMcpJsonDocument } from "../../../utils/mcp-remote-config";
import { i18n } from "../../../i18n/i18n";
import { ConnectorsHub } from "./ConnectorsHub";
import {
  configuredMcpEntriesFromDocument,
  configuredMcpEntriesFromStatus,
  mergeConfiguredMcpEntries,
  type ConfiguredMcpEntry,
} from "./my-connections-model";
import { useConnectorsController } from "./useConnectorsController";

type Props = {
  sessionId: string;
  onRefreshMcp: (sessionId?: string) => Promise<void>;
};

export function ConnectorsSettingsPage({ sessionId, onRefreshMcp }: Props) {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const { newMetaTask } = usePaneNavigation();
  const [names, setNames] = useState<string[]>([]);
  const [entries, setEntries] = useState<ConfiguredMcpEntry[]>([]);

  const reloadNames = useCallback(async () => {
    let statusEntries: ConfiguredMcpEntry[] = [];
    let statusNames: string[] = [];
    const res = await window.agenticxDesktop.loadMcpStatus(sessionId || "").catch(() => null);
    if (res?.ok && Array.isArray(res.servers)) {
      statusNames = res.servers.map((s) => s.name).filter(Boolean);
      statusEntries = configuredMcpEntriesFromStatus(res.servers);
    }
    let docEntries: ConfiguredMcpEntry[] = [];
    const raw = await window.agenticxDesktop.mcpGetRaw({}).catch(() => null);
    if (raw?.ok && raw.text) {
      try {
        docEntries = configuredMcpEntriesFromDocument(parseMcpJsonDocument(raw.text));
      } catch {
        /* ignore parse */
      }
    }
    const merged = mergeConfiguredMcpEntries(statusEntries, docEntries);
    setNames(Array.from(new Set([...statusNames, ...merged.map((e) => e.name)])));
    setEntries(merged.length > 0 ? merged : statusEntries);
  }, [sessionId]);

  useEffect(() => {
    void reloadNames();
  }, [reloadNames]);

  const reloadMcp = useCallback(async () => {
    await onRefreshMcp(sessionId).catch(() => undefined);
    await reloadNames();
  }, [onRefreshMcp, reloadNames, sessionId]);

  const startChat = useCallback(
    (draft: string) => {
      closeSettings();
      newMetaTask(draft);
    },
    [closeSettings, newMetaTask],
  );

  const ctl = useConnectorsController({
    sessionId,
    configuredMcpNames: names,
    configuredMcpEntries: entries,
    reloadMcp,
    startChat,
  });

  return (
    <div className="space-y-3 p-4" data-connectors-settings-page>
      <p className="max-w-xl text-xs text-text-muted">
        {String(i18n.t("connectors.intro", { ns: "settings" }))}
      </p>
      <ConnectorsHub ctl={ctl} />
      {ctl.modals}
    </div>
  );
}
