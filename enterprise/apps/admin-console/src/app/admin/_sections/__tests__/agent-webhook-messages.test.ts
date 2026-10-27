import { describe, expect, it } from "vitest";
import { MA_WEBHOOK_EVENT_GROUPS, MA_WEBHOOK_EVENT_TYPES } from "@agenticx/core-api";

import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENT_TYPES } from "../agent-webhooks";

const ZH_EVENT_LABELS: Record<(typeof MA_WEBHOOK_EVENT_TYPES)[number], string> = {
  "session.status_run_started": "智能体开始执行",
  "session.status_idled": "智能体停下（含等待审批）",
  "session.idle": "回合正常结束",
  "session.failed": "回合异常结束",
  "session.thread_created": "子线程已创建",
  "session.thread_idled": "子线程停下",
  "session.thread_terminated": "子线程已终止",
  "agent.created": "已创建",
  "agent.version_published": "发布新版本",
  "agent.deleted": "已删除",
  "environment.created": "已创建",
  "environment.updated": "已更新",
  "environment.deleted": "已删除",
  "vault.created": "凭证库已创建",
  "vault.archived": "凭证库已归档",
  "vault.deleted": "凭证库已删除",
  "vault_credential.created": "凭证已创建",
  "vault_credential.archived": "凭证已归档",
  "vault_credential.deleted": "凭证已删除",
  "credential.expiring": "凭证即将过期",
  "memory_store.created": "已创建",
  "memory_store.archived": "已归档",
  "memory_store.deleted": "已删除",
  "schedule.created": "已创建",
  "schedule.updated": "已更新（含启停）",
  "schedule.deleted": "已删除",
  "schedule_run.started": "已开始",
  "schedule_run.succeeded": "已成功",
  "schedule_run.failed": "已失败",
};

const ZH_GROUPS: Record<(typeof MA_WEBHOOK_EVENT_GROUPS)[number]["key"], string> = {
  session: "会话",
  thread: "多智能体线程",
  agent: "智能体",
  environment: "执行环境",
  vault: "凭证库",
  memory_store: "记忆库",
  schedule: "定时任务",
  schedule_run: "定时运行",
};

function stringRecord(value: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function eventKey(type: string): string {
  return type.replaceAll(".", "_");
}

describe("agent webhook event catalog messages", () => {
  it("has a label for every event type and group in zh and en", () => {
    expect(MA_WEBHOOK_EVENT_TYPES).toHaveLength(29);
    expect(MA_WEBHOOK_EVENT_GROUPS).toHaveLength(8);
    expect(WEBHOOK_EVENT_GROUPS).toEqual(MA_WEBHOOK_EVENT_GROUPS);
    expect(WEBHOOK_EVENT_TYPES).toEqual(MA_WEBHOOK_EVENT_TYPES);

    const zhEvents = stringRecord(zh.pages.admin.agentWebhooks.events);
    const enEvents = stringRecord(en.pages.admin.agentWebhooks.events);
    const zhGroups = stringRecord(zh.pages.admin.agentWebhooks.eventGroups);
    const enGroups = stringRecord(en.pages.admin.agentWebhooks.eventGroups);

    expect(Object.keys(zhEvents).sort()).toEqual(MA_WEBHOOK_EVENT_TYPES.map(eventKey).sort());
    expect(Object.keys(enEvents).sort()).toEqual(Object.keys(zhEvents).sort());
    expect(Object.keys(zhGroups).sort()).toEqual(MA_WEBHOOK_EVENT_GROUPS.map((group) => group.key).sort());
    expect(Object.keys(enGroups).sort()).toEqual(Object.keys(zhGroups).sort());

    for (const type of MA_WEBHOOK_EVENT_TYPES) {
      const key = eventKey(type);
      expect(zhEvents[key]).toBe(ZH_EVENT_LABELS[type]);
      expect(enEvents[key]?.trim().length).toBeGreaterThan(0);
    }
    for (const group of MA_WEBHOOK_EVENT_GROUPS) {
      expect(zhGroups[group.key]).toBe(ZH_GROUPS[group.key]);
      expect(enGroups[group.key]?.trim().length).toBeGreaterThan(0);
    }

    expect(zh.pages.admin.agentWebhooks.eventsRequired).toBe("至少选择一种事件");
    expect(zh.pages.admin.agentWebhooks.selectedCount.replaceAll("{selected}", "3").replaceAll("{total}", "29")).toBe(
      "已选择 3 / 29 个事件类型",
    );
    expect(zh.pages.admin.agentWebhooks.disabledReason.consecutive_failures).toBe("已自动停用：连续投递失败");
    expect(zh.pages.admin.agentWebhooks.disabledReason.gone).toBe("已自动停用：接收方返回 410");
    expect(en.pages.admin.agentWebhooks.disabledReason.consecutive_failures.trim().length).toBeGreaterThan(0);
    expect(en.pages.admin.agentWebhooks.disabledReason.gone.trim().length).toBeGreaterThan(0);
    expect(en.pages.admin.agentWebhooks.events.session_status_run_started).toBe("Run started");
    expect(en.pages.admin.agentWebhooks.events.session_status_idled).toBe("Stopped (incl. awaiting approval)");
    expect(en.pages.admin.agentWebhooks.events.agent_version_published).toBe("Version published");
  });
});
