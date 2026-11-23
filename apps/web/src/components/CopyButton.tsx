"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/lib/i18n";

const RESET_MS = 1500;

export function CopyButton({
  value,
  label,
  size = "md",
}: {
  value: string;

  label?: string;
  size?: "sm" | "md";
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), RESET_MS);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {

    }
  }

  return (
    <IconButton
      label={copied ? t("common.copied") : (label ?? t("common.copy"))}
      size={size}
      onClick={copy}
    >
      {copied ? (
        <Check
          size={size === "sm" ? 13 : 15}
          strokeWidth={2.5}
          className="text-[var(--success)]"
        />
      ) : (
        <Copy size={size === "sm" ? 13 : 15} strokeWidth={2} />
      )}
    </IconButton>
  );
}
