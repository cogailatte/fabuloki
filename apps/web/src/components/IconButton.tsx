"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  label,
  size = "md",
  tone = "default",
  children,
  className = "",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {

  label: string;
  size?: "sm" | "md";

  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${size === "sm" ? "icon-btn-sm" : ""} ${
        tone === "danger" ? "icon-btn-danger" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
