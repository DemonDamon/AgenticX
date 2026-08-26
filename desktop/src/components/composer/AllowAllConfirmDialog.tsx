import { TriangleAlert, X } from "lucide-react";
import { Button } from "../ds/Button";
import { Modal } from "../ds/Modal";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AllowAllConfirmDialog({ open, onCancel, onConfirm }: Props) {
  return (
    <Modal
      open={open}
      backdropClassName="bg-black/70"
      panelClassName="w-[440px] max-w-[92vw] bg-surface-panel"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" className="min-w-[76px] font-medium" onClick={onConfirm}>
            启用
          </Button>
        </div>
      )}
    >
      <div className="relative">
        <button
          type="button"
          aria-label="关闭"
          className="absolute -right-1 -top-1 rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-primary"
          onClick={onCancel}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
            <TriangleAlert className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold leading-snug text-text-strong">
              启用全部允许？
            </h3>
            <p className="mt-2 text-[13px] leading-6 text-text-primary">
              开启后不再逐条审批，智能体可自行读写本地文件、执行终端命令、访问网络。
            </p>
            <p className="mt-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-[13px] leading-6 text-[var(--status-warning)]">
              可能带来的风险：文件被误删或覆盖；敏感数据被读取或外泄。
            </p>
            <p className="mt-2 text-[12px] leading-5 text-text-subtle">
              工作区隔离仍然生效，可在安全中心单独调整。可随时切回始终询问或按需确认。
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
