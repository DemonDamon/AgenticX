export type AutomationFrequency =
  | { type: "daily"; time: string; days: number[] }
  | { type: "interval"; hours: number; days: number[] }
  | { type: "once"; time: string; date: string };

export interface AutomationTask {
  id: string;
  name: string;
  prompt: string;
  workspace?: string;
  frequency: AutomationFrequency;
  effectiveDateRange?: { start?: string; end?: string };
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error";
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
