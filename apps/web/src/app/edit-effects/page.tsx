"use client";

import { EditEffectLibrary } from "@/components/EditEffectLibrary";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";

export default function EditEffectsPage() {
  const { t, lang } = useT();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.edit-effects")}
        subtitle={lang === "vi"
          ? "Xem cách dùng từng hiệu ứng."
          : "Browse effects and their inputs."}
      />
      <p className="text-meta text-[var(--text-muted)]">{lang === "vi" ? "Gán hiệu ứng cho từng clip hoặc ảnh trong Nguồn & tài nguyên của dự án." : "Assign effects per clip or image in the project source list."}</p>
      <EditEffectLibrary />
    </div>
  );
}
