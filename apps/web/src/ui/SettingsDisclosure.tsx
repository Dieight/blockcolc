import { useId, useState, type ReactNode } from 'react';
import { PixelChevron } from './PixelIcon';
import { Reveal } from './Reveal';

/** A secondary setting stays in the same list; only its contents fold away. */
export function SettingsDisclosure({ title, value, description, className = '', defaultOpen=false, children }: {
  title: string; value?: ReactNode; description?: string; className?: string; defaultOpen?:boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className={`settings-disclosure ${className}`} aria-label={title}>
    <button type="button" className="setting-row settings-disclosure-toggle" aria-label={title} aria-describedby={[description?`${id}-description`:'',value?`${id}-value`:''].filter(Boolean).join(' ')||undefined} aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)}>
      <span className="setting-name"><span>{title}</span>{description && <small id={`${id}-description`}>{description}</small>}</span>
      <span className="settings-disclosure-value">{value && <span id={`${id}-value`} title={typeof value==='string'?value:undefined}>{value}</span>}<PixelChevron/></span>
    </button>
    <Reveal open={open} overflowVisible><div id={id} className="settings-disclosure-content">{children}</div></Reveal>
  </section>;
}
