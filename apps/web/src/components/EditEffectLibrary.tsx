"use client";

import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Panel } from "@/components/Panel";
import { getEditEffects, type EditEffect } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function EditEffectLibrary({
  selected,
  onSelect,
  disabled = false,
}: {
  selected?: string | null;
  onSelect?: (id: string) => void;
  disabled?: boolean;
}) {
  const { lang } = useT();
  const vi = lang === "vi";
  const [effects, setEffects] = useState<EditEffect[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    getEditEffects().then(
      (items) => { if (active) setEffects(items); },
      (reason: unknown) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, []);

  const term = query.trim().toLocaleLowerCase();
  const visible = effects?.filter((effect) =>
    `${effect.name} ${effect.id} ${effect.use}`.toLocaleLowerCase().includes(term),
  );

  return (
    <div className="flex flex-col gap-4">
      <input
        className="input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={vi ? "Tìm hiệu ứng" : "Find effects"}
        placeholder={vi ? "Tìm theo tên hoặc cách dùng…" : "Search by name or use…"}
      />
      {error && <ErrorBanner message={vi ? "Không tải được thư viện" : "Could not load effects"} detail={error} />}
      {!effects && !error && <p role="status">{vi ? "Đang tải hiệu ứng…" : "Loading effects…"}</p>}
      {visible?.length === 0 && <p role="status">{vi ? "Không tìm thấy hiệu ứng." : "No matching effects."}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible?.map((effect) => (
          <Panel key={effect.id} className={selected === effect.id ? "border-[var(--primary)]" : ""}>
            <Clapperboard aria-hidden="true" size={18} className="text-[var(--primary-ink)]" />
            <h3 className="text-sm font-semibold">{effect.name}</h3>
            <p className="text-meta text-[var(--text-muted)]">{effect.use} · {effect.duration}</p>
            <p className="text-meta"><strong>{vi ? "Dữ liệu cần" : "Inputs"}</strong> · {effect.inputs}</p>
            {onSelect && (
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button
                  small
                  variant={selected === effect.id ? "primary" : "secondary"}
                  disabled={disabled}
                  onClick={() => onSelect(effect.id)}
                >
                  {selected === effect.id ? (vi ? "Đã chọn" : "Selected") : (vi ? "Chọn hiệu ứng" : "Select effect")}
                </Button>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
