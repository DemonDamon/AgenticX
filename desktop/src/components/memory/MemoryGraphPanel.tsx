import { memo } from "react";
import type { ChatPane } from "../../store";
import { useAppStore } from "../../store";
import { MemoryGraphExplorer } from "./MemoryGraphExplorer";

type Props = {
  pane: ChatPane;
  onClose?: () => void;
  tintColor?: string;
};

function MemoryGraphPanelInner({ pane, onClose }: Props) {
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);

  // 按当前窗格天然归属选择默认分区：群聊→群聊，分身→分身，否则元智能体
  const aid = (pane.avatarId || "").trim();
  const initialScope = aid.startsWith("group:") ? "group" : aid ? "avatar" : "meta";

  return (
    <MemoryGraphExplorer
      apiBase={apiBase}
      apiToken={apiToken}
      avatarId={pane.avatarId}
      sessionId={pane.sessionId}
      layout="sidebar"
      initialScope={initialScope}
      onClose={onClose}
    />
  );
}

export const MemoryGraphPanel = memo(MemoryGraphPanelInner);
