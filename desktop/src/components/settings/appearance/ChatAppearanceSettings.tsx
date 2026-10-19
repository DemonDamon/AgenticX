import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { PRESET_IDS, defaultAppearance, presetAppearance, resolveAppearance, type AppearanceDocument, type AppearanceVariant, type ChatAppearance, type WallpaperType, type PatternId, type MotionMode, type PresetId } from "../../../../shared/chat-appearance";
import { useAppStore } from "../../../store";
import { useAppearanceStore } from "../../../appearance/store";
import { appearanceVariables } from "../../../appearance/render";
import { ChatWallpaper, cacheWallpaper } from "../../appearance/ChatWallpaper";
import { Panel } from "../../ds/Panel";
import { Button } from "../../ds/Button";
import { Modal } from "../../ds/Modal";
import { SettingsRangeField } from "../SettingsRangeField";

export type AppearanceEditorHandle = { requestLeave: (action: () => void) => void };
type Editor = { scope: string; draft: ChatAppearance; following: boolean; revision: number; baseline: string };
function signature(draft: ChatAppearance, following: boolean) { return JSON.stringify({ draft, following }); }
function makeEditor(doc: AppearanceDocument, scope: string): Editor {
  const draft = structuredClone(resolveAppearance(doc, scope));
  const following = scope !== "global" && !doc.overrides[scope];
  return { scope, draft, following, revision: doc.revision, baseline: signature(draft, following) };
}
export const ChatAppearanceSettings = forwardRef<AppearanceEditorHandle>(function ChatAppearanceSettings(_, ref) {
  const { t } = useTranslation("settings");
  const tr = (key: string) => t(`chatAppearance.${key}`);
  const document = useAppearanceStore(s => s.document);
  const loaded = useAppearanceStore(s => s.loaded);
  const warning = useAppearanceStore(s => s.warning);
  const loadError = useAppearanceStore(s => s.error);
  const gpuUnavailable = useAppearanceStore(s => s.gpuUnavailable);
  const theme = useAppStore(s => s.theme);
  const avatars = useAppStore(s => s.avatars);
  const groups = useAppStore(s => s.groups);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [pulse, setPulse] = useState(0);
  const dirty = !!editor && signature(editor.draft, editor.following) !== editor.baseline;
  useEffect(() => { void useAppearanceStore.getState().load(); useAppearanceStore.getState().setPreviewActive(true);
    return () => useAppearanceStore.getState().setPreviewActive(false); }, []);
  useEffect(() => {
    if (!loaded) return;
    if (!editor) setEditor(makeEditor(document, "global"));
    else if (!dirty && editor.revision !== document.revision) setEditor(makeEditor(document, editor.scope));
  }, [loaded, document, editor, dirty]);
  const requestLeave = (action: () => void) => {
    if (busy) return;
    if (dirty) setPendingLeave(() => action); else action();
  };
  useImperativeHandle(ref, () => ({ requestLeave }));
  const run = async (phase: string, action: () => Promise<void>) => {
    setBusy(phase); setMessage(""); setFailed(false);
    try { await action(); } catch (error) { setFailed(true); setMessage(`${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(""); }
  };
  if (!editor) return <Panel title={tr("title")}><p role="status" className="text-xs text-text-muted">{tr("loading")}</p></Panel>;
  const { draft, scope, following } = editor;
  const variant = draft.variants[theme];
  const wallpaper = variant.wallpaper;
  const update = (change: (next: ChatAppearance) => void) => {
    const next = structuredClone(draft); change(next); next.presetId = "custom";
    setEditor({ ...editor, draft: next, following: false }); setMessage("");
  };
  const updateVariant = (change: (v: AppearanceVariant) => void) => update(next => change(next.variants[theme]));
  const chooseImage = () => void run(tr("importingImage"), async () => {
    const result = await window.agenticxDesktop.importChatWallpaper();
    if (!result.ok) throw new Error(result.error);
    if (!result.value) return;
    const image = result.value;
    cacheWallpaper(image);
    updateVariant(v => { v.wallpaper.type = "image"; v.wallpaper.assetId = image.id; });
  });
  const scopeOptions = [{ value: "global", label: tr("global") }, { value: "meta", label: "Near" },
    ...avatars.filter(a => a.id && !a.id.startsWith("automation:")).map(a => ({ value: `avatar:${a.id}`, label: a.name })),
    ...groups.map(g => ({ value: `group:${g.id}`, label: g.name }))];
  const select = (label: string, value: string, options: Array<{ value: string; label: string }>, onChange: (value: string) => void) =>
    <label className="agx-appearance-field">{label}<select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  const range = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) =>
    <div className="agx-appearance-field"><span>{label}</span><SettingsRangeField min={min} max={max} step={step} value={value} onChange={onChange} showMinMaxHints={false} /></div>;
  return <Panel title={tr("title")}>
    <div className="space-y-4" aria-busy={!!busy}>
      <fieldset disabled={!!busy} className="min-w-0 space-y-4 border-0 p-0">
      {select(tr("scope"), scope, scopeOptions, next => requestLeave(() => { setEditor(makeEditor(useAppearanceStore.getState().document, next)); setMessage(""); }))}
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted"><span>{tr(`mode_${theme}`)}</span>{scope !== "global" ? <button type="button" className="text-theme hover:underline" onClick={() => {
        const next = structuredClone(document.global); setEditor({ ...editor, draft: next, following: true }); setMessage("");
      }}>{following ? tr("following") : tr("followGlobal")}</button> : null}</div>
      <div className="agx-appearance-preview" style={appearanceVariables(draft, theme, true)} data-testid="appearance-preview">
        <ChatWallpaper appearance={draft} mode={theme} preview focused pulse={pulse} />
        <div className="relative space-y-3 p-4">
          <div className="flex justify-end"><div className="agx-appearance-preview-bubble" style={{ background: "var(--chat-im-user-bg)", color: "var(--chat-im-user-text)" }}>{tr("previewUser")}</div></div>
          <div className="agx-appearance-preview-bubble" style={{ background: "var(--chat-im-assistant-bg)", color: "var(--chat-im-assistant-text)" }}>{tr("previewAssistant")}<pre className="agx-appearance-code"><span className="token-keyword">const</span> theme = <span className="token-string">"Near"</span>;</pre></div>
          <div className="inline-flex rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted">{tr("previewTool")}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">{PRESET_IDS.map(id => <button key={id} type="button" aria-pressed={draft.presetId === id} className={`min-w-0 rounded-lg border p-1.5 text-xs transition ${draft.presetId === id ? "border-[var(--ui-btn-primary-bg)] bg-surface-hover" : "border-border hover:bg-surface-hover"}`} onClick={() => {
        setEditor({ ...editor, draft: presetAppearance(id as PresetId), following: false }); setMessage("");
      }}><div className="agx-appearance-preview mb-1.5 !min-h-12"><ChatWallpaper appearance={presetAppearance(id)} mode={theme} animate={false} /></div><span className="block truncate">{tr(`preset_${id}`)}</span></button>)}</div>
      <div className="agx-appearance-controls">
        {select(tr("background"), wallpaper.type, (["default", "solid", "gradient", "image", "shader"] as WallpaperType[]).map(value => ({ value, label: tr(`type_${value}`) })), value => {
          if (value === "image" && !wallpaper.assetId) chooseImage(); else updateVariant(v => { v.wallpaper.type = value as WallpaperType; if (value !== "image") v.wallpaper.assetId = null; });
        })}
        {select(tr("pattern"), variant.pattern.id, ["none", "dots", "grid", "waves"].map(value => ({ value, label: tr(`pattern_${value}`) })), value => updateVariant(v => { v.pattern.id = value as PatternId; }))}
        {wallpaper.type !== "default" && wallpaper.type !== "image" ? <div className="agx-appearance-field"><span>{tr("colors")}</span><div className="flex flex-wrap items-center gap-2">{wallpaper.colors.map((c, i) => <input key={i} type="color" aria-label={`${tr("color")} ${i + 1}`} value={c} onChange={e => updateVariant(v => { v.wallpaper.colors[i] = e.target.value; })} />)}<Button className="!px-2 !py-1" disabled={wallpaper.colors.length >= 4} aria-label={tr("addColor")} onClick={() => updateVariant(v => { v.wallpaper.colors.push(v.wallpaper.colors[0]); })}>+</Button><Button className="!px-2 !py-1" disabled={wallpaper.colors.length <= 2} aria-label={tr("removeColor")} onClick={() => updateVariant(v => { v.wallpaper.colors.pop(); })}>−</Button></div></div> : null}
        {range(tr("patternIntensity"), variant.pattern.opacity, 0, 1, 0.01, value => updateVariant(v => { v.pattern.opacity = value; }))}
        {range(tr("overlay"), variant.overlay, 0, 1, 0.01, value => updateVariant(v => { v.overlay = value; }))}
        {(wallpaper.type === "gradient" || wallpaper.type === "shader") ? range(tr("angle"), wallpaper.angle, 0, 360, 1, value => updateVariant(v => { v.wallpaper.angle = value; })) : null}
        {wallpaper.type === "image" ? <>
          <div className="agx-appearance-field"><span>{tr("image")}</span><Button onClick={chooseImage}>{tr("chooseImage")}</Button></div>
          {range(tr("blur"), wallpaper.blur, 0, 24, 1, value => updateVariant(v => { v.wallpaper.blur = value; }))}
          {range(tr("zoom"), wallpaper.zoom, 1, 3, 0.05, value => updateVariant(v => { v.wallpaper.zoom = value; }))}
          {range(tr("horizontal"), wallpaper.x, 0, 1, 0.01, value => updateVariant(v => { v.wallpaper.x = value; }))}
          {range(tr("vertical"), wallpaper.y, 0, 1, 0.01, value => updateVariant(v => { v.wallpaper.y = value; }))}
        </> : null}
        <div className="agx-appearance-field"><span>{tr("bubbles")}</span><label className="flex items-center gap-2"><input type="checkbox" checked={variant.bubbles.custom} onChange={e => updateVariant(v => { v.bubbles.custom = e.target.checked; })} />{tr("customBubbles")}</label></div>
        {variant.bubbles.custom ? <>
          <div className="agx-appearance-field"><span>{tr("userBubble")}</span><div className="flex flex-wrap items-center gap-2">{variant.bubbles.user.map((c, i) => <input key={i} type="color" aria-label={`${tr("userBubble")} ${i + 1}`} value={c} onChange={e => updateVariant(v => { v.bubbles.user[i] = e.target.value; })} />)}<Button className="!px-2 !py-1" onClick={() => updateVariant(v => { v.bubbles.user = v.bubbles.user.length === 1 ? [v.bubbles.user[0], "#7C3AED"] : [v.bubbles.user[0]]; })}>{tr(variant.bubbles.user.length === 1 ? "gradientBubble" : "solidBubble")}</Button></div></div>
          <label className="agx-appearance-field">{tr("assistantBubble")}<input type="color" value={variant.bubbles.assistant} onChange={e => updateVariant(v => { v.bubbles.assistant = e.target.value; })} /></label>
        </> : null}
        {(wallpaper.type === "gradient" || wallpaper.type === "shader") ? <>
          {select(tr("motion"), draft.motion, ["off", "on-send", "continuous"].map(value => ({ value, label: tr(`motion_${value}`) })), value => update(next => { next.motion = value as MotionMode; }))}
          {range(tr("speed"), draft.speed, 0.25, 2, 0.05, value => update(next => { next.speed = value; }))}
          <Button onClick={() => setPulse(p => p + 1)}>{tr("previewMotion")}</Button>
        </> : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button onClick={() => void run(tr("importingTheme"), async () => {
          const result = await window.agenticxDesktop.importChatAppearancePackage(); if (!result.ok) throw new Error(result.error);
          if (result.value) { result.value.assets.forEach(cacheWallpaper); setEditor({ ...editor, draft: result.value.appearance, following: false }); }
        })}>{tr("importTheme")}</Button>
        <Button onClick={() => void run(tr("exportingTheme"), async () => {
          const result = await window.agenticxDesktop.exportChatAppearancePackage({ name: "Near theme", appearance: draft }); if (!result.ok) throw new Error(result.error);
        })}>{tr("exportTheme")}</Button>
        <Button onClick={() => { setEditor({ ...editor, draft: scope === "global" ? defaultAppearance() : structuredClone(document.global), following: scope !== "global" }); setMessage(""); }}>{tr("reset")}</Button>
      </div>
      </fieldset>
      {gpuUnavailable && draft.motion !== "off" ? <p className="text-xs text-text-muted">{tr("staticFallback")}</p> : null}
      {warning || loadError ? <div role="status" className="text-xs text-amber-600">{tr("loadWarning")}: {warning || loadError}<Button className="ml-2" onClick={() => void useAppearanceStore.getState().load()}>{tr("reload")}</Button></div> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <span role={failed ? "alert" : "status"} className={`min-w-0 flex-1 break-words text-xs ${failed ? "text-rose-500" : "text-text-muted"}`}>{busy || message}</span>
        <Button disabled={!!busy || !dirty} onClick={() => { setEditor(makeEditor(useAppearanceStore.getState().document, scope)); setMessage(""); }}>{tr("cancel")}</Button>
        <Button variant="primary" disabled={!!busy || !dirty || !loaded || !!loadError || !!warning} onClick={() => void run(tr("saving"), async () => {
          await useAppearanceStore.getState().save(scope, following && scope !== "global" ? null : draft, editor.revision);
          setEditor(makeEditor(useAppearanceStore.getState().document, scope)); setMessage(tr("saved"));
        })}>{tr("apply")}</Button>
      </div>
    </div>
    <Modal open={!!pendingLeave} title={tr("discardTitle")} footer={<div className="flex justify-end gap-2"><Button onClick={() => setPendingLeave(null)}>{tr("keepEditing")}</Button><Button variant="primary" onClick={() => { const action = pendingLeave; setPendingLeave(null); action?.(); }}>{tr("discard")}</Button></div>}><p className="text-sm text-text-primary">{tr("discardBody")}</p></Modal>
  </Panel>;
});
