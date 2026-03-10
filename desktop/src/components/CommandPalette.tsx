import { useEffect, useMemo, useState } from "react";
import type { Command } from "../core/command-registry";

type Props = {
  open: boolean;
  query: string;
  commands: Command[];
  onQueryChange: (q: string) => void;
  onExecute: (id: string) => void;
  onClose: () => void;
};

export function CommandPalette({ open, query, commands, onQueryChange, onExecute, onClose }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query, open]);

  const selected = useMemo(() => commands[selectedIdx], [commands, selectedIdx]);
  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-full z-50 mb-2">
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-slate-900 shadow-2xl">
        <div className="border-b border-border px-3 py-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((idx) => Math.min(idx + 1, Math.max(commands.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((idx) => Math.max(idx - 1, 0));
              } else if (e.key === "Enter" && selected) {
                e.preventDefault();
                onExecute(selected.id);
              }
            }}
            className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
            placeholder="输入命令，例如 model / settings / clear"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {commands.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">没有匹配的命令</div>
          ) : (
            commands.map((cmd, idx) => (
              <button
                key={cmd.id}
                onClick={() => onExecute(cmd.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  idx === selectedIdx ? "bg-cyan-500/15 text-cyan-200" : "text-slate-300 hover:bg-slate-800/80"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-700 text-[11px] text-slate-300">
                    {cmd.icon ?? "·"}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{cmd.name}</div>
                    <div className="truncate text-xs text-slate-500">{cmd.description}</div>
                  </div>
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{cmd.category}</div>
                  <div className="text-[11px] text-slate-500">{cmd.shortcut ?? ""}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
