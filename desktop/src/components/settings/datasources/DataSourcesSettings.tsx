import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { Toast } from "../../ds/Toast";
import { fetchDataSourcesStatus, testDataSource, updateDataSourceConfig } from "./api";
import { DataSourceCard } from "./DataSourceCard";
import type { DataSourceInfo } from "./types";

export function DataSourcesSettings() {
  const { t } = useTranslation("settings");
  const apiToken = useAppStore((s) => s.apiToken);
  const openSettings = useAppStore((s) => s.openSettings);
  const [items, setItems] = useState<DataSourceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVariant, setToastVariant] = useState<"default" | "warning">("default");

  const showToast = useCallback((message: string, variant: "default" | "warning" = "default") => {
    setToastMessage(message);
    setToastVariant(variant);
    setToastOpen(true);
  }, []);

  const reload = useCallback(async () => {
    const list = await fetchDataSourcesStatus(apiToken);
    setItems(list);
  }, [apiToken]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItems(null);
    fetchDataSourcesStatus(apiToken)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [apiToken]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await updateDataSourceConfig(apiToken, name, { enabled });
      await reload();
      showToast(enabled ? t("dataSources.enabledToast") : t("dataSources.disabledToast"));
    } catch (e) {
      showToast(t("dataSources.saveFailed", { reason: String(e) }), "warning");
      throw e;
    }
  };

  const handleTest = async (name: string) => {
    const result = await testDataSource(apiToken, name);
    if (result.ok) {
      showToast(t("dataSources.testOk"));
    } else {
      showToast(result.detail || t("dataSources.testFail"), "warning");
    }
    return result;
  };

  const handleOpenMcp = () => {
    openSettings("mcp");
  };

  if (error) {
    return <div className="p-4 text-sm text-rose-400">{t("dataSources.loadFailed", { error })}</div>;
  }
  if (!items) {
    return <div className="p-4 text-sm text-text-muted">{t("dataSources.loading")}</div>;
  }

  const free = items.filter((i) => !i.requiresCredential);
  const credentialed = items.filter((i) => i.requiresCredential);

  return (
    <>
      <div className="space-y-6 p-4">
        <section>
          <h3 className="text-sm font-medium text-text-strong">{t("dataSources.freeTitle")}</h3>
          <div className="mt-2 space-y-2">
            {free.map((item) => (
              <DataSourceCard
                key={item.name}
                item={item}
                onToggle={handleToggle}
                onTest={handleTest}
              />
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-sm font-medium text-text-strong">{t("dataSources.credTitle")}</h3>
          <div className="mt-2 space-y-2">
            {credentialed.map((item) => (
              <DataSourceCard
                key={item.name}
                item={item}
                onToggle={handleToggle}
                onTest={item.name === "tushare" ? handleTest : undefined}
                onOpenMcp={item.mcpServer ? handleOpenMcp : undefined}
              />
            ))}
          </div>
        </section>
      </div>
      <Toast open={toastOpen} message={toastMessage} variant={toastVariant} onClose={() => setToastOpen(false)} />
    </>
  );
}
