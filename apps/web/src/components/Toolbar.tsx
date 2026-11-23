"use client";

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/lib/i18n";

export function Toolbar({
  search,
  selectedCount = 0,
  bulkActions,
  onClearSelection,
  actions,
  children,
}: {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
  };

  selectedCount?: number;
  bulkActions?: ReactNode;
  onClearSelection?: () => void;

  actions?: ReactNode;

  children?: ReactNode;
}) {
  const { t } = useT();
  const selecting = selectedCount > 0;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2">

      {selecting && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {selectedCount} {t("common.selected")}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions}
            {onClearSelection && (
              <Button variant="secondary" small onClick={onClearSelection}>
                <X size={14} strokeWidth={2} aria-hidden="true" />
                {t("common.deselect")}
              </Button>
            )}
          </div>
        </div>
      )}

      {(search || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {search && (
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search
                  size={15}
                  strokeWidth={2}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  className="input h-8 pl-8"
                  value={search.value}
                  placeholder={search.placeholder}
                  aria-label={search.placeholder}
                  onChange={(e) => search.onChange(e.target.value)}
                />
                {search.value && (
                  <IconButton
                    label={t("common.clear")}
                    size="sm"
                    onClick={() => search.onChange("")}
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                  >
                    <X size={13} strokeWidth={2} />
                  </IconButton>
                )}
              </div>
            )}
            {actions && (
              <div className="ml-auto flex items-center gap-2">{actions}</div>
            )}
          </div>
      )}

      {children && (
        <div className="flex flex-wrap items-center gap-1">{children}</div>
      )}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`chip transition-colors duration-150 ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
          : "hover:border-[var(--text-muted)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}
