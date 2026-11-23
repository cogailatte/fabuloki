"use client";

import type { ReactNode } from "react";
import { InfoHint } from "@/components/InfoHint";

export function Card({
  title,
  hint,
  actions,
  children,
  className = "",
}: {

  title?: ReactNode;

  hint?: { titleKey: string; bodyKey: string };
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>

      {(title || hint || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {(title || hint) && (
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              {title && <span className="min-w-0">{title}</span>}
              {hint && (
                <InfoHint
                  titleKey={hint.titleKey}
                  bodyKey={hint.bodyKey}
                  size={14}
                />
              )}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
