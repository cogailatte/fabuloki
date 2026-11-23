"use client";

import { Download, Loader2, Megaphone, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createPublishPack,
  createSubtitles,
  getPublishPack,
  subtitleDownloadUrl,
  type PublishItem,
  type PublishPack,
  type PublishPlatform,
} from "@/lib/api";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LinkButton } from "@/components/LinkButton";
import { CopyButton } from "@/components/CopyButton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Panel } from "@/components/Panel";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

const PLATFORM_LABEL: Record<PublishPlatform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
};

function PlatformBlock({ item }: { item: PublishItem }) {
  const { t } = useT();
  const hashtagLine = item.hashtags.join(" ");
  return (
    <Panel
      title={PLATFORM_LABEL[item.platform] ?? item.platform}
      actions={
        <CopyButton
          value={item.title}
          label={t("publish.copy-title")}
          size="sm"
        />
      }
    >
      <p className="text-sm font-semibold">{item.title}</p>

      <div className="flex flex-wrap items-start justify-between gap-2">

        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
          {item.description}
        </p>
        <CopyButton
          value={item.description}
          label={t("publish.copy-desc")}
          size="sm"
        />
      </div>

      {item.hashtags.length > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {item.hashtags.map((tag) => (
              <Badge key={tag} tone="muted" dot={false} label={tag} />
            ))}
          </div>
          <CopyButton
            value={hashtagLine}
            label={t("publish.copy-tags")}
            size="sm"
          />
        </div>
      )}
    </Panel>
  );
}

export function ProjectPublishCard({
  projectId,
  version,
}: {
  projectId: string;

  version?: string;
}) {
  const { t, tf } = useT();
  const [pack, setPack] = useState<PublishPack | null>(null);
  const [cues, setCues] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const [noTranscript, setNoTranscript] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const res = await getPublishPack(projectId);
      setPack(res.pack);
    } catch (e) {
      setError({
        message: t("publish.load-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
    }

  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onGenerate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNoTranscript(false);
    try {
      const { pack: fresh } = await createPublishPack(projectId);
      setPack(fresh);

      try {
        const sub = await createSubtitles(projectId);
        setCues(sub.cues);
      } catch {
        setCues(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "NO_TRANSCRIPT") {
        setNoTranscript(true);
      } else {
        setError({
          message: t("publish.error"),
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const transcriptName = pack?.transcriptRel.split(/[\\/]/).pop() ?? null;

  const generateButton = (
    <Button small onClick={onGenerate} disabled={busy}>
      {busy ? (
        <>
          <Loader2 size={14} strokeWidth={2} className="animate-spin" />
          {t("publish.generating")}
        </>
      ) : (
        <>
          <Sparkles size={14} strokeWidth={2} />
          {pack ? t("publish.regenerate") : t("publish.generate")}
        </>
      )}
    </Button>
  );

  return (
    <Card
      title={t("publish.title")}
      hint={{ titleKey: "help.publish.title", bodyKey: "help.publish.body" }}
      actions={generateButton}
    >
      {error && <ErrorBanner message={error.message} detail={error.detail} />}

      {noTranscript && (
        <div className="mb-3">
          <Banner tone="muted" message={t("publish.no-transcript")} />
        </div>
      )}

      {!pack ? (
        !busy && (
          <EmptyState
            icon={Megaphone}
            description={t("publish.empty")}
            action={generateButton}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-[var(--text-muted)]">
            <span>
              {tf("publish.generated-at", {
                time: formatRelative(pack.generatedAt),
              })}
            </span>
            {transcriptName && (
              <span className="max-w-full truncate" title={pack.transcriptRel}>
                {tf("publish.from-transcript", { file: transcriptName })}
              </span>
            )}
          </div>

          {pack.items.map((item) => (
            <PlatformBlock key={item.platform} item={item} />
          ))}

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            <span className="text-sm font-medium">
              {t("publish.subtitles")}
            </span>
            <LinkButton
              small
              download
              href={subtitleDownloadUrl(projectId, "srt", version)}
            >
              <Download size={14} strokeWidth={2} aria-hidden="true" />
              {t("publish.download-srt")}
            </LinkButton>
            <LinkButton
              small
              download
              href={subtitleDownloadUrl(projectId, "vtt", version)}
            >
              <Download size={14} strokeWidth={2} aria-hidden="true" />
              {t("publish.download-vtt")}
            </LinkButton>
            {cues !== null && (
              <span className="text-meta text-[var(--text-muted)]">
                {tf("publish.cues", { n: cues })}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
