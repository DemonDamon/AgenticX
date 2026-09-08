import type { ContextMenuItem } from "../ContextMenu";
import type { GlobalSearchItem } from "../../hooks/useGlobalSearch";
import {
  dispatchGlobalSearchAddToWorkspace,
  dispatchGlobalSearchReferenceFile,
} from "./global-search-events";
import { parentFolderPath } from "../../utils/chat-file-mention";
import { useAppStore } from "../../store";
import { i18n } from "../../i18n/i18n";

function tSearch(key: string): string {
  return i18n.t(key, { ns: "sidebar" });
}

type BuildMenuOptions = {
  item: GlobalSearchItem;
  revealLabel: string;
  hostPlatform: string;
  onToast: (message: string, variant?: "default" | "warning") => void;
  onClosePanel: () => void;
};

async function copyText(text: string, onToast: BuildMenuOptions["onToast"]): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    onToast(tSearch("search.copied"));
  } catch {
    onToast(tSearch("search.copyFailed"), "warning");
  }
}

export function buildGlobalSearchContextMenuItems(options: BuildMenuOptions): ContextMenuItem[] {
  const { item, revealLabel, hostPlatform, onToast, onClosePanel } = options;
  const isFolder = item.kind === "folder";
  const paneId = useAppStore.getState().activePaneId;

  const openItem: ContextMenuItem = {
    label: tSearch("search.open"),
    onSelect: () => {
      void window.agenticxDesktop.systemSearchOpen(item.path).then((resp) => {
        if (!resp.ok) onToast(resp.error ?? tSearch("search.openFailed"), "warning");
      });
    },
  };

  const revealItem: ContextMenuItem = {
    label: revealLabel,
    onSelect: () => {
      void window.agenticxDesktop.systemSearchReveal(item.path).then((resp) => {
        if (!resp.ok) onToast(resp.error ?? tSearch("search.revealFailed"), "warning");
      });
    },
  };

  const copyPathItem: ContextMenuItem = {
    label: tSearch("search.copyPath"),
    onSelect: () => void copyText(item.path, onToast),
  };

  const copyNameItem: ContextMenuItem = {
    label: tSearch("search.copyName"),
    onSelect: () => void copyText(item.name, onToast),
  };

  const getInfoItem: ContextMenuItem = {
    label: tSearch("search.getInfo"),
    onSelect: () => {
      void window.agenticxDesktop.systemSearchGetInfo(item.path).then((resp) => {
        if (!resp.ok) {
          onToast(resp.error ?? tSearch("search.getInfoFailed"), "warning");
          return;
        }
        if (hostPlatform !== "darwin") {
          onToast(tSearch("search.revealed"), "default");
        }
      });
    },
  };

  const openWithItem: ContextMenuItem = {
    label: tSearch("search.openWith"),
    onSelect: () => {
      void window.agenticxDesktop.systemSearchOpenWith(item.path).then((resp) => {
        if (!resp.ok) {
          onToast(resp.error ?? tSearch("search.cannotOpen"), "warning");
          return;
        }
        if (resp.hint) onToast(resp.hint, "default");
      });
    },
  };

  const addWorkspaceItem: ContextMenuItem = {
    label: isFolder ? tSearch("search.addFolderToWorkspace") : tSearch("search.addParentToWorkspace"),
    onSelect: () => {
      const folderPath = isFolder ? item.path : parentFolderPath(item.path);
      dispatchGlobalSearchAddToWorkspace(folderPath);
      onClosePanel();
    },
  };

  const refCurrentItem: ContextMenuItem = {
    label: tSearch("search.refCurrent"),
    onSelect: () => {
      if (!paneId) {
        onToast(tSearch("search.noActivePane"), "warning");
        return;
      }
      dispatchGlobalSearchReferenceFile(paneId, item.path, "current");
      onClosePanel();
    },
  };

  const refNewItem: ContextMenuItem = {
    label: tSearch("search.refNew"),
    onSelect: () => {
      if (!paneId) {
        onToast(tSearch("search.noActivePane"), "warning");
        return;
      }
      dispatchGlobalSearchReferenceFile(paneId, item.path, "new");
      onClosePanel();
    },
  };

  const marvisItems: ContextMenuItem[] = isFolder
    ? [openItem, revealItem, getInfoItem, copyPathItem, copyNameItem]
    : [openItem, revealItem, getInfoItem, copyPathItem, copyNameItem, openWithItem];

  return [
    ...marvisItems,
    { separator: true },
    addWorkspaceItem,
    refCurrentItem,
    refNewItem,
  ];
}
