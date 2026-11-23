

const INPUT_PROTOCOLS = "file,pipe,fd";

export function ffmpegSafeArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a === "-i") out.push("-protocol_whitelist", INPUT_PROTOCOLS);
    out.push(a);
  }
  return out;
}

export function ffprobeSafeArgs(args: string[]): string[] {
  return ["-protocol_whitelist", INPUT_PROTOCOLS, ...args];
}

const PLAYLIST_FORMATS = new Set(["hls", "applehttp", "concat", "ffconcat", "dash", "smoothstreaming"]);

export function isPlaylistFormat(formatName: unknown): boolean {
  if (typeof formatName !== "string") return false;
  return formatName
    .toLowerCase()
    .split(",")
    .some((f) => PLAYLIST_FORMATS.has(f.trim()));
}
