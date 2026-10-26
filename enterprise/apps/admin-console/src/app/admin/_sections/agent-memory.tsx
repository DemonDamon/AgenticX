"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@agenticx/ui";
import { BrainCircuit } from "lucide-react";
import { useTranslations } from "next-intl";

import { adminFetch } from "../../../lib/admin-client-auth";
import { DreamDialog } from "../../../components/agent-memory/DreamDialog";
import { DreamHistory } from "../../../components/agent-memory/DreamHistory";
import { DreamReviewBanner } from "../../../components/agent-memory/DreamReviewBanner";

type StoreStatus = "active" | "archived";
type MemoryOperation = "created" | "modified" | "deleted";

type StoreRow = {
  id: string;
  name: string;
  description: string | null;
  metadata?: Record<string, string>;
  status: StoreStatus;
  memory_count: number;
  total_bytes: number;
  updated_at: string;
};

const DREAM_BLOCKING = new Set(["running", "pending", "failed", "cancelled"]);

function dreamReview(row: StoreRow | null): string {
  return row?.metadata?.["agx.review"] ?? "";
}

function canStartDream(row: StoreRow | null): boolean {
  if (!row || row.status === "archived") return false;
  return !DREAM_BLOCKING.has(dreamReview(row));
}

type MemoryRecord = {
  id: string;
  path: string;
  content?: string;
  content_sha256: string;
  size_bytes: number;
  version: number;
  last_actor:
    | { type: "user"; user_id: string | null }
    | { type: "agent"; user_id: string | null; session_id: string };
  updated_at: string;
};

type ListItem =
  | ({ type: "memory" } & MemoryRecord)
  | { type: "memory_prefix"; path: string };

type VersionRow = {
  id: string;
  version: number;
  operation: MemoryOperation;
  path: string | null;
  size_bytes: number | null;
  actor:
    | { type: "user_actor"; user_id: string | null }
    | { type: "session_actor"; user_id: string | null; session_id: string };
  redacted: boolean;
  redacted_at: string | null;
  redacted_by: string | null;
  created_at: string;
  content?: string | null;
};

const PATH_MAX = 1024;
const SEGMENT_MAX = 255;
const CONTENT_MAX = 102400;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function validateMemoryPath(raw: string): string | null {
  if (!raw.startsWith("/")) return "路径必须以 / 开头";
  const path = raw.normalize("NFC");
  if (path === "/") return "不能使用根路径";
  if (path.endsWith("/")) return "路径不能以 / 结尾";
  if (new TextEncoder().encode(path).length > PATH_MAX) return "路径超过 1024 字节";
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return "路径不能包含控制字符或反斜杠";
  for (const segment of path.slice(1).split("/")) {
    if (segment === "" || segment === "." || segment === "..") return "路径不能包含空段、. 或 ..";
    if (new TextEncoder().encode(segment).length > SEGMENT_MAX) return "路径中的每一段不能超过 255 字节";
  }
  return null;
}

function validateMemoryContent(content: string): string | null {
  if (content.includes("\u0000")) return "内容不能包含空字符";
  if (new TextEncoder().encode(content).length > CONTENT_MAX) return "内容不能超过 100 KiB";
  return null;
}

export default function AgentMemorySection() {
  const t = useTranslations("pages.admin.agentMemory");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [storeDescription, setStoreDescription] = useState("");
  const [selected, setSelected] = useState<StoreRow | null>(null);
  const [tree, setTree] = useState<ListItem[]>([]);
  const [children, setChildren] = useState<Record<string, ListItem[]>>({});
  const [openPrefixes, setOpenPrefixes] = useState<Record<string, boolean>>({});
  const [memory, setMemory] = useState<MemoryRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [conflict, setConflict] = useState(false);
  const [latestPreview, setLatestPreview] = useState<MemoryRecord | null>(null);
  const [pendingArchive, setPendingArchive] = useState<StoreRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoreRow | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [newMemoryOpen, setNewMemoryOpen] = useState(false);
  const [newPath, setNewPath] = useState("/");
  const [newContent, setNewContent] = useState("");
  const [newPathError, setNewPathError] = useState("");
  const [pendingMemoryDelete, setPendingMemoryDelete] = useState(false);
  const [pendingRedact, setPendingRedact] = useState<VersionRow | null>(null);
  const [viewingVersion, setViewingVersion] = useState<VersionRow | null>(null);
  const [dreamOpen, setDreamOpen] = useState(false);
  const [dreamRefresh, setDreamRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = includeArchived ? "?include_archived=true" : "";
      const res = await adminFetch(`/api/admin/ma-memory-stores${query}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { memory_stores?: StoreRow[] } };
      if (!res.ok) throw new Error(json.message || tc("toast.loadFailed"));
      setRows(json.data?.memory_stores ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [includeArchived, tc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function readError(res: Response): Promise<string> {
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    return json.message || tc("toast.saveFailed");
  }

  async function loadPrefix(prefix: string): Promise<ListItem[]> {
    if (!selected) return [];
    const params = new URLSearchParams({ path_prefix: prefix, depth: "1", view: "basic", limit: "200" });
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/memories?${params.toString()}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { items?: ListItem[] } };
    if (!res.ok) throw new Error(json.message || tc("toast.loadFailed"));
    return json.data?.items ?? [];
  }

  async function openStoreById(storeId: string) {
    const existing = rows.find((row) => row.id === storeId);
    if (existing) {
      await openStore(existing);
      return;
    }
    try {
      const res = await adminFetch(`/api/admin/ma-memory-stores/${storeId}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { memory_store?: StoreRow } };
      if (!res.ok || !json.data?.memory_store) throw new Error(json.message || tc("toast.loadFailed"));
      await openStore(json.data.memory_store);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    }
  }

  async function decideReview(decision: "approve" | "discard") {
    if (!selected) return;
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { memory_store?: StoreRow } };
    if (!res.ok || !json.data?.memory_store) {
      toast.error(json.message || tc("toast.saveFailed"));
      return;
    }
    setSelected(json.data.memory_store);
    toast.success(decision === "approve" ? t("dream.toast.approved") : t("dream.toast.discarded"));
    await load();
  }

  async function openStore(row: StoreRow) {
    setSelected(row);
    setMemory(null);
    setDraft("");
    setVersions([]);
    setConflict(false);
    setLatestPreview(null);
    setChildren({});
    setOpenPrefixes({});
    try {
      const params = new URLSearchParams({ path_prefix: "/", depth: "1", view: "basic", limit: "200" });
      const res = await adminFetch(`/api/admin/ma-memory-stores/${row.id}/memories?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { items?: ListItem[] } };
      if (!res.ok) throw new Error(json.message || tc("toast.loadFailed"));
      setTree(json.data?.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    }
  }

  async function togglePrefix(path: string) {
    setOpenPrefixes((current) => ({ ...current, [path]: !current[path] }));
    if (children[path]) return;
    try {
      const items = await loadPrefix(path);
      setChildren((current) => ({ ...current, [path]: items }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("toast.loadFailed"));
    }
  }

  async function openMemory(memoryId: string) {
    if (!selected) return;
    setConflict(false);
    setLatestPreview(null);
    const [memoryRes, versionRes] = await Promise.all([
      adminFetch(`/api/admin/ma-memory-stores/${selected.id}/memories/${memoryId}`, { cache: "no-store" }),
      adminFetch(`/api/admin/ma-memory-stores/${selected.id}/versions?memory_id=${memoryId}&limit=100`, { cache: "no-store" }),
    ]);
    const memoryJson = (await memoryRes.json().catch(() => ({}))) as { message?: string; data?: { memory?: MemoryRecord } };
    const versionJson = (await versionRes.json().catch(() => ({}))) as { message?: string; data?: { items?: VersionRow[] } };
    if (!memoryRes.ok) {
      toast.error(memoryJson.message || tc("toast.loadFailed"));
      return;
    }
    const next = memoryJson.data?.memory ?? null;
    setMemory(next);
    setDraft(next?.content ?? "");
    if (!versionRes.ok) toast.error(versionJson.message || tc("toast.loadFailed"));
    else setVersions(versionJson.data?.items ?? []);
  }

  async function createStore() {
    const res = await adminFetch("/api/admin/ma-memory-stores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: storeName.trim(), description: storeDescription.trim() || null }),
    });
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    toast.success(t("toast.created"));
    setCreating(false);
    setStoreName("");
    setStoreDescription("");
    await load();
  }

  async function saveMemory() {
    if (!selected || !memory) return;
    const contentError = validateMemoryContent(draft);
    if (contentError) {
      toast.error(contentError);
      return;
    }
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: draft, expected_version: memory.version }),
    });
    if (res.status === 409) {
      setConflict(true);
      toast.error(t("toast.conflict"));
      return;
    }
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    const json = (await res.json()) as { data?: { memory?: MemoryRecord } };
    const next = json.data?.memory ?? null;
    setMemory(next);
    setDraft(next?.content ?? draft);
    setConflict(false);
    toast.success(t("toast.memorySaved"));
    await openMemory(memory.id);
  }

  async function showLatest() {
    if (!selected || !memory) return;
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/memories/${memory.id}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { memory?: MemoryRecord } };
    if (!res.ok || !json.data?.memory) {
      toast.error(json.message || tc("toast.loadFailed"));
      return;
    }
    setLatestPreview(json.data.memory);
  }

  async function createMemory() {
    if (!selected) return;
    const pathError = validateMemoryPath(newPath);
    const contentError = validateMemoryContent(newContent);
    if (pathError || contentError) {
      setNewPathError(pathError || contentError || "");
      return;
    }
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: newPath.normalize("NFC"), content: newContent }),
    });
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    const json = (await res.json()) as { data?: { memory?: MemoryRecord } };
    toast.success(t("toast.memoryCreated"));
    setNewMemoryOpen(false);
    setNewPath("/");
    setNewContent("");
    setNewPathError("");
    await openStore(selected);
    if (json.data?.memory) await openMemory(json.data.memory.id);
  }

  async function deleteMemory() {
    if (!selected || !memory) return;
    const res = await adminFetch(
      `/api/admin/ma-memory-stores/${selected.id}/memories/${memory.id}?expected_version=${memory.version}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    toast.success(t("toast.memoryDeleted"));
    setPendingMemoryDelete(false);
    setMemory(null);
    setDraft("");
    setVersions([]);
    await openStore(selected);
    await load();
  }

  async function archiveStore() {
    if (!pendingArchive) return;
    const res = await adminFetch(`/api/admin/ma-memory-stores/${pendingArchive.id}/archive`, { method: "POST" });
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    toast.success(t("toast.archived"));
    setPendingArchive(null);
    if (selected?.id === pendingArchive.id) setSelected(null);
    await load();
  }

  async function deleteStore() {
    if (!pendingDelete || deleteName !== pendingDelete.name) return;
    const res = await adminFetch(`/api/admin/ma-memory-stores/${pendingDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    toast.success(t("toast.deleted"));
    if (selected?.id === pendingDelete.id) setSelected(null);
    setPendingDelete(null);
    setDeleteName("");
    await load();
  }

  async function viewVersion(version: VersionRow) {
    if (!selected) return;
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/versions?version_id=${version.id}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { message?: string; data?: { memory_version?: VersionRow } };
    if (!res.ok || !json.data?.memory_version) {
      toast.error(json.message || tc("toast.loadFailed"));
      return;
    }
    setViewingVersion(json.data.memory_version);
  }

  async function redactVersion() {
    if (!selected || !pendingRedact || !memory) return;
    const res = await adminFetch(`/api/admin/ma-memory-stores/${selected.id}/versions/${pendingRedact.id}/redact`, { method: "POST" });
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    toast.success(t("toast.redacted"));
    setPendingRedact(null);
    await openMemory(memory.id);
  }

  function renderNodes(items: ListItem[], depth: number) {
    return items.map((item) => {
      if (item.type === "memory_prefix") {
        const open = openPrefixes[item.path] === true;
        return (
          <div key={item.path} style={{ paddingLeft: depth * 12 }}>
            <button type="button" className="block w-full truncate py-1 text-left text-sm" onClick={() => void togglePrefix(item.path)}>
              {open ? "▾" : "▸"} {item.path}
            </button>
            {open ? renderNodes(children[item.path] ?? [], depth + 1) : null}
          </div>
        );
      }
      return (
        <button
          key={item.id}
          type="button"
          className="block w-full truncate py-1 text-left text-sm"
          style={{ paddingLeft: depth * 12 }}
          onClick={() => void openMemory(item.id)}
        >
          {item.path}
        </button>
      );
    });
  }

  function operationLabel(operation: MemoryOperation): string {
    switch (operation) {
      case "created":
        return t("operation.created");
      case "modified":
        return t("operation.modified");
      case "deleted":
        return t("operation.deleted");
      default: {
        const unreachable: never = operation;
        return String(unreachable);
      }
    }
  }

  const maxVersion = versions.reduce((max, version) => Math.max(max, version.version), 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
          {t("showArchived")}
        </label>
        <Button onClick={() => setCreating(true)}>{t("create")}</Button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">{tc("states.loading")}</p> : rows.length === 0 ? (
        <EmptyState icon={<BrainCircuit className="size-5" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.description")}</TableHead>
              <TableHead>{t("columns.count")}</TableHead>
              <TableHead>{t("columns.size")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.updatedAt")}</TableHead>
              <TableHead>{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.name}
                  {row.metadata?.["agx.review"] === "pending" ? <Badge className="ml-2">{t("dream.pendingBadge")}</Badge> : null}
                </TableCell>
                <TableCell>{row.description}</TableCell>
                <TableCell>{row.memory_count}</TableCell>
                <TableCell>{formatBytes(row.total_bytes)}</TableCell>
                <TableCell>{row.status === "archived" ? t("status.archived") : t("status.active")}</TableCell>
                <TableCell>{formatTime(row.updated_at)}</TableCell>
                <TableCell className="space-x-2">
                  <Button variant="outline" size="sm" onClick={() => void openStore(row)}>{t("actions.open")}</Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingArchive(row)}>{t("actions.archive")}</Button>
                  <Button variant="outline" size="sm" onClick={() => { setPendingDelete(row); setDeleteName(""); }}>{t("actions.delete")}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={selected != null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
          <SheetHeader>
            <SheetTitle>{selected?.name}</SheetTitle>
          </SheetHeader>
          {selected && canStartDream(selected) ? (
            <div className="mt-3">
              <Button type="button" variant="outline" onClick={() => setDreamOpen(true)}>{t("dream.start")}</Button>
            </div>
          ) : null}
          {selected?.metadata?.["agx.origin"] === "dream" ? (
            <DreamReviewBanner
              review={dreamReview(selected)}
              onApprove={() => void decideReview("approve")}
              onDiscard={() => void decideReview("discard")}
            />
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">{t("untrustedHint")}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-[240px_1fr]">
            <div className="rounded-md border p-2">
              <Button size="sm" variant="outline" onClick={() => { setNewMemoryOpen(true); setNewPathError(""); }}>{t("actions.newMemory")}</Button>
              <div className="mt-2">{renderNodes(tree, 0)}</div>
            </div>
            <div className="space-y-3">
              {memory ? (
                <>
                  <p className="text-sm">
                    {t("editor.version", { version: memory.version })} · {t("editor.lastEdit")}：
                    {memory.last_actor.type === "agent" ? (
                      <>
                        {t("editor.agent")}（{t("editor.session")}{" "}
                        <Link className="underline" href={`/ops/logs/managed/${memory.last_actor.session_id}`}>{memory.last_actor.session_id}</Link>
                        ）
                      </>
                    ) : (
                      t("editor.user", { id: memory.last_actor.user_id ?? "" })
                    )}
                    {" · "}
                    {formatTime(memory.updated_at)}
                  </p>
                  <Textarea className="min-h-48 font-mono" value={draft} onChange={(event) => setDraft(event.target.value)} />
                  <div className="flex gap-2">
                    <Button onClick={() => void saveMemory()}>{t("actions.save")}</Button>
                    <Button variant="outline" onClick={() => setPendingMemoryDelete(true)}>{t("actions.deleteMemory")}</Button>
                    {conflict ? <Button variant="outline" onClick={() => void showLatest()}>{t("actions.viewLatest")}</Button> : null}
                  </div>
                  {latestPreview ? (
                    <div className="rounded-md border p-3 text-sm">
                      <p className="mb-2">{t("editor.version", { version: latestPreview.version })}</p>
                      <pre className="whitespace-pre-wrap font-mono">{latestPreview.content}</pre>
                    </div>
                  ) : null}
                  <h3 className="text-sm font-medium">{t("versions.title")}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("versions.version")}</TableHead>
                        <TableHead>{t("versions.operation")}</TableHead>
                        <TableHead>{t("versions.actor")}</TableHead>
                        <TableHead>{t("versions.session")}</TableHead>
                        <TableHead>{t("versions.size")}</TableHead>
                        <TableHead>{t("versions.time")}</TableHead>
                        <TableHead>{t("versions.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((version) => {
                        const isHead = version.version === memory.version || (version.operation === "deleted" && version.version === maxVersion);
                        return (
                          <TableRow key={version.id} className={version.redacted ? "text-muted-foreground" : undefined}>
                            <TableCell>{t("editor.version", { version: version.version })}</TableCell>
                            <TableCell>{operationLabel(version.operation)}</TableCell>
                            <TableCell>
                              {version.actor.type === "session_actor" ? t("editor.agent") : t("editor.user", { id: version.actor.user_id ?? "" })}
                            </TableCell>
                            <TableCell>
                              {version.actor.type === "session_actor" ? (
                                <Link className="underline" href={`/ops/logs/managed/${version.actor.session_id}`}>{version.actor.session_id}</Link>
                              ) : null}
                            </TableCell>
                            <TableCell>{version.size_bytes == null ? "—" : formatBytes(version.size_bytes)}</TableCell>
                            <TableCell>
                              {version.redacted
                                ? t("versions.redacted", { time: formatTime(version.redacted_at ?? version.created_at), actor: version.redacted_by ?? "" })
                                : formatTime(version.created_at)}
                            </TableCell>
                            <TableCell className="space-x-2">
                              <Button size="sm" variant="outline" onClick={() => void viewVersion(version)}>{t("actions.viewVersion")}</Button>
                              {isHead ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button size="sm" variant="outline" disabled>{t("actions.redact")}</Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t("versions.redactDisabled")}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Button size="sm" variant="outline" disabled={version.redacted} onClick={() => setPendingRedact(version)}>{t("actions.redact")}</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("editor.pick")}</p>
              )}
            </div>
          </div>
          {selected ? (
            <DreamHistory storeId={selected.id} refreshKey={dreamRefresh} onOpenStore={(id) => void openStoreById(id)} />
          ) : null}
        </SheetContent>
      </Sheet>
      {selected ? (
        <DreamDialog
          open={dreamOpen}
          storeId={selected.id}
          storeName={selected.name}
          onOpenChange={(open) => {
            setDreamOpen(open);
            if (!open) setDreamRefresh((value) => value + 1);
          }}
        />
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("form.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("form.name")}</Label>
            <Input value={storeName} onChange={(event) => setStoreName(event.target.value)} />
            <Label>{t("form.description")}</Label>
            <Textarea value={storeDescription} onChange={(event) => setStoreDescription(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>{t("actions.cancel")}</Button>
            <Button onClick={() => void createStore()}>{t("create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newMemoryOpen} onOpenChange={setNewMemoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memory.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("memory.path")}</Label>
            <Input value={newPath} onChange={(event) => setNewPath(event.target.value)} />
            <Label>{t("memory.content")}</Label>
            <Textarea className="font-mono" value={newContent} onChange={(event) => setNewContent(event.target.value)} />
            {newPathError ? <p className="text-sm text-destructive">{newPathError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewMemoryOpen(false)}>{t("actions.cancel")}</Button>
            <Button onClick={() => void createMemory()}>{t("actions.newMemory")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingMemoryDelete} onOpenChange={setPendingMemoryDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("memory.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("memory.deleteDescription", { path: memory?.path ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMemoryDelete(false)}>{t("actions.cancel")}</Button>
            <Button onClick={() => void deleteMemory()}>{t("actions.deleteMemory")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingArchive != null} onOpenChange={(open) => { if (!open) setPendingArchive(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("archive.title")}</DialogTitle>
            <DialogDescription>{t("archive.description", { name: pendingArchive?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingArchive(null)}>{t("actions.cancel")}</Button>
            <Button onClick={() => void archiveStore()}>{t("archive.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete != null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>{t("delete.description", { name: pendingDelete?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <Input value={deleteName} placeholder={t("delete.placeholder")} onChange={(event) => setDeleteName(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>{t("actions.cancel")}</Button>
            <Button disabled={deleteName !== pendingDelete?.name} onClick={() => void deleteStore()}>{t("delete.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingRedact != null} onOpenChange={(open) => { if (!open) setPendingRedact(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("versions.redactTitle")}</DialogTitle>
            <DialogDescription>{t("versions.redactDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRedact(null)}>{t("actions.cancel")}</Button>
            <Button onClick={() => void redactVersion()}>{t("versions.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewingVersion != null} onOpenChange={(open) => { if (!open) setViewingVersion(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("versions.viewTitle")}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-sm">
            {viewingVersion?.redacted ? t("versions.redacted", { time: formatTime(viewingVersion.redacted_at ?? viewingVersion.created_at), actor: viewingVersion.redacted_by ?? "" }) : viewingVersion?.content ?? ""}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingVersion(null)}>{t("actions.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
