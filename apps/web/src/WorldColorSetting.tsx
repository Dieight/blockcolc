import { t, useI18n } from './i18n';
import { DEFAULT_WORLD_COLOR, normalizeWorldColor, type WorldColorAdjustment } from '@blockcolc/voxel/world-color-adjustment';
import { PixelChevron, PixelReset } from './ui/PixelIcon';
import { PhysicalSlider } from './ui/PhysicalSlider';
import { useState } from 'react';

export function WorldColorSetting({ value, onChange }: { value?: WorldColorAdjustment; onChange: (value: WorldColorAdjustment) => void }) {
  useI18n();
  const color = normalizeWorldColor(value);
  const [preview,setPreview]=useState<{key:keyof WorldColorAdjustment;value:number}|null>(null);
  const controls = [{ key: 'saturation' as const, label: t("饱和度"), min: 50, max: 150 },
    { key: 'brightness' as const, label: t("亮度"), min: 80, max: 120 }, { key: 'contrast' as const, label: t("对比度"), min: 80, max: 120 }];
  return <details className="world-color-setting">
    <summary className="setting-row"><div className="setting-name"><span>{t("世界色彩")}</span><small>{t("仅调整画面，不改变天气与日夜")}</small></div><PixelChevron size={18}/></summary>
    <div className="world-color-controls">{controls.map(control => <div className="world-color-control" key={control.key}><span>{control.label}</span>
      <PhysicalSlider label={t("世界{0}", control.label)} min={control.min} max={control.max} step={5} value={color[control.key]}
        onPreviewChange={value=>setPreview(value===null?null:{key:control.key,value})}
        onChange={value => onChange({ ...color, [control.key]: value })}/><output>{preview?.key===control.key?t("预计 {0}%", preview.value):`${color[control.key]}%`}</output></div>)}
      <button className="settings-text-action" type="button" onClick={() => onChange({ ...DEFAULT_WORLD_COLOR })}><PixelReset size={16}/>{t("恢复默认")}</button>
    </div>
  </details>;
}
