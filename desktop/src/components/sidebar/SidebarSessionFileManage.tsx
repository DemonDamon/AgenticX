import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import {
  dispatchWorkspacePickDir,
  dispatchWorkspacePickFile,
} from "../../utils/workspace-sidebar-events";
import { WorkspacePanel } from "../WorkspacePanel";

type Props = {
  paneId: string;
  sessionId: string;
  onBack: () => void;
};

/**
 * Trae-style in-sidebar file management for a history session.
 * Reuses Near WorkspacePanel (folder roots, tree, terminal) with a back affordance.
 */
export function SidebarSessionFileManage({ paneId, sessionId, onBack }: Props) {
  const { t } = useTranslation("sidebar");
  const activeTaskspaceId = useAppStore(
    (s) => s.panes.find((p) => p.id === paneId)?.activeTaskspaceId ?? null
  );
  const setActiveTaskspace = useAppStore((s) => s.setActiveTaskspace);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-sidebar">
      <WorkspacePanel
        paneId={paneId}
        sessionId={sessionId}
        activeTaskspaceId={activeTaskspaceId}
        onActiveTaskspaceChange={(taskspaceId) => setActiveTaskspace(paneId, taskspaceId)}
        backAction={{ label: t("history.backToHistory"), onClick: onBack }}
        onPickFileForReference={(taskspaceId, path) => {
          dispatchWorkspacePickFile({ paneId, taskspaceId, path });
        }}
        onPickDirectoryForReference={({ taskspaceId, relPath, label }) => {
          dispatchWorkspacePickDir({ paneId, taskspaceId, relPath, label });
        }}
      />
    </div>
  );
}
