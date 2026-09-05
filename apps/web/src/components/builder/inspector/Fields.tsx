import type { BoxSpacing } from '@crea/schema';
import type { ReactNode } from 'react';

/** Primitives de formulaire de l inspecteur. */

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function TextField({
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="crea-label">{label}</span>
      {multiline ? (
        <textarea
          className="crea-input resize-y"
          rows={4}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="crea-input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="crea-label">{label}</span>
      <input
        className="crea-input"
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="crea-label">{label}</span>
      <select
        className="crea-input"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value as T)}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}): React.ReactElement {
  const isHex = /^#[0-9a-f]{3,8}$/i.test(value ?? '');
  return (
    <label className="block">
      <span className="crea-label">{label}</span>
      <span className="flex gap-2">
        <input
          type="color"
          className="h-[33px] w-10 shrink-0 cursor-pointer rounded border border-line bg-white"
          value={isHex ? (value as string) : '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className="crea-input"
          type="text"
          value={value ?? ''}
          placeholder="#2F4132"
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const SIDE_LABELS: Record<(typeof SIDES)[number], string> = {
  top: 'Haut',
  right: 'Droite',
  bottom: 'Bas',
  left: 'Gauche',
};

/** Editeur de marges / rembourrage sur les quatre cotes. */
export function BoxField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BoxSpacing | undefined;
  onChange: (value: BoxSpacing) => void;
}): React.ReactElement {
  const current = value ?? {};

  return (
    <div>
      <span className="crea-label">{label}</span>
      <div className="grid grid-cols-4 gap-1.5">
        {SIDES.map((side) => (
          <label key={side} className="block">
            <input
              className="crea-input px-1.5 text-center"
              type="text"
              value={current[side] ?? ''}
              placeholder="0"
              aria-label={`${label} ${SIDE_LABELS[side]}`}
              onChange={(event) => onChange({ ...current, [side]: event.target.value })}
            />
            <span className="mt-0.5 block text-center text-[10px] text-muted">
              {SIDE_LABELS[side]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
