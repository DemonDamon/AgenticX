export type CommandCategory = "model" | "session" | "tools" | "view" | "settings" | "help";
export type UserMode = "pro" | "lite";

export interface Command {
  id: string;
  name: string;
  description: string;
  category: CommandCategory;
  shortcut?: string;
  mode: UserMode | "both";
  handler: (args?: string) => void | Promise<void>;
  icon?: string;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(cmd: Command): void {
    this.commands.set(cmd.id, cmd);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  async dispatch(id: string, args?: string): Promise<void> {
    const cmd = this.commands.get(id);
    if (!cmd) return;
    await cmd.handler(args);
  }

  getAll(mode: UserMode): Command[] {
    return [...this.commands.values()].filter((cmd) => cmd.mode === "both" || cmd.mode === mode);
  }

  search(query: string, mode: UserMode): Command[] {
    const q = query.trim().toLowerCase();
    const candidates = this.getAll(mode);
    if (!q) return candidates;

    const score = (cmd: Command): number => {
      const name = cmd.name.toLowerCase();
      const id = cmd.id.toLowerCase();
      const desc = cmd.description.toLowerCase();
      if (name === q || id === q) return 0;
      if (name.startsWith(q) || id.startsWith(q)) return 1;
      if (name.includes(q) || id.includes(q)) return 2;
      if (desc.includes(q)) return 3;
      return 999;
    };

    return candidates
      .map((cmd) => ({ cmd, score: score(cmd) }))
      .filter((item) => item.score < 999)
      .sort((a, b) => a.score - b.score || a.cmd.name.localeCompare(b.cmd.name))
      .map((item) => item.cmd);
  }
}

export type Phase1CommandContext = {
  openSettings: () => void;
  openModelPicker: () => void;
  openKeybindings: () => void;
  clearMessages: () => void;
  togglePlanMode: () => boolean;
  toggleUserMode: () => Promise<void>;
  cycleConfirmStrategy: () => Promise<"manual" | "semi-auto" | "auto">;
  addAssistantMessage: (content: string) => void;
};

function confirmStrategyLabel(strategy: "manual" | "semi-auto" | "auto"): string {
  if (strategy === "manual") return "每次询问";
  if (strategy === "semi-auto") return "白名单放行";
  return "全部自动执行";
}

export function createPhase1Registry(ctx: Phase1CommandContext): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register({
    id: "model",
    name: "/model",
    description: "切换当前模型",
    category: "model",
    shortcut: "Alt+M",
    mode: "pro",
    icon: "M",
    handler: () => ctx.openModelPicker(),
  });
  registry.register({
    id: "settings",
    name: "/settings",
    description: "打开设置面板",
    category: "settings",
    shortcut: "Ctrl+,",
    mode: "both",
    icon: "S",
    handler: () => ctx.openSettings(),
  });
  registry.register({
    id: "clear",
    name: "/clear",
    description: "清空当前对话消息",
    category: "session",
    shortcut: "Ctrl+L",
    mode: "both",
    icon: "C",
    handler: () => ctx.clearMessages(),
  });
  // Lite 模式已废弃，/mode 命令不再注册。`toggleUserMode` 保留在 ctx 上以兼容旧引用。
  registry.register({
    id: "help",
    name: "/help",
    description: "显示可用命令说明",
    category: "help",
    shortcut: "F1",
    mode: "both",
    icon: "?",
    handler: () =>
      ctx.addAssistantMessage(
        [
          "可用命令：",
          "- /model：切换模型（Pro）",
          "- /settings：打开设置",
          "- /clear：清空对话",
          "- /plan：切换计划模式（Pro）",
          "- /confirm：切换确认策略",
          "- /keybindings：查看快捷键",
          "- /help：查看帮助",
        ].join("\n")
      ),
  });
  registry.register({
    id: "plan",
    name: "/plan",
    description: "切换计划模式（只规划，不执行）",
    category: "view",
    shortcut: "Ctrl+Shift+P",
    mode: "pro",
    icon: "P",
    handler: () => {
      const next = ctx.togglePlanMode();
      ctx.addAssistantMessage(next ? "计划模式已开启：将只输出计划，不执行工具。" : "计划模式已关闭：恢复正常执行。");
    },
  });
  registry.register({
    id: "confirm",
    name: "/confirm",
    description: "循环切换确认策略（每次询问 / 白名单放行 / 全部自动执行）",
    category: "settings",
    mode: "both",
    icon: "A",
    handler: async () => {
      const strategy = await ctx.cycleConfirmStrategy();
      ctx.addAssistantMessage(`已切换确认策略为: ${confirmStrategyLabel(strategy)}`);
    },
  });
  registry.register({
    id: "keybindings",
    name: "/keybindings",
    description: "查看当前快捷键列表",
    category: "help",
    shortcut: "Ctrl+/",
    mode: "both",
    icon: "K",
    handler: () => ctx.openKeybindings(),
  });
  return registry;
}
