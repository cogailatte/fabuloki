"use client";

export function Skeleton({
  className = "",
  height,
}: {
  className?: string;

  height?: number;
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={height ? { height } : undefined}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </>
  );
}
