import * as React from "react";
import { ChevronDown, ChevronRight, ListTree } from "lucide-react";
import { useAppStore, type Message } from "../../store";
import { ASSISTANT_ICON_RAIL_CLASS, REACT_RAIL_ICON_CLASS, REACT_RAIL_TITLE_CLASS } from "./im-layout";
import { Shimmer } from "../ds/Shimmer";
import { shouldPreserveToolDetails } from "./ToolActivityIndicator";

type Props = {
  /** 该过程段内工具调用总数（用于阈值判定与标题文案） */
  toolCount: number;
  /** 该 block 是否正处于流式执行中（true 时强制展开、不折叠） */
  active: boolean;
  /** 折叠阈值，默认 5（≥5 次工具调用才套折叠外壳） */
  threshold?: number;
  children: React.ReactNode;
};

function messageHasCriticalWorkState(message: Message): boolean {
  if (message.role !== "tool") return false;
  if (message.toolStatus === "error") return true;
  if (message.noticeKind) return true;
  const toolName = String(message.toolName ?? "").trim();
  if (toolName === "show_widget" || toolName === "group_progress") return true;
  return shouldPreserveToolDetails(message);
}

/**
 * Process rows arrive as rendered React elements, not raw Message arrays. Walk
 * their props conservatively so a collapsed process can never swallow an
 * error, confirmation, skill preview, widget, or background-auth link.
 */
function workTreeHasCriticalState(node: React.ReactNode): boolean {
  if (Array.isArray(node)) return node.some(workTreeHasCriticalState);
  if (!React.isValidElement(node)) return false;
  const props = node.props as {
    message?: Message;
    messages?: Message[];
    children?: React.ReactNode;
  };
  if (props.message && messageHasCriticalWorkState(props.message)) return true;
  if (Array.isArray(props.messages) && props.messages.some(messageHasCriticalWorkState)) return true;
  return workTreeHasCriticalState(props.children);
}

/**
 * 把「一整段思考 + 工具执行过程」折成一张过程卡（类 Cursor「执行了 N 步」）。
 * 仅当工具调用轮数达到阈值时才套折叠外壳；未达阈值时原样透传，保持现状。
 * 流式执行中保持展开让用户看到进度，回合结束后自动折叠。
 */
export function ReactWorkCollapse({ toolCount, active, threshold = 5, children }: Props) {
  const showToolCalls = useAppStore((state) => state.showToolCalls);
  const [collapsed, setCollapsed] = React.useState(
    () => !useAppStore.getState().showToolCalls,
  );
  const hasCriticalState = React.useMemo(
    () => workTreeHasCriticalState(children),
    [children],
  );

  React.useEffect(() => {
    if (!showToolCalls) {
      setCollapsed(true);
      return;
    }
    if (active) {
      setCollapsed(false);
      return;
    }
    setCollapsed(true);
  }, [active, showToolCalls]);

  if (toolCount <= 0 || (showToolCalls && toolCount < threshold)) {
    return <>{children}</>;
  }

  // Safety and user-decision states take precedence over visual compaction.
  // They are rare, and expanding the process is preferable to hiding them.
  if (!showToolCalls && hasCriticalState) return <>{children}</>;

  const compactMode = !showToolCalls;
  const title = compactMode
    ? active ? "正在执行任务" : `已完成 ${toolCount} 个步骤`
    : `已思考并调用 ${toolCount} 次工具`;

  return (
    <div className="bg-transparent text-text-primary">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="inline-flex w-full max-w-full items-center justify-start gap-2 px-3 py-1 text-left"
      >
        <span className={ASSISTANT_ICON_RAIL_CLASS}>
          <ListTree className={`h-[18px] w-[18px] shrink-0 ${REACT_RAIL_ICON_CLASS}`} strokeWidth={2.2} aria-hidden />
        </span>
        {compactMode && active ? (
          <Shimmer
            variant="status"
            text={title}
            className={`min-w-0 truncate ${REACT_RAIL_TITLE_CLASS}`}
          />
        ) : (
          <span className={`min-w-0 truncate ${REACT_RAIL_TITLE_CLASS}`}>{title}</span>
        )}
        <span className="shrink-0" aria-hidden>
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
          )}
        </span>
      </button>
      {!collapsed && (
        <div className="relative ml-4 mt-1 min-w-0 pb-1">
          {/* 竖向虚线：对齐到顶部 ListTree 图标正下方（header 图标中心 22px − ml-4 的 16px = 6px）。
              每行 pl-3 让子行图标左缘落到标题「已」字处；圆点用 top-1 + h-[20px] 居中，
              精确对齐子行「py-1 + 20px 图标」的图标中心（4 + 10 = 14px）。 */}
          <div
            className="pointer-events-none absolute left-[6px] top-0 bottom-1 z-0 w-0 border-l border-dashed border-border"
            aria-hidden
          />
          {React.Children.map(children, (child) => (
            <div className="relative z-[1] pl-3">
              <div
                className="pointer-events-none absolute left-[6px] top-1 z-[2] flex h-[20px] items-center"
                aria-hidden
              >
                <span className="h-2 w-2 -translate-x-1/2 rounded-full border-2 border-surface-card bg-border" />
              </div>
              {child}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
