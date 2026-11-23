"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "destructive";

export function LinkButton({
  href,
  variant = "secondary",
  small = false,
  external = false,
  download = false,
  children,
  className = "",
  ...rest
}: {
  href: string;
  variant?: Variant;
  small?: boolean;

  external?: boolean;

  download?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const cls = `btn btn-${variant} ${small ? "btn-sm" : ""} ${className}`;

  if (external || download) {
    return (
      <a
        href={href}
        className={cls}
        download={download || undefined}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}
