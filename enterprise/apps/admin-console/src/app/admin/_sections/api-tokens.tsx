"use client";
import { adminFetch } from "../../../lib/admin-client-auth";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  getPatPlainFromVault,
  plainMatchesTokenPrefix,
  removePatFromVault,
  upsertPatVault,
} from "../../../lib/pat-vault";

type PatRow = {
  id: number;
  name: string;
  tokenPrefix: string;
  status: string;
  expireAt: string | null;
  lastUsedAt: string | null;
  userId: string;
};

async function readJsonBody<T>(res: Response, fallback: T): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export default function ApiTokensPage() {
  const t = useTranslations("pages.admin.apiTokens");
  const tc = useTranslations("common");
  const [tokens, setTokens] = useState<PatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [plainToken, setPlainToken] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", userId: "", expireDays: "90" });
  const [vaultVersion, setVaultVersion] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<PatRow | null>(null);
  const [pasteValue, setPasteValue] = useState("");

  const bumpVault = () => setVaultVersion((v) => v + 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/api-tokens");
      const json = await readJsonBody(res, { code: "50000", message: "empty response", data: { tokens: [] as PatRow[] } });
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "load failed");
      const all = json.data?.tokens ?? [];
      for (const row of all) {
        if (row.status !== "active") removePatFromVault(row.id);
      }
      setTokens(all.filter((row) => row.status === "active"));
      bumpVault();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [tc]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPasteDialog = (row: PatRow) => {
    setPasteTarget(row);
    setPasteValue("");
    setPasteOpen(true);
  };

  const savePastedKey = () => {
    if (!pasteTarget) return;
    const trimmed = pasteValue.trim();
    if (!plainMatchesTokenPrefix(trimmed, pasteTarget.tokenPrefix)) {
      toast.error(t("pasteKeyMismatch"));
      return;
    }
    upsertPatVault({
      id: pasteTarget.id,
      name: pasteTarget.name,
      tokenPrefix: pasteTarget.tokenPrefix,
      plainToken: trimmed,
    });
    bumpVault();
    setPasteOpen(false);
    setPasteTarget(null);
    setPasteValue("");
    toast.success(tc("actions.save"));
  };

  const onCreate = async () => {
    try {
      const res = await adminFetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          userId: form.userId,
          expireDays: Number(form.expireDays) || 90,
        }),
      });
      const json = await readJsonBody(res, { code: "50000", message: "empty response", data: {} as { token?: string; record?: PatRow } });
      if (!res.ok || json.code !== "00000") throw new Error(json.message || "create failed");
      const plain = json.data?.token?.trim() ?? "";
      const record = json.data?.record;
      if (plain && record) {
        upsertPatVault({
          id: record.id,
          name: record.name,
          tokenPrefix: record.tokenPrefix,
          plainToken: plain,
        });
        bumpVault();
      }
      setPlainToken(plain || null);
      setOpen(false);
      setForm({ name: "", userId: "", expireDays: "90" });
      await load();
      toast.success(t("toast.createSuccess"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.createFailed"));
    }
  };

  const onRevoke = async (id: number) => {
    if (!confirm(t("confirmRevoke"))) return;
    const res = await adminFetch(`/api/admin/api-tokens/${id}`, { method: "DELETE" });
    const json = await readJsonBody(res, { code: "50000", message: "empty response" });
    if (!res.ok || json.code !== "00000") {
      toast.error(json.message || t("toast.revokeFailed"));
      return;
    }
    removePatFromVault(id);
    bumpVault();
    toast.success(t("toast.revoked"));
    await load();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">{tc("breadcrumb.home")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("title")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> {t("newToken")}
          </Button>
        }
      />

      {plainToken ? (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-sm">{t("plainTokenTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block break-all rounded bg-muted p-3 text-xs">{plainToken}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(plainToken);
                toast.success(tc("actions.copy"));
              }}
            >
              {tc("actions.copy")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPlainToken(null);
              }}
            >
              {tc("actions.closeSaved")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tc("states.empty")}</p>
      ) : (
        <div className="grid gap-3">
          {tokens.map((row) => {
            const vaultPlain = getPatPlainFromVault(row.id);
            void vaultVersion;
            return (
            <Card key={row.id}>
              <CardContent className="flex items-center justify-between gap-4 pt-4">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <KeyRound className="h-4 w-4" /> {row.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.tokenPrefix}… · {t("meta.user", { userId: row.userId })} · {row.status}
                    {row.lastUsedAt ? t("meta.lastUsed", { lastUsed: row.lastUsedAt }) : ""}
                  </p>
                  {!vaultPlain ? (
                    <p className="mt-1 text-xs text-muted-foreground/80">{t("vaultMissingHint")}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {vaultPlain ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(vaultPlain);
                        toast.success(tc("actions.copy"));
                      }}
                    >
                      {t("copyKey")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => openPasteDialog(row)}>
                      {t("pasteKey")}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onRevoke(row.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("nameLabel")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>{t("userIdLabel")}</Label>
              <Input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
            </div>
            <div>
              <Label>{t("expireDaysLabel")}</Label>
              <Input value={form.expireDays} onChange={(e) => setForm({ ...form, expireDays: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void onCreate()}>{tc("actions.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pasteKeyTitle")}</DialogTitle>
          </DialogHeader>
          {pasteTarget ? (
            <p className="text-xs text-muted-foreground">
              {pasteTarget.name} · {pasteTarget.tokenPrefix}…
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="paste-key-input">{t("pasteKey")}</Label>
            <Input
              id="paste-key-input"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder="agx-pat-..."
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">{t("pasteKeyHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={savePastedKey}>{tc("actions.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
