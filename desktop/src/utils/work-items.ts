/**
 * Studio REST helpers for group work items.
 *
 * Author: Damon Li
 */

export type WorkItemStatus =
  | "open"
  | "in_progress"
  | "submitted"
  | "accepted"
  | "paused"
  | "cancelled";

export type WorkItem = {
  id: string;
  group_id: string;
  title: string;
  status: WorkItemStatus;
  owner_kind: "human" | "avatar" | "meta";
  owner_id: string;
  definition_of_done: string;
  artifact_paths: string[];
  blocked_by: string[];
  version: number;
};

export function studioBaseUrl(apiBase?: string): string {
  const fromArg = String(apiBase ?? "").trim().replace(/\/+$/, "");
  if (fromArg) return fromArg;
  if (typeof window !== "undefined") {
    const fromWindow = String(
      (window as unknown as { __AGX_URL__?: string }).__AGX_URL__ ?? "",
    ).trim().replace(/\/+$/, "");
    if (fromWindow) return fromWindow;
  }
  return "http://localhost:19080";
}

export function workItemRequestError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "事项请求失败";
  if (raw === "Failed to fetch" || raw === "NetworkError when attempting to fetch resource.") {
    return "事项接口连不上";
  }
  return raw;
}

export function workItemBlockerHint(item: WorkItem, items: WorkItem[]): string {
  if (!item.blocked_by?.length) return "";
  const byId = new Map(items.map((row) => [row.id, row]));
  const pending = item.blocked_by.some((id) => {
    const other = byId.get(id);
    return !other || other.status !== "accepted";
  });
  return pending ? "前置未验收" : "";
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  const map: Record<WorkItemStatus, string> = {
    open: "待开始",
    in_progress: "进行中",
    submitted: "待验收",
    accepted: "已验收",
    paused: "已暂停",
    cancelled: "已取消",
  };
  return map[status];
}

export async function fetchWorkItems(
  groupId: string,
  apiToken: string,
  apiBase?: string,
): Promise<WorkItem[]> {
  const resp = await fetch(`${studioBaseUrl(apiBase)}/api/groups/${encodeURIComponent(groupId)}/work-items`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { items?: WorkItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function createWorkItem(
  groupId: string,
  apiToken: string,
  body: { title: string; owner_kind: WorkItem["owner_kind"]; owner_id: string },
  apiBase?: string,
): Promise<WorkItem> {
  const resp = await fetch(`${studioBaseUrl(apiBase)}/api/groups/${encodeURIComponent(groupId)}/work-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": apiToken,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { item?: WorkItem };
  if (!data.item) throw new Error("missing item");
  return data.item;
}

export async function postWorkItemAction(
  groupId: string,
  itemId: string,
  apiToken: string,
  action: "accept" | "pause" | "resume",
  expected_version: number,
  apiBase?: string,
): Promise<WorkItem> {
  const resp = await fetch(
    `${studioBaseUrl(apiBase)}/api/groups/${encodeURIComponent(groupId)}/work-items/${encodeURIComponent(itemId)}/${action}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agx-desktop-token": apiToken,
      },
      body: JSON.stringify({ expected_version }),
    },
  );
  if (resp.status === 409) {
    const err = new Error("version conflict") as Error & { code?: string };
    err.code = "conflict";
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { item?: WorkItem };
  if (!data.item) throw new Error("missing item");
  return data.item;
}
