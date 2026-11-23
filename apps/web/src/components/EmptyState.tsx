import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;

  title?: string;
  description: string;
  action?: ReactNode;
}) {
  return (

    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon
        size={22}
        strokeWidth={1.5}
        className="text-[var(--text-muted)] opacity-40"
        aria-hidden="true"
      />
      {title && <p className="text-sm font-medium">{title}</p>}

      <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
