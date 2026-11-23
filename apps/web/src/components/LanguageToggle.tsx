"use client";

import { IconButton } from "@/components/IconButton";
import { useT } from "@/lib/i18n";

export function LanguageToggle() {
  const { lang, setLang } = useT();
  const next = lang === "vi" ? "en" : "vi";
  const title = lang === "vi" ? "Switch to English" : "Chuyển sang tiếng Việt";

  return (
    <IconButton label={title} onClick={() => setLang(next)}>

      <img
        src={lang === "vi" ? "/flags/vn.svg" : "/flags/gb.svg"}
        alt={lang === "vi" ? "Tiếng Việt" : "English"}
        width={20}
        height={14}
        className="h-[14px] w-5 rounded-[2px] border border-[var(--border)] object-cover"
      />
    </IconButton>
  );
}
