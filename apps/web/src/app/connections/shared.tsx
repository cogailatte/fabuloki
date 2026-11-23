"use client";

import { Check, type LucideIcon } from "lucide-react";

export type ErrorReporter = (
  key: string,
  err: { message: string; detail?: string } | null
) => void;

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="py-4 first:pt-0 last:pb-0">{children}</div>;
}

export function CardIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--bg-subtle)]">
      <Icon size={16} strokeWidth={1.75} className="text-[var(--primary)]" />
    </span>
  );
}

export function SavedNotice({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-meta font-medium text-[var(--success)]">
      <Check size={13} strokeWidth={2} className="shrink-0" />
      {children}
    </span>
  );
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
