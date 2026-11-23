"use client";

import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function OptionCardGroup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;

  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-2 ${className || "grid-cols-[repeat(auto-fit,minmax(160px,1fr))]"}`}
    >
      {children}
    </div>
  );
}

export function OptionCard({
  selected,
  onSelect,
  title,
  titleText,
  description,
  icon: Icon,
  badge,
  disabled = false,
  className = "",
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;

  titleText?: string;

  description?: ReactNode;
  icon?: LucideIcon;

  badge?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`option-card ${className}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {Icon && (
          <Icon
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold"
          title={titleText ?? (typeof title === "string" ? title : undefined)}
        >
          {title}
        </span>
        {badge}

        {selected && (
          <Check
            size={15}
            strokeWidth={2.5}
            className="shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
        )}
      </span>
      {description && (
        <span className="text-meta text-[var(--text-muted)]">{description}</span>
      )}
    </button>
  );
}
