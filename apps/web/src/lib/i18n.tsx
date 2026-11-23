"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setFormatLang } from "@/lib/format";
import { vi } from "@/lib/locales/vi";
import { en } from "@/lib/locales/en";

export type Lang = "vi" | "en";

const STORAGE_KEY = "fabuloki-lang";

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("vi");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "vi") setLangState(saved);
    } catch {

    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {

    }
  }, []);

  setFormatLang(lang);

  const t = useCallback(
    (key: string): string =>
      lang === "en" ? (en[key] ?? vi[key] ?? key) : (vi[key] ?? key),
    [lang]
  );

  const tf = useCallback(
    (key: string, vars: Record<string, string | number>): string =>

      t(key).replace(/\{(\w+)\}/g, (m, k: string) =>
        Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m
      ),
    [t]
  );

  const value = useMemo(
    () => ({ lang, setLang, t, tf }),
    [lang, setLang, t, tf]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within <LanguageProvider>");
  return ctx;
}
