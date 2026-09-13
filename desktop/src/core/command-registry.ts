import { type RunMode } from "../constants/confirm-strategy-options";
import { i18n } from "../i18n/i18n";

function tCmd(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: "sidebar", ...options });
}

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
      const desc = tCmd(cmd.description).toLowerCase();
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
  cycleRunMode: () => Promise<RunMode>;
  addAssistantMessage: (content: string) => void;
};

export function createPhase1Registry(ctx: Phase1CommandContext): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register({
    id: "model",
    name: "/model",
    description: "commands.model.description",
    category: "model",
    shortcut: "Alt+M",
    mode: "pro",
    icon: "M",
    handler: () => ctx.openModelPicker(),
  });
  registry.register({
    id: "settings",
    name: "/settings",
    description: "commands.settings.description",
    category: "settings",
    shortcut: "Ctrl+,",
    mode: "both",
    icon: "S",
    handler: () => ctx.openSettings(),
  });
  registry.register({
    id: "clear",
    name: "/clear",
    description: "commands.clear.description",
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
    description: "commands.help.description",
    category: "help",
    shortcut: "F1",
    mode: "both",
    icon: "?",
    handler: () => ctx.addAssistantMessage(tCmd("commands.helpBody")),
  });
  registry.register({
    id: "plan",
    name: "/plan",
    description: "commands.plan.description",
    category: "view",
    shortcut: "Ctrl+Shift+P",
    mode: "pro",
    icon: "P",
    handler: () => {
      const next = ctx.togglePlanMode();
      ctx.addAssistantMessage(next ? tCmd("commands.planOn") : tCmd("commands.planOff"));
    },
  });
  registry.register({
    id: "confirm",
    name: "/confirm",
    description: "commands.confirm.description",
    category: "settings",
    mode: "both",
    icon: "A",
    handler: async () => {
      const mode = await ctx.cycleRunMode();
      ctx.addAssistantMessage(tCmd("commands.runModeSwitched", { mode: tCmd(`commands.runMode.${mode}`) }));
    },
  });
  registry.register({
    id: "keybindings",
    name: "/keybindings",
    description: "commands.keybindings.description",
    category: "help",
    shortcut: "Ctrl+/",
    mode: "both",
    icon: "K",
    handler: () => ctx.openKeybindings(),
  });
  return registry;
}
