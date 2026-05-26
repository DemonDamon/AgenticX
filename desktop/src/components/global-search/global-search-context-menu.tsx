import type { ContextMenuItem } from "../ContextMenu";
import type { GlobalSearchItem } from "../../hooks/useGlobalSearch";
import {
  dispatchGlobalSearchAddToWorkspace,
  dispatchGlobalSearchReferenceFile,
} from "./global-search-events";
import { parentFolderPath } from "../../utils/chat-file-mention";
import { useAppStore } from "../../store";

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
    onToast("已复制");
  } catch {
    onToast("复制失败", "warning");
  }
}

export function buildGlobalSearchContextMenuItems(options: BuildMenuOptions): ContextMenuItem[] {
  const { item, revealLabel, hostPlatform, onToast, onClosePanel } = options;
  const isFolder = item.kind === "folder";
  const paneId = useAppStore.getState().activePaneId;

  const openItem: ContextMenuItem = {
    label: "打开",
    onSelect: () => {
      void window.agenticxDesktop.systemSearchOpen(item.path).then((resp) => {
        if (!resp.ok) onToast(resp.error ?? "打开失败", "warning");
      });
    },
  };

  const revealItem: ContextMenuItem = {
    label: revealLabel,
    onSelect: () => {
      void window.agenticxDesktop.systemSearchReveal(item.path).then((resp) => {
        if (!resp.ok) onToast(resp.error ?? "无法在文件管理器中显示", "warning");
      });
    },
  };

  const copyPathItem: ContextMenuItem = {
    label: "复制路径",
    onSelect: () => void copyText(item.path, onToast),
  };

  const copyNameItem: ContextMenuItem = {
    label: "复制名称",
    onSelect: () => void copyText(item.name, onToast),
  };

  const getInfoItem: ContextMenuItem = {
    label: "显示简介",
    onSelect: () => {
      void window.agenticxDesktop.systemSearchGetInfo(item.path).then((resp) => {
        if (!resp.ok) {
          onToast(resp.error ?? "无法显示简介", "warning");
          return;
        }
        if (hostPlatform !== "darwin") {
          onToast("已在文件管理器中定位", "default");
        }
      });
    },
  };

  const openWithItem: ContextMenuItem = {
    label: "用其他应用打开",
    onSelect: () => {
      void window.agenticxDesktop.systemSearchOpenWith(item.path).then((resp) => {
        if (!resp.ok) {
          onToast(resp.error ?? "无法打开", "warning");
          return;
        }
        if (resp.hint) onToast(resp.hint, "default");
      });
    },
  };

  const addWorkspaceItem: ContextMenuItem = {
    label: isFolder ? "添加至工作区" : "添加文件所在文件夹至工作区",
    onSelect: () => {
      const folderPath = isFolder ? item.path : parentFolderPath(item.path);
      dispatchGlobalSearchAddToWorkspace(folderPath);
      onClosePanel();
    },
  };

  const refCurrentItem: ContextMenuItem = {
    label: "引用至当前对话",
    onSelect: () => {
      if (!paneId) {
        onToast("无激活窗格", "warning");
        return;
      }
      dispatchGlobalSearchReferenceFile(paneId, item.path, "current");
      onClosePanel();
    },
  };

  const refNewItem: ContextMenuItem = {
    label: "引用至新对话",
    onSelect: () => {
      if (!paneId) {
        onToast("无激活窗格", "warning");
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
