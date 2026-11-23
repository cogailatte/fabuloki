"use client";

import { useEffect, useState } from "react";
import { getStyles, type StyleDesign, type StylesResponse } from "@/lib/api";
import { useT } from "@/lib/i18n";

let stylesCache: StylesResponse | null = null;
let stylesPromise: Promise<StylesResponse> | null = null;

export function refreshStyles(): void {
  stylesCache = null;
  stylesPromise = null;
}

export function useStyles(): {
  data: StylesResponse | null;
  error: string | null;
} {
  const [data, setData] = useState<StylesResponse | null>(stylesCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stylesCache) return;
    let alive = true;
    if (!stylesPromise) {
      stylesPromise = getStyles().then((r) => {
        stylesCache = r;
        return r;
      });
    }
    stylesPromise
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((e) => {

        stylesPromise = null;
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { data, error };
}

export function styleOptionLabel(s: StyleDesign): string {
  const tags = s.tags.slice(0, 3).join(", ");
  const more = s.tags.length > 3 ? "…" : "";
  return tags ? `${s.name} - ${tags}${more}` : s.name;
}

export function styleDisplayName(
  data: StylesResponse | null,
  styleId: string | null,
  t: (key: string) => string
): string {
  const defaultStyle =
    data?.styles.find((s) => s.id === data.defaultId) ?? null;
  if (styleId === null) {
    return defaultStyle
      ? `${t("styles.default")} (${defaultStyle.name})`
      : t("styles.default");
  }
  return data?.styles.find((s) => s.id === styleId)?.name ?? styleId;
}

export function StyleSelect({
  id,
  value,
  onChange,
  disabled = false,
  className = "input",
}: {
  id?: string;
  value: string | null;
  onChange: (styleId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const { data } = useStyles();
  const styles = data?.styles ?? [];
  const defaultStyle = styles.find((s) => s.id === data?.defaultId) ?? null;
  const missing = value !== null && !styles.some((s) => s.id === value);

  return (
    <select
      id={id}
      className={className}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">
        {defaultStyle
          ? `${t("styles.default")} (${defaultStyle.name})`
          : t("styles.default")}
      </option>
      {missing && <option value={value!}>{value}</option>}
      {styles.map((s) => (
        <option key={s.id} value={s.id}>
          {styleOptionLabel(s)}
        </option>
      ))}
    </select>
  );
}
