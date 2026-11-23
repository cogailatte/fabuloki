"use client";

import { useEffect, useState } from "react";
import { getAutoTrimReport, type AutoTrimReport } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { AUTO_CUT_LEVEL_LABEL } from "@/components/BriefFields";
import { formatDurationMs, formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-meta text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function sec(value: number | null): string {
  return formatDurationMs(value === null ? null : value * 1000);
}

export function ProjectAutoTrimCard({
  projectId,
  version,
}: {
  projectId: string;

  version?: string;
}) {
  const { t, tf } = useT();
  const [report, setReport] = useState<AutoTrimReport | null>(null);

  useEffect(() => {
    let alive = true;

    getAutoTrimReport(projectId, version).then((r) => {
      if (alive) setReport(r);
    });
    return () => {
      alive = false;
    };
  }, [projectId, version]);

  if (!report) return null;

  const pass = report.verdict === "pass";
  const levelLabel = AUTO_CUT_LEVEL_LABEL[report.level]
    ? t(AUTO_CUT_LEVEL_LABEL[report.level])
    : report.level;

  return (
    <Card
      title={t("autotrim.title")}
      actions={
        <Badge
          tone={pass ? "success" : "danger"}
          label={pass ? t("autotrim.verdict-pass") : t("autotrim.verdict-fail")}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-meta text-[var(--text-muted)]">
          {tf("autotrim.trimmed-at", { time: formatRelative(report.createdAt) })}
        </p>

        <Row
          label={t("autotrim.duration")}
          value={tf("autotrim.duration-value", {
            before: sec(report.duration.beforeSec),
            after: sec(report.duration.afterSec),
          })}
        />
        <Row
          label={t("autotrim.removed")}
          value={tf("autotrim.removed-value", {
            total: sec(report.duration.removedSec),
            ranges: report.removed.ranges,
          })}
        />

        <Row
          label={t("autotrim.removed-split")}
          value={tf("autotrim.removed-split-value", {
            silence: sec(report.removed.silenceSec),
            approved: sec(report.removed.approvedSec),
          })}
        />
        <Row
          label={t("autotrim.level")}
          value={tf("autotrim.level-value", {
            level: levelLabel,
            db: report.threshold.db,
          })}
        />
        <Row
          label={t("autotrim.residual")}
          value={tf("autotrim.residual-value", {
            total: sec(report.verification.totalSilenceSec),
            longest: sec(report.verification.longest),
          })}
        />

        {!pass && (
          <div className="mt-1">

            <Banner
              tone="danger"
              message={
                report.verification.reason ?? t("autotrim.fail-no-reason")
              }
            />
          </div>
        )}
      </div>
    </Card>
  );
}
