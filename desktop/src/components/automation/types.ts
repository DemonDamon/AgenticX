export type AutomationFrequency =
  | { type: "daily"; time: string; days: number[] }
  | { type: "interval"; hours: number; days: number[] }
  | { type: "once"; time: string; date: string };

export interface AutomationTask {
  id: string;
  name: string;
  prompt: string;
  workspace?: string;
  /** 执行 /api/chat 时使用的专属会话；由侧栏「定时」打开该任务窗格时创建并回写，勿与 Machi/飞书主会话混用 */
  sessionId?: string;
  frequency: AutomationFrequency;
  effectiveDateRange?: { start?: string; end?: string };
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error";
  /** 最近一次失败时的核心报错（短文本，由主进程截断后写入） */
  lastRunError?: string;
  fromTemplate?: string;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  defaultPrompt: string;
  defaultFrequency: AutomationFrequency;
}
