"use client";

import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  Smartphone,
  Upload,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getProject, uploadOrigin } from "@/lib/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { ProgressBar } from "@/components/ProgressBar";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";

interface UploadItem {
  key: string;
  name: string;
  size: number;

  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

class UploadError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "UploadError";
    this.code = code;
  }
}

function uploadOne(
  projectId: string,
  token: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const url =
      `${uploadOrigin()}/api/assets` +
      (token ? `?k=${encodeURIComponent(token)}` : "");
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `HTTP ${xhr.status}`;
      let code = String(xhr.status);
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: { code?: string; message?: string };
        };
        if (body?.error?.message) message = body.error.message;
        if (body?.error?.code) code = body.error.code;
      } catch {

      }
      reject(new UploadError(message, code));
    };
    xhr.onerror = () => reject(new Error("network"));
    const form = new FormData();

    form.append("scope", "project");
    form.append("projectId", projectId);
    if (token) form.append("token", token);
    form.append("file", file);
    xhr.send(form);
  });
}

export default function MobileUploadPage() {
  const { t } = useT();
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";

  const [uploadToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("k") ?? ""
  );

  const [projectName, setProjectName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);

  const pickRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    getProject(projectId)
      .then((p) => {
        if (alive) setProjectName(p.name);
      })
      .catch((e: unknown) => {
        if (!alive) return;

        if (e instanceof ApiError && e.status === 401) setExpired(true);
        setNotFound(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const updateItem = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((list) =>
      list.map((it) => (it.key === key ? { ...it, ...patch } : it))
    );
  }, []);

  const enqueue = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setItems((list) => [
          ...list,
          {
            key,
            name: file.name,
            size: file.size,
            progress: 0,
            status: "uploading",
          },
        ]);
        queueRef.current = queueRef.current.then(() =>
          uploadOne(projectId, uploadToken, file, (pct) =>
            updateItem(key, { progress: pct })
          )
            .then(() => updateItem(key, { progress: 100, status: "done" }))
            .catch((e: unknown) =>
              updateItem(key, {
                status: "error",
                error:
                  e instanceof UploadError && e.code === "UPLOAD_TOKEN_INVALID"
                    ? t("m.expired")
                    : e instanceof Error
                      ? e.message
                      : String(e),
              })
            )
        );
      }
    },
    [projectId, uploadToken, updateItem, t]
  );

  const uploadingCount = items.filter((i) => i.status === "uploading").length;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col gap-4 p-4">

      <header className="flex items-center gap-2 pt-2">
        <Smartphone
          size={20}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--primary)]"
        />
        <div className="min-w-0">
          <p className="t-eyebrow">{t("m.title")}</p>
          <h1 className="truncate text-xl font-semibold">
            {notFound ? projectId : (projectName ?? t("common.loading"))}
          </h1>
        </div>
      </header>

      {notFound ? (
        <Banner tone="danger" message={t(expired ? "m.expired" : "m.not-found")} />
      ) : (
        <>

          <input
            ref={pickRef}
            type="file"
            accept="video/*,image/*,audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />

          <input
            ref={captureRef}
            type="file"
            accept="video/*,image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />

          <Button
            onClick={() => pickRef.current?.click()}
            className="h-16 w-full gap-3 rounded-[var(--radius-lg)] font-semibold"
          >
            <Upload size={20} strokeWidth={2} />
            {t("m.choose")}
          </Button>

          <Button
            variant="secondary"
            onClick={() => captureRef.current?.click()}
            className="h-12 w-full rounded-[var(--radius-lg)]"
          >
            <Camera size={17} strokeWidth={2} />
            {t("m.capture")}
          </Button>

          <p className="text-center text-meta text-[var(--text-muted)]">
            {t("m.hint")}
          </p>

          <p className="text-center text-meta font-medium text-[var(--danger)]">
            {t("m.keep-awake")}
          </p>

          {items.length === 0 ? (
            <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
              {t("m.empty")}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3">
              {items.map((it) => (
                <div key={it.key} className="flex flex-col gap-1 py-3">
                  <div className="flex items-center gap-2">
                    {it.status === "done" ? (
                      <Check
                        size={16}
                        strokeWidth={2.5}
                        className="shrink-0 text-[var(--success)]"
                      />
                    ) : it.status === "uploading" ? (
                      <Loader2
                        size={16}
                        strokeWidth={2}
                        className="shrink-0 animate-spin text-[var(--primary)]"
                      />
                    ) : (
                      <AlertCircle
                        size={16}
                        strokeWidth={2}
                        className="shrink-0 text-[var(--danger)]"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {it.name}
                    </span>
                    <span className="shrink-0 text-meta tabular-nums text-[var(--text-muted)]">
                      {formatBytes(it.size)}
                    </span>
                  </div>
                  {it.status === "uploading" && (
                    <ProgressBar progress={it.progress} />
                  )}
                  {it.status === "error" && (
                    <p className="text-meta text-[var(--danger)]">
                      {t("m.error")}: {it.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {uploadingCount > 0 && (
            <p className="text-center text-meta text-[var(--text-muted)]">
              {t("m.uploading")}
            </p>
          )}
        </>
      )}
    </main>
  );
}
