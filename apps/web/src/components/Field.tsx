"use client";

import type { ReactNode } from "react";
import { InfoHint } from "@/components/InfoHint";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  hintKeys,
  required = false,
  children,
  className = "",
}: {
  label: ReactNode;

  htmlFor?: string;

  hint?: ReactNode;

  error?: string | null;

  hintKeys?: { titleKey: string; bodyKey: string };
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <span className="mb-1 flex items-center gap-1">
        <Label className="label mb-0" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="ml-0.5 text-[var(--danger)]" aria-hidden="true">
              {"*"}
            </span>
          )}
        </Label>
        {hintKeys && (
          <InfoHint titleKey={hintKeys.titleKey} bodyKey={hintKeys.bodyKey} />
        )}
      </span>

      {children}

      {error && <p className="mt-1 text-meta text-[var(--danger)]">{error}</p>}
      {hint && <p className="mt-1 text-meta text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export function SwitchField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  hintKeys,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hintKeys?: { titleKey: string; bodyKey: string };
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="flex items-center gap-1">
          <label
            id={`${id}-label`}
            htmlFor={id}
            className={`text-sm font-medium ${
              disabled ? "opacity-50" : "cursor-pointer"
            }`}
          >
            {label}
          </label>
          {hintKeys && (
            <InfoHint titleKey={hintKeys.titleKey} bodyKey={hintKeys.bodyKey} />
          )}
        </span>
        {hint && (
          <p className="mt-0.5 text-meta text-[var(--text-muted)]">{hint}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}

        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`switch mt-0.5 ${disabled ? "opacity-50" : ""}`}
      />
    </div>
  );
}

export function CheckboxField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  hintKeys,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hintKeys?: { titleKey: string; bodyKey: string };
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="checkbox mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="min-w-0">
        <span className="flex items-center gap-1">
          <label
            htmlFor={id}
            className={`text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}
          >
            {label}
          </label>
          {hintKeys && (
            <InfoHint titleKey={hintKeys.titleKey} bodyKey={hintKeys.bodyKey} />
          )}
        </span>
        {hint && (
          <p className="mt-0.5 text-meta text-[var(--text-muted)]">{hint}</p>
        )}
      </div>
    </div>
  );
}
