"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
}: {
  label: string;
  value: ReactNode;

  sub?: ReactNode;
  icon?: LucideIcon;

  href?: string;
}) {
  const body = (
    <>

      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[28px] leading-tight font-bold tabular-nums">
          {value}
        </p>
        {Icon && (
          <Icon
            size={18}
            strokeWidth={1.75}
            className="mt-1 shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
        )}
      </div>
      <p className="mt-1 text-sm font-medium">{label}</p>
      {sub && <p className="text-meta text-[var(--text-muted)]">{sub}</p>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="card transition-colors duration-150 hover:border-[var(--text-muted)]"
      >
        {body}
      </Link>
    );
  }
  return <div className="card">{body}</div>;
}
