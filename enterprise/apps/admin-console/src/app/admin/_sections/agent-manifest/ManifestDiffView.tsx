"use client";

import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agenticx/ui";
import { useTranslations } from "next-intl";

import { diffManifests, type DiffLine } from "../../../../lib/ma/manifest-diff";

type VersionOption = { version: number; manifest: Record<string, unknown> };

type ManifestDiffViewProps = {
  versions: VersionOption[];
  initialFrom: number;
  initialTo: number;
};

function lineClass(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return "bg-emerald-500/10";
    case "del":
      return "bg-destructive/10";
    case "same":
      return "";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function lineMark(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return "+";
    case "del":
      return "-";
    case "same":
      return " ";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function ManifestDiffView({ versions, initialFrom, initialTo }: ManifestDiffViewProps) {
  const t = useTranslations("pages.admin.agents");
  const [fromVersion, setFromVersion] = useState(String(initialFrom));
  const [toVersion, setToVersion] = useState(String(initialTo));
  const from = versions.find((item) => String(item.version) === fromVersion) ?? versions[0];
  const to = versions.find((item) => String(item.version) === toVersion) ?? versions[0];
  const lines = useMemo(() => (from && to ? diffManifests(from.manifest, to.manifest) : []), [from, to]);
  const changed = lines.some((line) => line.kind !== "same");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t("manifest.diff.from")}</div>
          <Select value={fromVersion} onValueChange={setFromVersion}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((item) => (
                <SelectItem key={`from-${item.version}`} value={String(item.version)}>
                  v{item.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t("manifest.diff.to")}</div>
          <Select value={toVersion} onValueChange={setToVersion}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((item) => (
                <SelectItem key={`to-${item.version}`} value={String(item.version)}>
                  v{item.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!changed ? <p className="text-sm text-muted-foreground">{t("manifest.diff.noChange")}</p> : null}
      {changed ? (
        <div className="overflow-auto rounded-md border font-mono text-xs">
          {lines.map((line, index) => (
            <div key={`${line.kind}-${index}`} className={`flex gap-2 px-2 ${lineClass(line.kind)}`}>
              <span className="w-8 shrink-0 text-right text-muted-foreground">{line.oldNo ?? ""}</span>
              <span className="w-8 shrink-0 text-right text-muted-foreground">{line.newNo ?? ""}</span>
              <span className="whitespace-pre-wrap">
                {lineMark(line.kind)} {line.text}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
