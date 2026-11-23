"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {

  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel flex min-w-0 flex-col gap-2 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {title && (
            <h3 className="min-w-0 text-meta font-semibold">{title}</h3>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
