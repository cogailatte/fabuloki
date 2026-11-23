"use client";

import { AlertTriangle, Palette, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getVideoStyles, type VideoStyle } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { ErrorBanner } from "@/components/ErrorBanner";
import { OptionCard, OptionCardGroup } from "@/components/OptionCard";
import { Panel } from "@/components/Panel";
import { VideoStylePreview } from "@/components/VideoStylePreview";
import { Skeleton } from "@/components/Skeleton";
import { useT } from "@/lib/i18n";

function nameOf(s: VideoStyle): string {
  return s.name;
}

function descOf(s: VideoStyle, t: (k: string) => string): string {
  const key = `vstyle.${s.id}.desc`;
  const v = t(key);

  return v === key ? s.motion : v;
}

export function VideoStyleSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [styles, setStyles] = useState<VideoStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    getVideoStyles()
      .then((list) => {
        if (!alive) return;
        setStyles(list);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setStyles([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => styles ?? [], [styles]);
  const q = query.trim().toLowerCase();

  const filtered = q
    ? list.filter(
        (s) =>
          nameOf(s).toLowerCase().includes(q) ||
          descOf(s, t).toLowerCase().includes(q) ||
          s.id.includes(q)
      )
    : list;

  const selected = list.find((s) => s.id === value) ?? null;

  const missing = value !== null && list.length > 0 && !selected;

  return (
    <div className="flex flex-col gap-2">
      {error && <ErrorBanner message={t("vstyle.load-error")} detail={error} />}

      <Panel>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 text-meta text-[var(--text-muted)]">
            {t("vstyle.selected")}
          </span>
          {selected ? (
            <>
              <span className="min-w-0 text-sm font-semibold text-[var(--primary)]">
                {nameOf(selected)}
              </span>
              {selected.palette === "loose" && (
                <Badge
                  tone="danger"
                  dot={false}
                  label={t("vstyle.loose-badge")}
                />
              )}
            </>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-2 text-sm text-[var(--text-muted)]">
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0" />
              {t("vstyle.none")}
            </span>
          )}
        </div>
      </Panel>

      {selected && <VideoStylePreview id={selected.id} name={selected.name} motion={selected.motion} />}

      {missing && <Banner tone="danger" message={t("vstyle.missing")} />}

      {value === null && !missing && (
        <Banner tone="danger" message={t("vstyle.none-warning")} />
      )}

      {list.length > 8 && (
        <div className="relative">
          <Search
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            className="input pl-8"
            value={query}
            disabled={disabled}
            aria-label={t("vstyle.search")}
            placeholder={t("vstyle.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {styles === null ? (
        <Skeleton className="w-full" height={220} />
      ) : (
        <Panel className="max-h-[300px] overflow-y-auto">

          <OptionCardGroup
            label={t("vstyle.label")}
            className="grid-cols-1 sm:grid-cols-2"
          >
            {filtered.map((s) => (
              <OptionCard
                key={s.id}
                selected={value === s.id}
                disabled={disabled}
                title={nameOf(s)}
                description={descOf(s, t)}
                badge={
                  s.palette === "loose" ? (
                    <Badge
                      tone="danger"
                      dot={false}
                      label={t("vstyle.loose-badge")}
                    />
                  ) : undefined
                }
                onSelect={() => onChange(s.id)}
              />
            ))}
          </OptionCardGroup>
          {filtered.length === 0 && q && (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              {t("vstyle.no-match")}
            </p>
          )}
        </Panel>
      )}

      <p className="flex items-start gap-2 text-meta text-[var(--text-muted)]">
        <Palette size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
        {t("vstyle.vs-style-design")}
      </p>
    </div>
  );
}
