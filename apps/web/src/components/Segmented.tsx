"use client";

import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;

  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  size = "sm",
  className = "",
}: {

  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  disabled?: boolean;

  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={`seg ${size === "md" ? "seg-md" : ""} ${className}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          title={opt.title}
          disabled={disabled || opt.disabled}
          onClick={() => onChange(opt.value)}
          className="seg-item"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
