"use client";

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Field } from "@/components/Field";
import { useT } from "@/lib/i18n";
import { useEditor } from "./EditorContext";

export function fmtNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "";
  const p = 10 ** digits;
  return String(Math.round(value * p) / p);
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "" || trimmed === "-" || trimmed === ".") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function NumberField({
  id,
  label,
  value,
  onCommit,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 0.01,
  digits = 2,
  unit,
  hint,
  disabled = false,
  validate,
}: {
  id: string;
  label: ReactNode;
  value: number;

  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;

  unit?: string;
  hint?: ReactNode;
  disabled?: boolean;

  validate?: (value: number) => string | null;
}) {
  const { t, tf } = useT();
  const { endCoalesce } = useEditor();
  const [text, setText] = useState(() => fmtNumber(value, digits));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revertRef = useRef(false);

  const shown = fmtNumber(value, digits);
  const [synced, setSynced] = useState(shown);
  if (!focused && shown !== synced) {
    setSynced(shown);
    setText(shown);
  }

  const check = (n: number | null): string | null => {
    if (n === null) return t("editor.field.number");
    if (n < min || n > max) {
      return Number.isFinite(max)
        ? tf("editor.field.between", { min: fmtNumber(min, digits), max: fmtNumber(max, digits) })
        : tf("editor.field.min", { min: fmtNumber(min, digits) });
    }
    return validate ? validate(n) : null;
  };

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          className="input"
          inputMode="decimal"
          type="text"
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);

            setError(check(parseNumber(e.target.value)));
          }}
          onBlur={() => {
            const revert = revertRef.current;
            revertRef.current = false;
            const n = parseNumber(text);
            if (!revert && n !== null && !check(n) && fmtNumber(n, digits) !== fmtNumber(value, digits)) {
              onCommit(n);
            }
            setFocused(false);
            setError(null);

            setText(fmtNumber(value, digits));
            endCoalesce();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              revertRef.current = true;
              e.currentTarget.blur();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const base = parseNumber(text) ?? value;
              const next = Math.round((base + (e.key === "ArrowUp" ? step : -step)) * 1e6) / 1e6;
              const clamped = Math.min(max, Math.max(min, next));
              if (!check(clamped)) {
                setText(fmtNumber(clamped, digits));
                setError(null);
                onCommit(clamped);
              }
            }
          }}
        />
        {unit && <span className="shrink-0 text-meta text-[var(--text-muted)]">{unit}</span>}
      </div>
    </Field>
  );
}

export function TextField({
  id,
  label,
  value,
  onCommit,
  required = true,
  multiline = false,
  hint,
  disabled = false,
  placeholder,
  commitOnBlur = false,
}: {
  id: string;
  label: ReactNode;
  value: string;

  onCommit: (value: string) => void;
  required?: boolean;
  multiline?: boolean;
  hint?: ReactNode;
  disabled?: boolean;
  placeholder?: string;

  commitOnBlur?: boolean;
}) {
  const { t } = useT();
  const { endCoalesce } = useEditor();
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revertRef = useRef(false);

  const [synced, setSynced] = useState(value);
  if (!focused && value !== synced) {
    setSynced(value);
    setText(value);
  }

  const onChange = (next: string) => {
    setText(next);
    if (required && next.trim() === "") {
      setError(t("editor.field.required"));
      return;
    }
    setError(null);
    if (!commitOnBlur) onCommit(next);
  };
  const common = {
    id,
    className: "input",
    value: text,
    disabled,
    placeholder,
    "aria-invalid": error ? true : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => {
      const revert = revertRef.current;
      revertRef.current = false;
      if (commitOnBlur && !revert && text !== value && !(required && text.trim() === "")) onCommit(text);
      setFocused(false);
      setError(null);
      setText(value);
      endCoalesce();
    },

    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && commitOnBlur && !multiline) {
        e.currentTarget.blur();
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (commitOnBlur) revertRef.current = true;
      e.currentTarget.blur();
    },
  };

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function VolumeField({
  id,
  label,
  value,
  onCommit,
  hint,
  disabled = false,
}: {
  id: string;
  label: ReactNode;
  value: number;
  onCommit: (value: number) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { endCoalesce } = useEditor();
  const pct = Math.round(value * 100);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          className="slider"
          min={0}
          max={100}
          step={1}
          value={pct}
          disabled={disabled}
          onChange={(e) => onCommit(Number(e.target.value) / 100)}
          onPointerUp={endCoalesce}
          onKeyUp={endCoalesce}
          onBlur={endCoalesce}
        />
        <span className="w-10 shrink-0 text-right text-meta tabular-nums">{pct}%</span>
      </div>
    </Field>
  );
}

export function SliderField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  scale = 1,
  digits = 0,
  unit,
  hint,
  disabled = false,
}: {
  id: string;
  label: ReactNode;

  value: number;

  onChange: (value: number) => void;

  min: number;
  max: number;

  step: number;
  scale?: number;

  digits?: number;
  unit?: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { t, tf } = useT();
  const { endCoalesce } = useEditor();
  const shown = fmtNumber(value * scale, digits);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revertRef = useRef(false);
  const [synced, setSynced] = useState(shown);
  if (!focused && shown !== synced) {
    setSynced(shown);
    setText(shown);
  }

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const snap = (v: number) => Math.round(v * 1e6) / 1e6;
  const check = (n: number | null): string | null => {
    if (n === null) return t("editor.field.number");
    const stored = n / scale;
    if (stored < min - 1e-9 || stored > max + 1e-9) {
      return tf("editor.field.between", {
        min: fmtNumber(min * scale, digits),
        max: fmtNumber(max * scale, digits),
      });
    }
    return null;
  };

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="slider min-w-0"
          aria-label={typeof label === "string" ? label : undefined}
          aria-valuetext={`${shown}${unit ?? ""}`}
          min={min}
          max={max}
          step={step}
          value={clamp(value)}
          disabled={disabled}
          onChange={(e) => onChange(snap(clamp(Number(e.target.value))))}
          onPointerUp={endCoalesce}
          onKeyUp={endCoalesce}
          onBlur={endCoalesce}
        />
        <input
          id={id}
          className="input w-20 shrink-0 tabular-nums"
          inputMode="decimal"
          type="text"
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            setError(check(parseNumber(e.target.value)));
          }}
          onBlur={() => {
            const revert = revertRef.current;
            revertRef.current = false;
            const n = parseNumber(text);
            if (!revert && n !== null && !check(n) && fmtNumber(n, digits) !== shown) {
              onChange(snap(clamp(n / scale)));
            }
            setFocused(false);
            setError(null);
            setText(shown);
            endCoalesce();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              revertRef.current = true;
              e.currentTarget.blur();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const base = parseNumber(text);
              const cur = base === null ? value : base / scale;
              const next = snap(clamp(cur + (e.key === "ArrowUp" ? step : -step)));
              setText(fmtNumber(next * scale, digits));
              setError(null);
              onChange(next);
            }
          }}
        />
        {unit && <span className="w-4 shrink-0 text-meta text-[var(--text-muted)]">{unit}</span>}
      </div>
    </Field>
  );
}

export function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
  onClear,
  hint,
  disabled = false,
}: {
  id: string;
  label: ReactNode;
  value: string | null;
  fallback: string;
  onChange: (value: string) => void;

  onClear?: () => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useT();
  const { endCoalesce } = useEditor();

  const hex = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          className="input w-12 shrink-0 cursor-pointer p-1"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={endCoalesce}
        />
        <span className="min-w-0 flex-1 truncate text-meta tabular-nums text-[var(--text-muted)]">
          {value ?? t("editor.inspector2.color-default")}
        </span>
        {onClear && value !== null && (
          <button
            type="button"
            className="text-meta text-[var(--text-muted)] underline-offset-2 hover:underline"
            disabled={disabled}
            onClick={onClear}
          >
            {t("editor.inspector2.color-clear")}
          </button>
        )}
      </div>
    </Field>
  );
}

export function ReadOnlyRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="label mb-0">{label}</span>
      <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}
