

export type LibraryItem =
  | { source: "project"; kind: "video" | "image" | "audio"; relPath: string; name: string }
  | { source: "sfx"; file: string; name: string }
  | { source: "music"; file: string; name: string };

export type DropTrack = "scene" | "layer" | "sfx" | "music";

export const LIBRARY_MIME = "application/x-fabuloki-library";

export const TARGET_MIME: Record<DropTrack, string> = {
  scene: "application/x-fabuloki-target-scene",
  layer: "application/x-fabuloki-target-layer",
  sfx: "application/x-fabuloki-target-sfx",
  music: "application/x-fabuloki-target-music",
};

export function dropTracksOf(item: LibraryItem): DropTrack[] {
  switch (item.source) {
    case "project":

      if (item.kind !== "audio") return ["scene", "layer"];
      return /^assets\/music\//i.test(item.relPath.replace(/\\/g, "/")) ? ["music", "sfx"] : ["sfx", "music"];
    case "sfx":
      return ["sfx"];
    case "music":
      return ["music"];
  }
}

export function acceptedTracks(types: readonly string[]): DropTrack[] {
  if (!types.includes(LIBRARY_MIME)) return [];
  return (Object.keys(TARGET_MIME) as DropTrack[]).filter((k) => types.includes(TARGET_MIME[k]));
}

export function writeDragData(dt: DataTransfer, item: LibraryItem): void {
  dt.setData(LIBRARY_MIME, JSON.stringify(item));
  for (const track of dropTracksOf(item)) dt.setData(TARGET_MIME[track], "1");
  dt.effectAllowed = "copy";
}

export function readDragData(dt: DataTransfer): LibraryItem | null {
  try {
    const raw: unknown = JSON.parse(dt.getData(LIBRARY_MIME));
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (o.source === "project" && typeof o.relPath === "string") {
      if (o.kind === "video" || o.kind === "image" || o.kind === "audio") {
        return { source: "project", kind: o.kind, relPath: o.relPath, name };
      }
      return null;
    }
    if ((o.source === "sfx" || o.source === "music") && typeof o.file === "string") {
      return { source: o.source, file: o.file, name };
    }
    return null;
  } catch {
    return null;
  }
}

export const isFileDrag = (types: readonly string[]): boolean => types.includes("Files");

export const FILE_DROP_TRACKS: readonly DropTrack[] = ["scene", "layer", "sfx"];

export function fileKindOf(file: { name: string; type: string }): "video" | "image" | "audio" | "other" {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return "other";
}

export interface DropTarget {
  track: DropTrack;

  frame: number;

  sceneIndex: number;
}

export function projectRelPath(repoRel: string, projectId: string): string {
  const norm = repoRel.replace(/\\/g, "/");
  const prefix = `video-projects/${projectId}/`;
  return norm.startsWith(prefix) ? norm.slice(prefix.length) : norm;
}
