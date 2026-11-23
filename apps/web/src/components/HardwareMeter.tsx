"use client";

import { useEffect, useRef, useState } from "react";
import { getMetrics, type Metrics } from "@/lib/api";
import { useT } from "@/lib/i18n";

const POLL_MS = 2_000;

const HOT_PERCENT = 85;

function Meter({
  label,
  percent,
  title,
}: {
  label: string;
  percent: number;
  title: string;
}) {
  const hot = percent >= HOT_PERCENT;
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="text-xs font-medium text-[var(--text-muted)]">
        {label}
      </span>

      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--border)]">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(2, Math.min(100, percent))}%`,
            background: hot ? "var(--danger)" : "var(--primary)",
          }}
        />
      </span>
      <span
        className="w-8 text-right font-mono text-xs tabular-nums"
        style={hot ? { color: "var(--danger)" } : undefined}
      >
        {percent}%
      </span>
    </span>
  );
}

export function HardwareMeter() {
  const { t, tf } = useT();
  const [data, setData] = useState<Metrics | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;

    const tick = async () => {

      if (document.visibilityState !== "visible") return;
      try {
        const m = await getMetrics();
        if (alive) setData(m);
      } catch {

      }
    };

    const start = () => {
      if (timer.current) return;
      void tick();
      timer.current = setInterval(() => void tick(), POLL_MS);
    };
    const stop = () => {
      if (!timer.current) return;
      clearInterval(timer.current);
      timer.current = null;
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!data) return null;

  const gpu = data.gpu;
  const vram =
    gpu.vramUsedMb !== null && gpu.vramTotalMb !== null
      ? tf("meter.vram", {
          used: String(Math.round(gpu.vramUsedMb / 102.4) / 10),
          total: String(Math.round(gpu.vramTotalMb / 102.4) / 10),
        })
      : "";

  return (

    <div className="hidden items-center gap-3 lg:flex">
      <Meter
        label={t("meter.cpu")}
        percent={data.cpu.percent}
        title={tf("meter.cpu-title", {
          model: data.cpu.model || t("meter.unknown"),
          threads: String(data.cpu.threads),
        })}
      />
      {gpu.available && gpu.percent !== null && (
        <Meter
          label={t("meter.gpu")}
          percent={gpu.percent}
          title={`${gpu.name ?? t("meter.unknown")}${vram ? ` · ${vram}` : ""}`}
        />
      )}
    </div>
  );
}
