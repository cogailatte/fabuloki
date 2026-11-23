"use client";

import { Player, type ErrorFallback, type PlayerRef } from "@remotion/player";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { Assemble } from "@engine/Assemble";
import { rawSceneDurationFrames } from "@engine/duration";
import {
  manifestSchema,
  resolveSceneDurationInFrames,
  totalDurationInFrames,
  type Manifest,
} from "@engine/manifest";
import {
  MediaErrorContext,
  MediaResolverProvider,
  type MediaErrorHandler,
  type MediaResolver,
} from "@engine/media";
import { Banner } from "@/components/Banner";
import { encodeMediaPath, mediaUrl } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type {
  EditorPreview,
  EditorProjectInfo,
  EditorScene,
  EditorTimeline,
} from "./types";

export type { PlayerRef } from "@remotion/player";

const encodeSegments = encodeMediaPath;

const FONT_PREFIX = "fonts/";

export function projectMediaResolver(
  projectId: string,
  mediaVersions?: Record<string, number> | null,
): MediaResolver {
  const projectBase = `video-projects/${encodeURIComponent(projectId)}`;
  return (rel: string) => {
    if (rel.startsWith(FONT_PREFIX)) {
      return mediaUrl(`remotion-fonts/${encodeSegments(rel.slice(FONT_PREFIX.length))}`);
    }
    const version = mediaVersions?.[rel];
    const query =
      typeof version === "number" && Number.isFinite(version)
        ? `?v=${encodeURIComponent(String(Math.round(version)))}`
        : "";
    return mediaUrl(`${projectBase}/${encodeSegments(rel)}${query}`);
  };
}

export interface PreviewIssue {

  path: string;

  message: string;

  code?: "scene-duration";
  sceneId?: string;
}

export type PreviewBuild =
  | {
      ok: true;
      manifest: Manifest;
      durationInFrames: number;

      missing: string[];
    }
  | { ok: false; issues: PreviewIssue[] };

const sceneFrames = (scene: EditorScene, fps: number): number | null =>
  rawSceneDurationFrames(scene, fps);

export function buildPreviewManifest({
  timeline,
  project,
  preview,
}: {
  timeline: EditorTimeline;
  project: EditorProjectInfo;
  preview: EditorPreview;
}): PreviewBuild {
  const versions = preview.mediaVersions;
  const missing = new Set<string>();

  const gone = (rel: unknown): boolean => {
    if (typeof rel !== "string" || !rel || !versions) return false;
    if (Object.prototype.hasOwnProperty.call(versions, rel)) return false;
    missing.add(rel);
    return true;
  };

  const scenes: EditorScene[] = (timeline.scenes ?? []).map((original) => {
    const scene: EditorScene = { ...original };
    if (typeof scene.src === "string" && scene.src) {
      const render = preview.sceneRenders?.[scene.id];
      if (typeof render === "string" && render) scene.render = render;
      else delete scene.render;
    } else if (
      (typeof scene.srcVideo === "string" && scene.srcVideo) ||
      (typeof scene.srcImage === "string" && scene.srcImage)
    ) {
      delete scene.render;
    }

    if (typeof scene.render === "string" && gone(scene.render)) delete scene.render;
    if (typeof scene.srcVideo === "string" && scene.srcVideo && gone(scene.srcVideo)) {
      const frames = sceneFrames(scene, project.fps);
      delete scene.srcVideo;
      if (frames !== null) scene.durationInFrames = frames;
    }
    if (typeof scene.srcImage === "string" && scene.srcImage && gone(scene.srcImage)) delete scene.srcImage;
    return scene;
  });

  for (let i = 0; i < scenes.length - 1; i += 1) {
    const overlap = scenes[i].transitionOverlap;
    if (typeof overlap !== "number" || overlap <= 0) continue;
    const cur = sceneFrames(scenes[i], project.fps);
    const next = sceneFrames(scenes[i + 1], project.fps);
    if (cur === null || next === null) continue;
    const limit = Math.max(0, Math.min(cur, next));
    if (overlap > limit) scenes[i].transitionOverlap = limit;
  }

  const audioIn = timeline.audio ?? { voice: null, sfx: [], music: null };
  const audio = {
    ...audioIn,
    voice: gone(audioIn.voice) ? null : audioIn.voice,
    sfx: Array.isArray(audioIn.sfx)
      ? audioIn.sfx
          .filter((x) => !gone(x?.file))

          .map((x) => {
            const dur = x && typeof x.fadeOutSec === "number" && x.fadeOutSec > 0
              ? preview.media?.[x.file]?.durationSec
              : null;
            return dur ? { ...x, mediaDurationSec: dur } : x;
          })
      : audioIn.sfx,
    music: audioIn.music && gone(audioIn.music.file) ? null : audioIn.music,
  };

  const layers = (Array.isArray(timeline.layers) ? timeline.layers : []).map((original) => {
    if (!original || typeof original !== "object") return original;
    const layer = { ...original };
    if (typeof layer.src === "string" && layer.src) {
      if (gone(layer.src)) {
        delete layer.src;
      } else {
        const info = preview.media?.[layer.src];
        if (info?.width && info.height) layer.mediaAspect = info.width / info.height;
      }
    }
    return layer;
  });
  const raw = {
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    status: project.status ?? "draft",
    scenes,
    audio: {
      ...audio,
      voice: audio.voice ?? null,
      sfx: audio.sfx ?? [],
      music: audio.music ?? null,
    },
    captions: timeline.captions ?? [],
    subtitles: timeline.subtitles ?? [],

    ...(timeline.subtitleStyle ? { subtitleStyle: timeline.subtitleStyle } : {}),
    overlays: timeline.overlays ?? [],
    layers,
    watermark: preview.watermark && !gone(preview.watermark.file) ? preview.watermark : null,
  };

  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }

  const issues: PreviewIssue[] = [];
  parsed.data.scenes.forEach((scene, index) => {
    try {
      resolveSceneDurationInFrames(scene, parsed.data.fps);
    } catch (err) {
      issues.push({
        path: `scenes.${index}`,
        message: err instanceof Error ? err.message : String(err),
        code: "scene-duration",
        sceneId: scene.id,
      });
    }
  });
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    manifest: parsed.data,
    durationInFrames: Math.max(1, totalDurationInFrames(parsed.data)),
    missing: [...missing],
  };
}

type PreviewInputProps = {
  manifest: Manifest;
  projectId: string;

  mediaVersions: Record<string, number> | null;

  onMediaError: MediaErrorHandler;
};

const PreviewComposition = ({ manifest, projectId, mediaVersions, onMediaError }: PreviewInputProps) => {
  const resolve = useMemo(
    () => projectMediaResolver(projectId, mediaVersions),
    [projectId, mediaVersions],
  );
  return (
    <MediaResolverProvider resolve={resolve}>
      <MediaErrorContext.Provider value={onMediaError}>
        <Assemble {...manifest} />
      </MediaErrorContext.Provider>
    </MediaResolverProvider>
  );
};

export interface PreviewPlayerProps {
  projectId: string;
  timeline: EditorTimeline;
  project: EditorProjectInfo;
  preview: EditorPreview;

  ref?: Ref<PlayerRef>;

  controls?: boolean;

  fit?: "contain" | "width";
  className?: string;
}

export function PreviewPlayer({
  projectId,
  timeline,
  project,
  preview,
  ref,
  controls = true,
  fit = "contain",
  className,
}: PreviewPlayerProps) {
  const { t, tf } = useT();

  const build = useMemo(
    () => buildPreviewManifest({ timeline, project, preview }),
    [timeline, project, preview],
  );

  const versionsKey = JSON.stringify(preview.mediaVersions ?? null);
  const mediaVersions = useMemo<Record<string, number> | null>(
    () => {
      const parsed: unknown = JSON.parse(versionsKey);
      if (!parsed || typeof parsed !== "object") return null;
      const out: Record<string, number> = {};
      for (const [rel, v] of Object.entries(parsed)) {
        if (typeof v === "number") out[rel] = v;
      }
      return out;
    },
    [versionsKey],
  );

  const [mediaErrors, setMediaErrors] = useState<string[]>([]);
  const onMediaError = useCallback<MediaErrorHandler>((src, err) => {
    console.warn("[preview] không nạp được media:", src, err);
    setMediaErrors((prev) => (prev.includes(src) ? prev : [...prev, src]));
  }, []);

  useLayoutEffect(() => setMediaErrors([]), [mediaVersions]);

  const inputProps = useMemo<PreviewInputProps | null>(
    () => (build.ok ? { manifest: build.manifest, projectId, mediaVersions, onMediaError } : null),
    [build, projectId, mediaVersions, onMediaError],
  );

  const errorFallback: ErrorFallback = useCallback(
    ({ error }) => (
      <div className="p-4">
        <Banner tone="danger" message={t("editor.player.crashed")} detail={error.message} />
      </div>
    ),
    [t],
  );

  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = boxEl;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setBox((prev) => {

        if (width <= 0 || height <= 0) return prev;
        return prev && prev.w === width && prev.h === height ? prev : { w: width, h: height };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [boxEl]);

  if (!build.ok || !inputProps) {
    const issues = build.ok ? [] : build.issues;
    return (
      <div className={className}>
        <Banner tone="danger" message={t("editor.player.invalid")}>
          <ul className="mt-2 flex flex-col gap-1 text-meta">
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <span className="font-mono">{issue.path || t("editor.player.issue-root")}</span>
                {": "}
                {issue.code === "scene-duration"
                  ? tf("editor.player.scene-no-duration", { id: issue.sceneId ?? "" })
                  : issue.message}
              </li>
            ))}
          </ul>
        </Banner>
      </div>
    );
  }

  const { width, height, fps } = build.manifest;
  const aspect = width / height;

  const player = (style: CSSProperties) => (
    <Player
      ref={ref}
      component={PreviewComposition}
      inputProps={inputProps}
      durationInFrames={build.durationInFrames}
      compositionWidth={width}
      compositionHeight={height}
      fps={fps}
      controls={controls}

      numberOfSharedAudioTags={0}

      acknowledgeRemotionLicense
      errorFallback={errorFallback}
      style={style}
    />
  );

  const broken = [...build.missing, ...mediaErrors.filter((f) => !build.missing.includes(f))];

  const mediaBanner =
    broken.length > 0 ? (
      <div className="absolute left-2 right-2 top-2 z-10">
        <Banner
          tone="danger"
          message={tf("editor.player.media-missing", { n: broken.length })}
          detail={broken.join("\n")}
        />
      </div>
    ) : null;

  if (fit === "width") {
    return (
      <div className={`relative ${className ?? ""}`}>
        {player({ width: "100%" })}
        {mediaBanner}
      </div>
    );
  }

  let size: { width: number; height: number } | null = null;
  if (box && box.w > 0 && box.h > 0) {
    const w = Math.floor(Math.min(box.w, box.h * aspect));
    size = { width: w, height: Math.floor(w / aspect) };
  }

  return (
    <div ref={setBoxEl} className={`relative h-full w-full min-h-0 min-w-0 ${className ?? ""}`}>
      {size && (
        <div className="absolute inset-0 flex items-center justify-center">
          {player(size)}
        </div>
      )}
      {mediaBanner}
    </div>
  );
}
