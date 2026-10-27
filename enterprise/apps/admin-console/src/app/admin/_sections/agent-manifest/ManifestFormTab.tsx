"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";

import {
  formToManifest,
  manifestToForm,
  ManifestFormError,
  type CustomToolForm,
  type ManifestFormState,
  type McpServerForm,
  type SkillForm,
  type ToolConfigRow,
  type ToolPolicyChoice,
} from "../../../../lib/ma/manifest-form";

type SkillOption = { id: string; slug: string; displayName: string; version: string; status: string };

type ManifestFormTabProps = {
  draft: Record<string, unknown>;
  revision: number;
  models: Array<{ id: string; label: string }>;
  skills: SkillOption[];
  onDraft: (next: Record<string, unknown>) => void;
};

function PolicySelect({
  value,
  allowInherit,
  onChange,
  inheritLabel,
  allowLabel,
  askLabel,
}: {
  value: ToolPolicyChoice | "always_allow" | "always_ask";
  allowInherit: boolean;
  onChange: (value: string) => void;
  inheritLabel: string;
  allowLabel: string;
  askLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowInherit ? <SelectItem value="inherit">{inheritLabel}</SelectItem> : null}
        <SelectItem value="always_allow">{allowLabel}</SelectItem>
        <SelectItem value="always_ask">{askLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ManifestFormTab({ draft, revision, models, skills, onDraft }: ManifestFormTabProps) {
  const t = useTranslations("pages.admin.agents");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [form, setForm] = useState<ManifestFormState>(() => manifestToForm(draft));
  const [errorSection, setErrorSection] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setForm(manifestToForm(draftRef.current));
    setErrorSection("");
    setErrorMessage("");
  }, [revision]);

  const modelChoices =
    form.model && !models.some((item) => item.id === form.model)
      ? [{ id: form.model, label: form.model }, ...models]
      : models;

  function commit(next: ManifestFormState, section: string) {
    try {
      onDraft(formToManifest(next, draftRef.current));
      setForm(next);
      setErrorSection("");
      setErrorMessage("");
    } catch (error) {
      setForm(next);
      if (error instanceof ManifestFormError) {
        setErrorSection(section);
        setErrorMessage(error.message);
        return;
      }
      throw error;
    }
  }

  function updateConfig(list: ToolConfigRow[], index: number, patch: Partial<ToolConfigRow>): ToolConfigRow[] {
    return list.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
  }

  const sectionError = (section: string) =>
    errorSection === section && errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.model")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={form.model || undefined} onValueChange={(model) => commit({ ...form, model }, "model")}>
            <SelectTrigger>
              <SelectValue placeholder={t("manifest.form.model")} />
            </SelectTrigger>
            <SelectContent>
              {modelChoices.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.system")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={10}
            maxLength={65536}
            value={form.system}
            onChange={(event) => commit({ ...form, system: event.target.value }, "system")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.builtin")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.builtin.present}
              onCheckedChange={(checked) =>
                commit({ ...form, builtin: { ...form.builtin, present: Boolean(checked) } }, "builtin")
              }
            />
            <span>{t("manifest.form.builtinEnabled")}</span>
          </label>
          {form.builtin.present ? (
            <>
              <div className="space-y-1">
                <Label>{t("manifest.form.defaultPolicy")}</Label>
                <PolicySelect
                  value={form.builtin.defaultPolicy}
                  allowInherit={false}
                  inheritLabel={t("manifest.form.policy.inherit")}
                  allowLabel={t("manifest.form.policy.always_allow")}
                  askLabel={t("manifest.form.policy.always_ask")}
                  onChange={(defaultPolicy) => {
                    if (defaultPolicy === "always_allow" || defaultPolicy === "always_ask") {
                      commit({ ...form, builtin: { ...form.builtin, defaultPolicy } }, "builtin");
                    }
                  }}
                />
              </div>
              {form.builtin.configs.map((row, index) => (
                <div key={`builtin-${index}`} className="grid gap-2 sm:grid-cols-[1fr_160px_auto_auto]">
                  <Input
                    value={row.name}
                    placeholder={t("manifest.form.toolName")}
                    onChange={(event) =>
                      commit(
                        {
                          ...form,
                          builtin: { ...form.builtin, configs: updateConfig(form.builtin.configs, index, { name: event.target.value }) },
                        },
                        "builtin",
                      )
                    }
                  />
                  <PolicySelect
                    value={row.policy}
                    allowInherit
                    inheritLabel={t("manifest.form.policy.inherit")}
                    allowLabel={t("manifest.form.policy.always_allow")}
                    askLabel={t("manifest.form.policy.always_ask")}
                    onChange={(policy) => {
                      if (policy === "inherit" || policy === "always_allow" || policy === "always_ask") {
                        commit(
                          { ...form, builtin: { ...form.builtin, configs: updateConfig(form.builtin.configs, index, { policy }) } },
                          "builtin",
                        );
                      }
                    }}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={row.enabled}
                      onCheckedChange={(checked) =>
                        commit(
                          {
                            ...form,
                            builtin: {
                              ...form.builtin,
                              configs: updateConfig(form.builtin.configs, index, { enabled: Boolean(checked) }),
                            },
                          },
                          "builtin",
                        )
                      }
                    />
                    <span>{t("manifest.form.enabled")}</span>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      commit(
                        { ...form, builtin: { ...form.builtin, configs: form.builtin.configs.filter((_, i) => i !== index) } },
                        "builtin",
                      )
                    }
                  >
                    {t("manifest.form.remove")}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  commit(
                    {
                      ...form,
                      builtin: {
                        ...form.builtin,
                        configs: [...form.builtin.configs, { name: "", policy: "inherit", enabled: true }],
                      },
                    },
                    "builtin",
                  )
                }
              >
                {t("manifest.form.addTool")}
              </Button>
            </>
          ) : null}
          {sectionError("builtin")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.mcp")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("manifest.form.mcpSecretHint")}</p>
          {form.mcpServers.map((server, index) => (
            <McpServerCard
              key={`mcp-${index}`}
              server={server}
              onChange={(next) =>
                commit(
                  { ...form, mcpServers: form.mcpServers.map((item, i) => (i === index ? next : item)) },
                  "mcp",
                )
              }
              onRemove={() => commit({ ...form, mcpServers: form.mcpServers.filter((_, i) => i !== index) }, "mcp")}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              commit(
                {
                  ...form,
                  mcpServers: [
                    ...form.mcpServers,
                    {
                      name: "",
                      url: "",
                      transport: "http",
                      defaultPolicy: "always_allow",
                      configs: [],
                      hasToolset: false,
                    },
                  ],
                },
                "mcp",
              )
            }
          >
            {t("manifest.form.addMcp")}
          </Button>
          {sectionError("mcp")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.custom")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.customTools.map((tool, index) => (
            <CustomToolCard
              key={`custom-${index}`}
              tool={tool}
              onChange={(next) =>
                commit(
                  { ...form, customTools: form.customTools.map((item, i) => (i === index ? next : item)) },
                  "custom",
                )
              }
              onRemove={() => commit({ ...form, customTools: form.customTools.filter((_, i) => i !== index) }, "custom")}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              commit(
                {
                  ...form,
                  customTools: [...form.customTools, { name: "", description: "", inputSchemaText: "{\n  \"type\": \"object\"\n}" }],
                },
                "custom",
              )
            }
          >
            {t("manifest.form.addCustom")}
          </Button>
          {sectionError("custom")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.skills")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm font-medium">{t("manifest.form.tenantSkills")}</div>
          {skills.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : null}
          {skills.map((skill) => {
            const selected = form.skills.find((item) => item.source === "tenant" && item.id === skill.id);
            const versionLabel = selected?.version ? `v${selected.version}` : skill.version ? `v${skill.version}` : "";
            return (
              <label key={skill.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={Boolean(selected)}
                  onCheckedChange={(checked) => {
                    const nextSkills: SkillForm[] = checked
                      ? [...form.skills.filter((item) => !(item.source === "tenant" && item.id === skill.id)), { source: "tenant", id: skill.id, version: null }]
                      : form.skills.filter((item) => !(item.source === "tenant" && item.id === skill.id));
                    commit({ ...form, skills: nextSkills }, "skills");
                  }}
                />
                <span>{skill.displayName || skill.slug}</span>
                {versionLabel ? <span className="text-xs text-muted-foreground">{versionLabel}</span> : null}
              </label>
            );
          })}
          <div className="text-sm font-medium">{t("manifest.form.builtinSkills")}</div>
          {form.skills
            .filter((skill) => skill.source === "builtin")
            .map((skill, index, builtinSkills) => (
              <div key={`builtin-skill-${index}`} className="flex gap-2">
                <Input
                  value={skill.id}
                  onChange={(event) => {
                    const nextBuiltin = builtinSkills.map((item, i) => (i === index ? { ...item, id: event.target.value } : item));
                    commit({ ...form, skills: [...form.skills.filter((item) => item.source !== "builtin"), ...nextBuiltin] }, "skills");
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const nextBuiltin = builtinSkills.filter((_, i) => i !== index);
                    commit({ ...form, skills: [...form.skills.filter((item) => item.source !== "builtin"), ...nextBuiltin] }, "skills");
                  }}
                >
                  {t("manifest.form.remove")}
                </Button>
              </div>
            ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => commit({ ...form, skills: [...form.skills, { source: "builtin", id: "", version: null }] }, "skills")}
          >
            {t("manifest.form.addBuiltinSkill")}
          </Button>
          {sectionError("skills")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.runtime")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>{t("manifest.form.maxToolRounds")}</Label>
            <Input
              inputMode="numeric"
              value={form.maxToolRounds}
              onChange={(event) => commit({ ...form, maxToolRounds: event.target.value }, "runtime")}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("manifest.form.maxSessionTokens")}</Label>
            <Input
              inputMode="numeric"
              value={form.maxSessionTokens}
              onChange={(event) => commit({ ...form, maxSessionTokens: event.target.value }, "runtime")}
            />
          </div>
          {sectionError("runtime")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("manifest.form.welcome")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={form.welcomeMessage}
            onChange={(event) => commit({ ...form, welcomeMessage: event.target.value }, "welcome")}
          />
          <div className="space-y-1">
            <Label>{t("manifest.form.suggested")}</Label>
            <Textarea
              rows={4}
              value={form.suggestedQuestionsText}
              onChange={(event) => commit({ ...form, suggestedQuestionsText: event.target.value }, "welcome")}
            />
          </div>
          {sectionError("welcome")}
        </CardContent>
      </Card>
    </div>
  );
}

function McpServerCard({
  server,
  onChange,
  onRemove,
}: {
  server: McpServerForm;
  onChange: (next: McpServerForm) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("pages.admin.agents");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={server.name} placeholder={t("manifest.form.mcpName")} onChange={(event) => onChange({ ...server, name: event.target.value })} />
        <Input value={server.url} placeholder={t("manifest.form.mcpUrl")} onChange={(event) => onChange({ ...server, url: event.target.value })} />
      </div>
      <div className="space-y-1">
        <Label>{t("manifest.form.mcpTransport")}</Label>
        <Select
          value={server.transport}
          onValueChange={(transport) => {
            if (transport === "http" || transport === "sse") onChange({ ...server, transport });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="sse">SSE</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={server.hasToolset} onCheckedChange={(checked) => onChange({ ...server, hasToolset: Boolean(checked) })} />
        <span>{t("manifest.form.mcpToolset")}</span>
      </label>
      {server.hasToolset ? (
        <>
          <PolicySelect
            value={server.defaultPolicy}
            allowInherit={false}
            inheritLabel={t("manifest.form.policy.inherit")}
            allowLabel={t("manifest.form.policy.always_allow")}
            askLabel={t("manifest.form.policy.always_ask")}
            onChange={(defaultPolicy) => {
              if (defaultPolicy === "always_allow" || defaultPolicy === "always_ask") onChange({ ...server, defaultPolicy });
            }}
          />
          {server.configs.map((row, index) => (
            <div key={`mcp-tool-${index}`} className="grid gap-2 sm:grid-cols-[1fr_160px_auto_auto]">
              <Input
                value={row.name}
                placeholder={t("manifest.form.toolName")}
                onChange={(event) =>
                  onChange({
                    ...server,
                    configs: server.configs.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
                  })
                }
              />
              <PolicySelect
                value={row.policy}
                allowInherit
                inheritLabel={t("manifest.form.policy.inherit")}
                allowLabel={t("manifest.form.policy.always_allow")}
                askLabel={t("manifest.form.policy.always_ask")}
                onChange={(policy) => {
                  if (policy === "inherit" || policy === "always_allow" || policy === "always_ask") {
                    onChange({
                      ...server,
                      configs: server.configs.map((item, i) => (i === index ? { ...item, policy } : item)),
                    });
                  }
                }}
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={row.enabled}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...server,
                      configs: server.configs.map((item, i) => (i === index ? { ...item, enabled: Boolean(checked) } : item)),
                    })
                  }
                />
                <span>{t("manifest.form.enabled")}</span>
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange({ ...server, configs: server.configs.filter((_, i) => i !== index) })}
              >
                {t("manifest.form.remove")}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...server, configs: [...server.configs, { name: "", policy: "inherit", enabled: true }] })}
          >
            {t("manifest.form.addTool")}
          </Button>
        </>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={onRemove}>
        {t("manifest.form.remove")}
      </Button>
    </div>
  );
}

function CustomToolCard({
  tool,
  onChange,
  onRemove,
}: {
  tool: CustomToolForm;
  onChange: (next: CustomToolForm) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("pages.admin.agents");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Input value={tool.name} placeholder={t("manifest.form.customName")} onChange={(event) => onChange({ ...tool, name: event.target.value })} />
      <Input
        value={tool.description}
        placeholder={t("manifest.form.customDescription")}
        onChange={(event) => onChange({ ...tool, description: event.target.value })}
      />
      <Textarea
        rows={4}
        className="font-mono"
        placeholder={t("manifest.form.customSchema")}
        value={tool.inputSchemaText}
        onChange={(event) => onChange({ ...tool, inputSchemaText: event.target.value })}
      />
      <Button type="button" size="sm" variant="outline" onClick={onRemove}>
        {t("manifest.form.remove")}
      </Button>
    </div>
  );
}
