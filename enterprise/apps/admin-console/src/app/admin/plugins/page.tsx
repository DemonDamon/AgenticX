"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { Package, RefreshCcw, Upload } from "lucide-react";

type PluginRow = {
  name: string;
  version?: string;
  runtime?: string;
  enabled?: boolean;
  priority?: number;
};

export default function AdminPluginsPage() {
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploadName, setUploadName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/plugins");
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "load failed");
      setPlugins(json.data?.plugins ?? []);
      setEnabled(Boolean(json.data?.enabled));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载插件失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reloadPlugins() {
    try {
      const res = await fetch("/api/admin/plugins", { method: "PUT" });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "reload failed");
      toast.success("插件已热加载");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "热加载失败");
    }
  }

  async function uploadPlugin(form: HTMLFormElement) {
    try {
      const fd = new FormData(form);
      if (!uploadName.trim()) {
        toast.error("请填写插件目录名");
        return;
      }
      fd.set("name", uploadName.trim());
      const res = await fetch("/api/admin/plugins", { method: "POST", body: fd });
      const json = await res.json();
      if (json.code !== "00000") throw new Error(json.message || "upload failed");
      toast.success("插件已上传并加载");
      setUploadName("");
      form.reset();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Wasm 插件"
        description="管理网关 Wasm/内置插件：列表、热加载与上传。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void reloadPlugins()}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            热加载
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            运行中的插件
            <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "已启用" : "已关闭"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无已加载插件</p>
          ) : (
            plugins.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    runtime={p.runtime ?? "wasm"} · priority={p.priority ?? 0}
                  </div>
                </div>
                <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "ON" : "OFF"}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">上传插件包</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void uploadPlugin(e.currentTarget);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="plugin-name">插件目录名</Label>
              <Input id="plugin-name" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="wasm-my-plugin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manifest">manifest.yaml</Label>
              <Input id="manifest" name="manifest" type="file" accept=".yaml,.yml" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wasm">plugin.wasm（可选）</Label>
              <Input id="wasm" name="wasm" type="file" accept=".wasm" />
            </div>
            <Button type="submit">
              <Upload className="mr-2 h-4 w-4" />
              上传并加载
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
