import { TriangleAlert, X } from "lucide-react";
import { Button } from "../ds/Button";
import { Modal } from "../ds/Modal";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const RISKS = ["文件被误删或覆盖", "敏感数据被读取或外泄"];

export function AllowAllConfirmDialog({ open, onCancel, onConfirm }: Props) {
  return (
    <Modal
      open={open}
      backdropClassName="bg-black/55 backdrop-blur-[2px]"
      panelClassName="w-[408px] max-w-[92vw] bg-surface-panel"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-w-[68px]" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" className="min-w-[68px] font-medium" onClick={onConfirm}>
            启用
          </Button>
        </div>
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-[var(--status-warning)]">
            <TriangleAlert className="h-[15px] w-[15px]" strokeWidth={2} />
          </span>
          <h3 className="truncate text-[15px] font-semibold leading-none text-text-strong">
            启用全部允许？
          </h3>
        </div>
        <button
          type="button"
          aria-label="关闭"
          className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-text-faint transition-colors hover:bg-surface-hover hover:text-text-primary"
          onClick={onCancel}
        >
          <X className="h-[15px] w-[15px]" strokeWidth={2} />
        </button>
      </div>

      <p className="mt-3.5 text-[13px] leading-[1.7] text-text-muted">
        开启后不再逐条审批，智能体可自行读写本地文件、执行终端命令、访问网络。
      </p>

      <div className="mt-3 rounded-lg border-l-2 border-amber-500/60 bg-amber-500/[0.07] py-2 pl-3 pr-3">
        <p className="text-[12px] font-medium leading-none text-[var(--status-warning)]">
          可能带来的风险
        </p>
        <ul className="mt-1.5 space-y-1">
          {RISKS.map((risk) => (
            <li key={risk} className="flex items-start gap-1.5 text-[12.5px] leading-[1.6] text-text-muted">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-500/70" />
              {risk}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[12px] leading-[1.6] text-text-faint">
        工作区隔离仍然生效，可在安全中心单独调整；随时可切回始终询问或按需确认。
      </p>
    </Modal>
  );
}
