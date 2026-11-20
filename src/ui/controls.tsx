import { useSyncExternalStore, type ReactNode } from 'react';
import type { Session } from '../engine/session';

export function useSession(session: Session) {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; cls?: string; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} title={o.title} className={`${value === o.value ? 'on' : ''} ${o.cls ?? ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min, max, step = 1, format, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; label?: string }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <span className="stepper" aria-label={label}>
      <button aria-label={`Decrease ${label ?? ''}`} onClick={() => onChange(clamp(value - step))}>−</button>
      <span>{format ? format(value) : value}</span>
      <button aria-label={`Increase ${label ?? ''}`} onClick={() => onChange(clamp(value + step))}>+</button>
    </span>
  );
}

export function SwitchRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <>
      <div className="row"><span className="lbl">{label}</span><Switch checked={checked} onChange={onChange} label={label} /></div>
      {hint && <p className="hint" style={{ marginTop: 0 }}>{hint}</p>}
    </>
  );
}

export function SliderRow({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="row">
      <span className="lbl" style={{ minWidth: 110 }}>{label}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val" style={{ minWidth: 48, textAlign: 'right' }}>{format ? format(value) : value}</span>
    </div>
  );
}

export function SelectRow<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function fmtTime(t: number): string {
  const neg = t < 0;
  const s = Math.abs(t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${neg ? '-' : ''}${m}:${String(sec).padStart(2, '0')}`;
}

export function pct(v: number) { return `${Math.round(v * 100)}%`; }
