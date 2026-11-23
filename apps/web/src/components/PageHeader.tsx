import type { ReactNode } from "react";
import { InfoHint } from "@/components/InfoHint";

export function PageHeader({
  title,
  hint,
  subtitle,
  center,
  actions,
}: {
  title: ReactNode;

  hint?: { titleKey: string; bodyKey: string };
  subtitle?: ReactNode;

  center?: ReactNode;
  actions?: ReactNode;
}) {
  return (

    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold">
          <span className="min-w-0">{title}</span>
          {hint && (
            <InfoHint
              titleKey={hint.titleKey}
              bodyKey={hint.bodyKey}
              size={15}
            />
          )}
        </h1>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {(subtitle || center) && (
        <div className="mt-1 flex flex-wrap items-center gap-y-2">
          {subtitle && (
            <p
              className={`shrink-0 text-sm text-[var(--text-muted)] ${
                center ? "xl:basis-[calc(100%/3)]" : ""
              }`}
            >
              {subtitle}
            </p>
          )}

          {center && <div className="min-w-64 max-w-full flex-1">{center}</div>}
        </div>
      )}
    </div>
  );
}
