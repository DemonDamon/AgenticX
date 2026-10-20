import { useTranslation } from "react-i18next";
import { defaultEffect, EFFECT_IDS, EFFECT_PARAMS, type EffectId, type EffectParameter, type ShaderEffect, type Wallpaper } from "../../../../shared/chat-appearance";
import { effectPreviewBackground } from "../../../appearance/render";
import { Button } from "../../ds/Button";
import { SettingsRangeField } from "../SettingsRangeField";

type Props = { wallpaper: Wallpaper; onSelect: (id: EffectId) => void; onChange: (effect: ShaderEffect) => void };
export function BackgroundEffectControls({ wallpaper, onSelect, onChange }: Props) {
  const { t } = useTranslation("settings");
  const tr = (key: string) => t(`chatAppearance.${key}`);
  const effect = wallpaper.effect;
  if (!effect) return null;
  const specs: Record<string, EffectParameter> = EFFECT_PARAMS[effect.id];
  return <div className="col-span-full min-w-0 space-y-3">
    <div className="text-xs text-text-primary">{tr("effects")}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{EFFECT_IDS.map(id => <button key={id} type="button" aria-pressed={effect.id === id}
      className={`min-w-0 rounded-lg border p-2 text-xs transition ${effect.id === id ? "border-[var(--ui-btn-primary-bg)] bg-surface-hover" : "border-border hover:bg-surface-hover"}`}
      onClick={() => onSelect(id)}>
      <div aria-hidden="true" className="mb-2 h-12 rounded-md" style={{ background: effectPreviewBackground({ ...wallpaper, effect: defaultEffect(id) }) }} />
      <span className="block truncate">{tr(`effect_${id}`)}</span>
    </button>)}</div>
    <div className="agx-appearance-controls">
      {Object.entries(specs).map(([key, spec]) => {
        const label = tr(`effectParam_${effect.id}_${key}`);
        const value = (effect.params as Record<string, number>)[key];
        return <div key={`${effect.id}_${key}`} role="group" aria-label={label} className="agx-appearance-field">
          <span>{label}</span><SettingsRangeField {...spec} value={value} showMinMaxHints={false} onChange={value => onChange({
            ...effect, params: { ...effect.params, [key]: spec.step === 1 ? Math.round(value) : value },
          } as ShaderEffect)} />
        </div>;
      })}
      <div role="group" aria-label={tr("effectOpacity")} className="agx-appearance-field"><span>{tr("effectOpacity")}</span>
        <SettingsRangeField min={0} max={1} step={.01} value={effect.opacity} showMinMaxHints={false} onChange={opacity => onChange({ ...effect, opacity })} />
      </div>
    </div>
    <Button onClick={() => onChange(defaultEffect(effect.id))}>{tr("resetEffect")}</Button>
  </div>;
}
