import { useState, type ReactNode } from 'react';
import { IconChevron } from './icons.tsx';

/** Katlanabilir panel. */
export function Panel({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel">
      <button className="panel__head" onClick={() => setOpen((v) => !v)} type="button">
        <span className={`panel__chev${open ? ' panel__chev--open' : ''}`}>
          <IconChevron width={10} height={10} />
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        {actions}
      </button>
      {open && <div className="panel__body">{children}</div>}
    </section>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}

export function NumberField({ label, value, onChange, onCommit, step = 1, min, max, suffix }: NumberFieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? round(value) : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isNaN(next)) return;
          onChange(clamp(next, min, max));
        }}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {suffix && <span className="field__label">{suffix}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  return (
    <div className="field field--slider">
      <span className="field__label" style={{ minWidth: 46 }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <span className="field__label" style={{ minWidth: 26, textAlign: 'right' }}>
        {round(value)}
      </span>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field__label" style={{ minWidth: 34 }}>
        {label}
      </span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} disabled={disabled} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0 }}
      />
    </div>
  );
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}
