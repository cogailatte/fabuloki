"use client";

import { ExternalLink, FolderOpen, Loader2, Maximize2 } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { encodeMediaPath, mediaUrl, revealFile, type FileInfo } from "@/lib/api";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

export function canPreview(kind: FileInfo["kind"]): boolean {
  return kind === "image" || kind === "video" || kind === "audio";
}

export function imageFileInfo(
  relPath: string,
  opts: { name?: string; version?: string } = {},
): FileInfo {
  return {
    name: opts.name ?? relPath.split("/").pop() ?? relPath,
    relPath,
    size: 0,
    mtime: opts.version ?? "",
    kind: "image",
  };
}

export function ZoomableThumb({
  file,
  alt,
  onOpen,
  className = "",
  imgClassName = "h-full w-full object-contain",
  iconSize = 16,
}: {
  file: FileInfo;
  alt: string;
  onOpen: (file: FileInfo) => void;

  className?: string;

  imgClassName?: string;
  iconSize?: number;
}) {
  const { t } = useT();
  const url =
    mediaUrl(encodeMediaPath(file.relPath)) +
    (file.mtime ? `?v=${encodeURIComponent(file.mtime)}` : "");
  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      title={t("media.zoom-title")}
      aria-label={t("media.zoom-title")}
      className={`group relative block cursor-zoom-in overflow-hidden ${className}`}
    >

      <img src={url} alt={alt} className={imgClassName} />

      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <Maximize2 size={iconSize} strokeWidth={2} className="text-white" />
      </span>
    </button>
  );
}

export function RevealButton({
  relPath,
  onError,
  small = true,
  className = "",
}: {
  relPath: string;
  onError: (message: string) => void;

  small?: boolean;
  className?: string;
}) {
  const { t, tf } = useT();
  const [busy, setBusy] = useState(false);
  async function onClick(e: MouseEvent<HTMLButtonElement>) {

    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await revealFile(relPath);
    } catch (err) {
      onError(
        tf("media.reveal-error", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="secondary"
      small={small}
      className={className}
      disabled={busy}
      onClick={onClick}
      title={t("media.reveal-title")}
      aria-label={tf("media.reveal-aria", { path: relPath })}
    >
      {busy ? (
        <Loader2 size={14} strokeWidth={2} className="animate-spin" />
      ) : (
        <FolderOpen size={14} strokeWidth={2} />
      )}
      {t("common.open-file")}
    </Button>
  );
}

export function MediaPreviewModal({
  file,
  onClose,
}: {
  file: FileInfo | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [file?.relPath]);

  if (!file) return null;

  const url = mediaUrl(encodeMediaPath(file.relPath)) + `?v=${encodeURIComponent(file.mtime)}`;

  return (
    <Modal
      wide
      open
      title={file.name}
      onClose={onClose}
      footer={

        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <RevealButton relPath={file.relPath} small={false} onError={setError} />

          <Button
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={14} strokeWidth={2} />
            {t("media.open-tab")}
          </Button>
        </>
      }
    >

      {error && <ErrorBanner message={error} />}

      {file.kind === "image" ? (

        <img
          src={url}
          alt={file.name}
          className="mx-auto max-h-[66vh] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)] object-contain"
        />
      ) : file.kind === "video" ? (
        <video
          controls
          autoPlay
          src={url}
          className="mx-auto max-h-[66vh] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
        />
      ) : file.kind === "audio" ? (
        <audio controls autoPlay src={url} className="w-full" />
      ) : (

        <p className="text-sm text-[var(--text-muted)]">
          {t("media.no-preview")}{" "}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[var(--primary)] hover:underline"
          >
            {t("media.open-direct")}
          </a>
        </p>
      )}

      <p className="break-all text-meta text-[var(--text-muted)]">
        {file.relPath}
      </p>
    </Modal>
  );
}
