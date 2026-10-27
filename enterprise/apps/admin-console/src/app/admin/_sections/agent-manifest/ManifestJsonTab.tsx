"use client";

import { useEffect, useState } from "react";
import { Button, Textarea } from "@agenticx/ui";
import { useTranslations } from "next-intl";

type ManifestJsonTabProps = {
  draft: Record<string, unknown>;
  onApply: (next: Record<string, unknown>) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ManifestJsonTab({ draft, onApply }: ManifestJsonTabProps) {
  const t = useTranslations("pages.admin.agents");
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    setText(JSON.stringify(draft, null, 2));
    setParseError("");
  }, [draft]);

  return (
    <div className="space-y-3">
      <Textarea className="min-h-[360px] font-mono text-xs" value={text} onChange={(event) => setText(event.target.value)} />
      {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            try {
              const parsed = JSON.parse(text) as unknown;
              if (!isRecord(parsed)) {
                setParseError(t("manifest.json.parseError"));
                return;
              }
              setParseError("");
              onApply(parsed);
            } catch {
              setParseError(t("manifest.json.parseError"));
            }
          }}
        >
          {t("manifest.json.apply")}
        </Button>
      </div>
    </div>
  );
}
