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

export function studioBaseUrl(): string {
  if (typeof window === "undefined") return "http://localhost:19080";
  return (window as unknown as { __AGX_URL__?: string }).__AGX_URL__ ?? "http://localhost:19080";
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

export async function fetchWorkItems(groupId: string, apiToken: string): Promise<WorkItem[]> {
  const resp = await fetch(`${studioBaseUrl()}/api/groups/${encodeURIComponent(groupId)}/work-items`, {
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
): Promise<WorkItem> {
  const resp = await fetch(`${studioBaseUrl()}/api/groups/${encodeURIComponent(groupId)}/work-items`, {
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
): Promise<WorkItem> {
  const resp = await fetch(
    `${studioBaseUrl()}/api/groups/${encodeURIComponent(groupId)}/work-items/${encodeURIComponent(itemId)}/${action}`,
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
