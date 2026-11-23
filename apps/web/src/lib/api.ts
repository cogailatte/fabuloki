

export interface HealthChecks {
  ffmpeg: boolean;
  node: string;

  claudeAuth: boolean;
  hyperframes: boolean;
}

export interface Health {
  ok: boolean;
  checks: HealthChecks;
}

export type ProjectStatus = "draft" | "rendering" | "done";

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: ProjectStatus;
  output: string | null;
  tags: string[];

  textToVideoId: string | null;

  createdAt: string | null;
  updatedAt: string;

  tokensUsed: number;

  costUsd: number;
}

export interface UsageSummary {
  byProject: Record<string, { tokens: number; costUsd: number }>;
  total: {
    tokens: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  };
}

export type UsageScope = "all" | "video" | "image";

export interface UsageTimelinePoint {

  date: string;
  tokens: number;

  tokensIn: number;

  tokensOut: number;
  costUsd: number;

  byProvider: Record<string, number>;
}

export interface UsageByModel {

  provider: string;

  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;

  price: { inPerM: number; outPerM: number } | null;
  costInUsd: number | null;
  costOutUsd: number | null;
}

export interface EditEffect {
  id: string;
  name: string;
  use: string;
  inputs: string;
  duration: string;
  status: string;
  thumbnail: string | null;
}

export const getEditEffects = () => request<EditEffect[]>("/api/edit-effects");

export const setAssetEditEffect = (projectId: string, relPath: string, effectId: string | null) =>
  jsonBody<{ effectId: string | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/asset-effect`,
    "PUT",
    { relPath, effectId },
  );

export interface FileInfo {
  editEffectId?: string;
  editEffectName?: string;
  name: string;
  relPath: string;
  size: number;
  mtime: string;
  kind: "video" | "audio" | "image" | "other";

  description?: string;

  colorGrade?: string;

  colorAdjust?: Record<string, number>;
}

export const GRADE_LABELS: Record<string, string> = {
  "tu-nhien": "Tự nhiên",
  cinematic: "Cinematic",
  "tuoi-sang": "Tươi sáng",
  am: "Ấm",
  lanh: "Lạnh",
};

export interface GradePresetInfo {
  id: string;
  label: string;
}

let gradePresetsCache: GradePresetInfo[] | null = null;

export async function getGradePresets(): Promise<GradePresetInfo[]> {
  if (gradePresetsCache) return gradePresetsCache;
  const list = await request<GradePresetInfo[]>("/api/grade-presets");
  gradePresetsCache = list;
  return list;
}

export interface GradeAdjust {

  brightness: number;

  contrast: number;

  saturation: number;

  gamma: number;

  temperature: number;

  vibrance: number;
}

export const DEFAULT_ADJUST: GradeAdjust = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  temperature: 6500,
  vibrance: 0,
};

export function toGradeAdjust(raw?: Record<string, number> | null): GradeAdjust {
  const a = { ...DEFAULT_ADJUST };
  if (!raw || typeof raw !== "object") return a;
  for (const k of Object.keys(a) as (keyof GradeAdjust)[]) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) a[k] = v;
  }
  return a;
}

export function isDefaultAdjust(raw?: GradeAdjust | Record<string, number> | null): boolean {
  const a = toGradeAdjust(raw as Record<string, number> | null | undefined);
  return (Object.keys(DEFAULT_ADJUST) as (keyof GradeAdjust)[]).every(
    (k) => a[k] === DEFAULT_ADJUST[k]
  );
}

export interface GradePreviewInfo {
  transfer: string;
  primaries: string;

  needsTonemap: boolean;
  durationSec: number;
}

export interface GradePreviewItem {

  preset: string | null;
  label: string;
  relPath: string;
}

export interface GradePreviewResult {
  info: GradePreviewInfo;
  previews: GradePreviewItem[];
}

export type SfxMode = "recommended" | "library" | "none";

export type MusicMode = "auto" | "none";

export const AUTO_CUT_LEVELS = ["natural", "default", "tight"] as const;

export type TrimAggressiveness = (typeof AUTO_CUT_LEVELS)[number];

export type SourceKind = "video" | "article" | "request";

export type NarrationMode = "none" | "tts" | "file";

export type ScriptFormat = "mood" | "painpoint" | "debate" | "tour";

export interface Brief {
  scriptFormat: ScriptFormat | null;
  sourceKind: SourceKind;

  sourceUrl: string;

  sourceText: string;
  narrationMode: NarrationMode;

  narrationVoice: TextToVideoVoice;

  narrationFile: string;
  sourceDescription: string;
  autoCut: boolean;

  autoCutLevel: TrimAggressiveness;
  subtitles: boolean;

  highlightEnabled: boolean;

  highlightKeywords: string[];

  keyLayoutEnabled: boolean;

  mainKey: string;

  relatedKeys: string[];
  skill: string | null;
  quizzyMotionIds?: string[];
  sfxMode: SfxMode;

  musicMode: MusicMode;
  notes: string;

  autoIllustrations: boolean;

  illustrationModel: string | null;

  illustrationText: boolean;

  illustrationPosition: ImageTextPosition;

  illustrationsPerMinute: number | null;

  styleId: string | null;

  videoStyleEnabled: boolean;

  videoStyleId: string | null;

  finishMode?: FinishMode;
}

export type FinishMode = "draft" | "final";

export type VideoStylePalette = "brand" | "loose";

export interface VideoStyle {
  id: string;

  name: string;

  palette: VideoStylePalette;

  motion: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SceneMeta {
  id: string;
  src?: string;
  srcVideo?: string;
  durationInFrames?: number;
  [key: string]: unknown;
}

export interface ProjectDetail extends ProjectSummary {
  scenes?: SceneMeta[];
  brief?: Brief;

  thumbnail?: string | null;
  files: { renders: FileInfo[]; assets: FileInfo[] };
  [key: string]: unknown;
}

export type JobType =
  | "scene-draft"
  | "scene-final"
  | "assemble-draft"
  | "assemble-final"
  | "image-gen"

  | "auto-cut"

  | "auto-trim"

  | "text-to-video"

  | "translate-video";

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface Job {
  id: string;
  projectId: string;
  type: JobType;
  sceneId: string | null;
  status: JobStatus;
  progress: number;
  step: string;
  outputPath: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type JobWithLog = Job & { log: string };

export function isVideoProjectJob(job: Job, projectId?: string): boolean {
  if (
    job.type === "image-gen" ||
    job.type === "auto-cut" ||
    job.type === "text-to-video" ||
    job.type === "translate-video"
  ) {
    return false;
  }
  return projectId === undefined || job.projectId === projectId;
}

export interface Overview {

  runningJob: Job | null;

  runningJobs?: Job[];
  queuedCount: number;
  recentJobs: Job[];
  recentProjects: ProjectSummary[];
  health: Health;
}

export interface SkillMeta {
  name: string;
  description: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface SkillDetail {
  name: string;
  content: string;
}

export interface SfxEntry {
  file: string;
  tags: string[];
  durationMs: number | null;
  description: string;
}

export interface MusicEntry {
  file: string;
  tags: string[];
  durationMs: number | null;
  description: string;
}

export type ChatSessionStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "interrupted";

export interface ChatSession {
  sessionId: string;
  title: string;

  projectId: string | null;
  status: ChatSessionStatus;

  runStartedAt: string | null;

  runFinishedAt: string | null;

  autoResume: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  kind: "text" | "tool";
  content: string;
  createdAt: string;
}

export interface AgentEvent {
  sessionId: string;
  kind: "text" | "tool" | "result" | "error" | "done";
  text?: string;
  tool?: { name: string; input: unknown };
  error?: string;

  status?: "done" | "error" | "interrupted";
}

export interface JobLogEvent {
  jobId: string;
  line: string;
}

export interface UploadEvent {
  id: string;

  projectId?: string;
  received?: number;

  total?: number;
  done: boolean;
  error?: boolean;

  file?: string;
}

export type AgentEffort = "low" | "medium" | "high";

export type ProviderRole = "edit" | "chat" | "image";

export interface ProviderModel {
  id: string;
  label: string;
}

export interface Provider {
  id: "claude" | "gemini" | "openai";
  label: string;
  connected: boolean;

  source: "oauth" | "api-key" | null;
  note?: string;
  roles: ProviderRole[];
  models: ProviderModel[];
}

export interface ConnectionKeyInfo {

  envVar: string;
  present: boolean;

  masked: string | null;
}

export interface ConnectionInfo {
  id: "claude" | "gemini" | "openai";
  label: string;
  roles: string[];
  connected: boolean;

  source: "oauth" | "api-key" | null;

  note: string | null;
  key: ConnectionKeyInfo;

  keyHelpUrl: string;
}

export interface RenderSettings {

  workers: number;

  browserGpu: boolean;

  gpuEncodeDraft: boolean;

  gpuEncodeFinal: boolean;

  fastCapture: boolean;

  remotionConcurrency: number;

  queueConcurrency: number;

  draftFps: number | null;

  updateChannel: UpdateChannel;

  aiMaxAttempts: number;

  aiMaxTurns: number;
}

export interface HardwareInfo {

  platform: string;
  cores: number;
  ramGb: number;

  gpuName: string | null;

  nvenc: boolean;

  videotoolbox: boolean;

  cpuModel: string;

  cpuCores: number | null;

  cpuThreads: number;

  cpuMaxGhz: number | null;

  ramType: string | null;

  ramSpeedMhz: number | null;

  gpuVramGb: number | null;
}

export interface RenderRecommended {

  workers: number;

  concurrency: number;

  maxWorkers: number;
}

export interface RenderSettingsResponse {
  settings: RenderSettings;
  defaults: RenderSettings;
  hardware: HardwareInfo;
  recommended: RenderRecommended;
}

export const getRenderSettings = () =>
  request<RenderSettingsResponse>("/api/render-settings");

export const updateRenderSettings = (patch: Partial<RenderSettings>) =>
  jsonBody<{ settings: RenderSettings }>("/api/render-settings", "PUT", patch);

export interface StyleColors {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
}

export type StyleFontSlot = "heading" | "body";

export interface StyleEffects {

  gradient: boolean;

  liquidGlass: boolean;
}

export interface StyleDesign {
  id: string;
  name: string;
  tags: string[];
  colors: StyleColors;
  fonts: { heading: string; body: string };

  fontFiles: { heading: string | null; body: string | null };

  logoPath: string | null;

  effects?: StyleEffects;
  tone: string;
  guidelines: string;
  createdAt: string;
  updatedAt: string;
}

export interface StylesResponse {
  defaultId: string | null;
  styles: StyleDesign[];
}

export type ImageKind =
  | "background"
  | "3d"
  | "character"
  | "texture"
  | "product"
  | "concept";

export type ImageAspect = "9:16" | "16:9" | "1:1" | "4:5";

export type ImageProjectStatus = "draft" | "generating" | "done" | "error";

export interface ImageStat {
  label: string;
  value: string;
}

export const IMAGE_TEXT_POSITIONS = [
  "auto",
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type ImageTextPosition = (typeof IMAGE_TEXT_POSITIONS)[number];

export interface ImageOverlay {
  title: string;
  subtitle: string;
  stats: ImageStat[];
  cta: string;
  showLogo: boolean;
  position: ImageTextPosition;
}

export interface ImageProject {
  id: string;
  name: string;
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  status: ImageProjectStatus;
  overlay: ImageOverlay;

  model: string | null;

  styleId: string | null;

  background: string | null;

  final: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ImageGenStep = "all" | "background" | "compose";

function isLocalNetworkHost(host: string): boolean {
  return (
    host === "localhost" ||
    /^127\./.test(host) ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host
    )
  );
}

export function serverOrigin(): string {
  if (typeof window === "undefined") return "http://localhost:6869";
  if (!isLocalNetworkHost(window.location.hostname)) return window.location.origin;
  const port = process.env.NEXT_PUBLIC_SERVER_PORT || "6869";
  return `http://${window.location.hostname}:${port}`;
}

export function uploadOrigin(): string {
  return serverOrigin();
}

export class ApiError extends Error {
  code: string;
  status: number;

  data: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    data: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

const TOKEN_KEY = "fabuloki_api_token";

let apiToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

function uploadTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("k") ?? "";
}

async function persistToken(token: string): Promise<void> {
  apiToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {

  }

  try {
    await fetch("/api/session", { method: "POST", headers: { "x-fabuloki-token": token } });
  } catch {

  }
}

async function ensureToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (apiToken) return apiToken;

  if (uploadTokenFromUrl()) return null;
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("t");
    if (fromUrl) {

      params.delete("t");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
      await persistToken(fromUrl);
      return fromUrl;
    }
    try {
      const stored = window.localStorage.getItem(TOKEN_KEY);
      if (stored) {
        await persistToken(stored);
        return stored;
      }
    } catch {

    }
    try {
      const res = await fetch(`${serverOrigin()}/api/health`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { apiToken?: string };
        if (body?.apiToken) {
          await persistToken(body.apiToken);
          return body.apiToken;
        }
      }
    } catch {

    }
    tokenPromise = null;
    return null;
  })();

  return tokenPromise;
}

function withUploadToken(path: string): string {
  const k = uploadTokenFromUrl();
  if (!k) return path;
  return path + (path.includes("?") ? "&" : "?") + `k=${encodeURIComponent(k)}`;
}

function dropToken(): void {
  apiToken = null;
  tokenPromise = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {

  }
}

async function isAccessTokenRejected(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code !== "string" || code === "UNAUTHORIZED";
  } catch {

    return true;
  }
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const token = await ensureToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-fabuloki-token", token);

  let res: Response;
  try {
    res = await fetch(withUploadToken(path), { ...init, headers });
  } catch {
    throw new ApiError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0
    );
  }
  if (res.status === 401 && token && !retried && !uploadTokenFromUrl() && (await isAccessTokenRejected(res))) {
    dropToken();
    return request<T>(path, init, true);
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    let data: Record<string, unknown> = {};
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string };
        [key: string]: unknown;
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
      if (body && typeof body === "object") {
        const { error: _error, ...rest } = body;
        data = rest;
      }
    } catch {

    }
    throw new ApiError(code, message, res.status, data);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function jsonBody<T>(
  path: string,
  method: "PUT" | "PATCH",
  body: unknown
): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const getHealth = () => request<Health>("/api/health");
export const getOverview = () => request<Overview>("/api/overview");

export interface UpdateCommit {
  hash: string;
  message: string;
}

export type UpdateChannel = "stable" | "latest";

export type UpdateStep = "pull" | "stop" | "install" | "restart";

export const getUsageSummary = () =>
  request<UsageSummary>("/api/usage/summary");

export const getUsageTimeline = (days = 30, scope?: UsageScope) =>
  request<UsageTimelinePoint[]>(
    `/api/usage/timeline?days=${days}${scope && scope !== "all" ? `&scope=${scope}` : ""}`
  );

export const getUsageByModel = (days = 30) =>
  request<UsageByModel[]>(`/api/usage/by-model?days=${days}`);

export const getProjects = () => request<ProjectSummary[]>("/api/projects");

export const createProject = (input: {

  id?: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  tags?: string[];
}) => post<ProjectSummary>("/api/projects", input);

export const getProject = (id: string) =>
  request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);

export const cloneProject = (id: string, name?: string) =>
  post<ProjectSummary>(
    `/api/projects/${encodeURIComponent(id)}/clone`,
    name && name.trim() ? { name: name.trim() } : {}
  );

export const deleteProject = (id: string) =>
  request<void>(`/api/projects/${encodeURIComponent(id)}?force=true`, {
    method: "DELETE",
  });

export const updateBrief = (id: string, brief: Partial<Brief>) =>
  jsonBody<Brief>(
    `/api/projects/${encodeURIComponent(id)}/brief`,
    "PUT",
    brief
  );

export interface SourceArticleSummary {
  relPath: string;
  title: string;
  url: string;
  chars: number;
  excerpt: string;
}

export const getSourceArticle = (id: string) =>
  request<{ article: SourceArticleSummary | null }>(
    `/api/projects/${encodeURIComponent(id)}/source/article`
  );

export const fetchSourceArticle = (id: string, url: string) =>
  post<{ article: SourceArticleSummary; brief: Brief }>(
    `/api/projects/${encodeURIComponent(id)}/source/article`,
    { url }
  );

export const updateProjectTags = (id: string, tags: string[]) =>
  jsonBody<{ tags: string[] }>(
    `/api/projects/${encodeURIComponent(id)}/tags`,
    "PUT",
    { tags }
  );

export const renameProject = (id: string, name: string) =>
  jsonBody<ProjectSummary>(
    `/api/projects/${encodeURIComponent(id)}/name`,
    "PUT",
    { name }
  );

export const updateAssetDescription = (
  projectId: string,
  file: string,
  description: string
) =>
  jsonBody<FileInfo>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/description`,
    "PUT",
    { description }
  );

export const createThumbnail = (
  id: string,
  input: { title: string; frameAt?: number; bgPrompt?: string }
) =>
  post<{ file: string; relPath: string }>(
    `/api/projects/${encodeURIComponent(id)}/thumbnail`,
    input
  );

export interface JunkItem {
  relPath: string;
  size: number;
}

export interface ProjectJunk {
  items: JunkItem[];
  totalBytes: number;
}

export const getProjectJunk = (id: string) =>
  request<ProjectJunk>(`/api/projects/${encodeURIComponent(id)}/junk`);

export const cleanProjectJunk = (id: string) =>
  post<{ freedBytes: number; deleted: number }>(
    `/api/projects/${encodeURIComponent(id)}/junk/clean`
  );

export const deleteProjectAsset = (projectId: string, file: string) =>
  request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}`,
    { method: "DELETE" }
  );

export const getGradePreviews = (projectId: string, file: string) =>
  post<GradePreviewResult>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade-preview`
  );

export const renderGradeFrame = (
  projectId: string,
  file: string,
  preset: string | null,
  adjust: GradeAdjust
) =>
  post<{ relPath: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade-frame`,
    { preset, adjust }
  );

export const setAssetGrade = (
  projectId: string,
  file: string,
  preset: string | null,
  adjust?: GradeAdjust
) =>
  jsonBody<{
    file: string;
    colorGrade: string | null;
    colorAdjust: GradeAdjust | null;
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade`,
    "PUT",
    adjust ? { preset, adjust } : { preset }
  );

export const startProjectEdit = (
  id: string,
  extraNotes?: string,
  opts?: { model?: string; effort?: AgentEffort }
) =>
  post<{ sessionId: string }>(`/api/projects/${encodeURIComponent(id)}/edit`, {
    ...(extraNotes && extraNotes.trim()
      ? { extraNotes: extraNotes.trim() }
      : {}),
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.effort ? { effort: opts.effort } : {}),
  });

export const getJobs = (limit = 50, projectId?: string) =>
  request<Job[]>(
    `/api/jobs?limit=${limit}${
      projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""
    }`
  );

export const getJob = (id: string) =>
  request<JobWithLog>(`/api/jobs/${encodeURIComponent(id)}`);

export const createJob = (input: {
  projectId: string;
  type: JobType;
  sceneId?: string;
}) => post<Job>("/api/jobs", input);

export const cancelJob = (id: string) =>
  post<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`);

export const getSkills = () => request<SkillMeta[]>("/api/skills");

export const getSkill = (name: string) =>
  request<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`);

export const createSkill = (input: { name: string; content: string }) =>
  post<SkillDetail>("/api/skills", input);

export const updateSkill = (name: string, content: string) =>
  request<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

export const deleteSkill = (name: string) =>
  request<void>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

export interface SkillGenerateInput {

  goal: string;

  name?: string;

  platform?: string;
  aspect?: "9:16" | "16:9" | "1:1" | "4:5";
  fps?: 30 | 60;

  duration?: string;

  style?: string;
  captions?: "karaoke" | "sentence" | "none";

  highlights?: boolean;

  sfx?: boolean;

  baseSkill?: string;
  notes?: string;
}

export interface SkillGenerateResult {
  name: string;
  content: string;
  tokens: { input: number; output: number };
}

export class SkillGenerateError extends ApiError {
  raw: string | null;

  constructor(code: string, message: string, status: number, raw: string | null) {
    super(code, message, status);
    this.name = "SkillGenerateError";
    this.raw = raw;
  }
}

export async function generateSkill(
  input: SkillGenerateInput
): Promise<SkillGenerateResult> {
  let res: Response;
  const token = await ensureToken();
  try {
    res = await fetch(`${serverOrigin()}/api/skills/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-fabuloki-token": token } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new SkillGenerateError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0,
      null
    );
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    let raw: string | null = null;
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string; raw?: string };
        raw?: string;
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
      const r = body?.raw ?? body?.error?.raw;
      if (typeof r === "string" && r) raw = r;
    } catch {

    }
    throw new SkillGenerateError(code, message, res.status, raw);
  }
  return (await res.json()) as SkillGenerateResult;
}

export const getPrompts = () => request<PromptTemplate[]>("/api/prompts");

export const createPrompt = (input: { name: string; content: string }) =>
  post<PromptTemplate>("/api/prompts", input);

export const updatePrompt = (
  id: string,
  patch: { name?: string; content?: string }
) =>
  jsonBody<PromptTemplate>(
    `/api/prompts/${encodeURIComponent(id)}`,
    "PUT",
    patch
  );

export const deletePrompt = (id: string) =>
  request<void>(`/api/prompts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const getSfx = () => request<SfxEntry[]>("/api/sfx");

export const uploadSfx = (file: File, tags: string, description: string) => {
  const form = new FormData();
  form.append("file", file);
  form.append("tags", tags);
  form.append("description", description);
  return request<SfxEntry>(`${serverOrigin()}/api/sfx`, { method: "POST", body: form });
};

export const patchSfx = (
  file: string,
  patch: { description?: string; tags?: string[]; recommended?: boolean }
) => jsonBody<SfxEntry>(`/api/sfx/${encodeURIComponent(file)}`, "PATCH", patch);

export const deleteSfx = (file: string) =>
  request<void>(`/api/sfx/${encodeURIComponent(file)}`, { method: "DELETE" });

export const getMusic = () => request<MusicEntry[]>("/api/music");

export const uploadMusic = (file: File, tags: string, description: string) => {
  const form = new FormData();
  form.append("file", file);
  form.append("tags", tags);
  form.append("description", description);
  return request<MusicEntry>(`${serverOrigin()}/api/music`, { method: "POST", body: form });
};

export const patchMusic = (
  file: string,
  patch: { description?: string; tags?: string[] }
) => jsonBody<MusicEntry>(`/api/music/${encodeURIComponent(file)}`, "PATCH", patch);

export const deleteMusic = (file: string) =>
  request<void>(`/api/music/${encodeURIComponent(file)}`, { method: "DELETE" });

export type AssetScope = "imports" | "outputs" | "project";

export const getAssets = (scope: AssetScope, projectId?: string) => {
  const qs = new URLSearchParams({ scope });
  if (projectId) qs.set("projectId", projectId);
  return request<FileInfo[]>(`/api/assets?${qs.toString()}`);
};

export const uploadAsset = (
  file: File,
  scope: AssetScope,
  projectId?: string
) => {
  const form = new FormData();

  form.append("scope", scope);
  if (projectId) form.append("projectId", projectId);
  form.append("file", file);
  return request<FileInfo>(`${serverOrigin()}/api/assets`, { method: "POST", body: form });
};

export const getChatSessions = (projectId?: string) =>
  request<ChatSession[]>(
    projectId
      ? `/api/chat/sessions?projectId=${encodeURIComponent(projectId)}`
      : "/api/chat/sessions"
  );

export const getChatMessages = (sessionId: string) =>
  request<ChatMessage[]>(
    `/api/chat/${encodeURIComponent(sessionId)}/messages`
  );

export const sendChat = (
  message: string,
  sessionId?: string,
  projectId?: string,
  opts?: { model?: string; effort?: AgentEffort }
) =>
  post<{ sessionId: string }>("/api/chat", {
    message,
    sessionId,
    projectId,
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.effort ? { effort: opts.effort } : {}),
  });

export const interruptChat = (sessionId: string) =>
  post<void>(`/api/chat/${encodeURIComponent(sessionId)}/interrupt`);

export const setChatAutoResume = (sessionId: string, enabled: boolean) =>
  jsonBody<void>(
    `/api/chat/${encodeURIComponent(sessionId)}/auto-resume`,
    "PUT",
    { enabled }
  );

export const getProviders = () =>
  request<{ providers: Provider[] }>("/api/providers");

export interface GeminiImageModels {

  source: "google" | "static";
  models: ProviderModel[];
}

export const getGeminiImageModels = () =>
  request<GeminiImageModels>("/api/providers/gemini/image-models");

export interface ClaudeModels {

  source: "anthropic" | "claude-code" | "static";
  models: ProviderModel[];
}

export const getClaudeModels = () =>
  request<ClaudeModels>("/api/providers/claude/models");

export const getConnections = () =>
  request<{ connections: ConnectionInfo[] }>("/api/connections");

export const setConnectionKey = (provider: string, apiKey: string | null) =>
  jsonBody<{ connections: ConnectionInfo[] }>(
    `/api/connections/${encodeURIComponent(provider)}/key`,
    "PUT",
    { apiKey }
  );

export const testConnection = (provider: string) =>
  post<{ ok: boolean; message: string }>(
    `/api/connections/${encodeURIComponent(provider)}/test`
  );

export interface ChatgptAccount {
  id: string;
  email?: string | null;
  plan?: string | null;

  status: string;

  imageQuotaRemaining?: number | null;

  resetAt?: string | null;

  expiresAt?: string | null;
}

export type GeminiWebCookiesInput =
  | { psid: string; psidts?: string }
  | { cookie: string };

export const getStyles = () => request<StylesResponse>("/api/styles");

export const createStyle = (input: {
  name: string;
  tags?: string[];
  cloneFrom?: string;
}) => post<StyleDesign>("/api/styles", input);

export const updateStyle = (
  id: string,
  patch: Partial<
    Pick<
      StyleDesign,
      "name" | "tags" | "colors" | "fonts" | "effects" | "tone" | "guidelines"
    >
  >
) =>
  jsonBody<StyleDesign>(`/api/styles/${encodeURIComponent(id)}`, "PUT", patch);

export const deleteStyle = (id: string) =>
  request<void>(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" });

export const setDefaultStyle = (id: string) =>
  post<{ defaultId: string }>(
    `/api/styles/${encodeURIComponent(id)}/default`
  );

export const uploadStyleLogo = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<StyleDesign>(
    `${serverOrigin()}/api/styles/${encodeURIComponent(id)}/logo`,
    { method: "POST", body: form }
  );
};

export const uploadStyleFont = (id: string, slot: StyleFontSlot, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<StyleDesign>(
    `${serverOrigin()}/api/styles/${encodeURIComponent(id)}/font?slot=${slot}`,
    { method: "POST", body: form }
  );
};

export const styleFontGoogle = (id: string, slot: StyleFontSlot, family: string) =>
  post<StyleDesign>(`/api/styles/${encodeURIComponent(id)}/font-google`, {
    slot,
    family,
  });

export const deleteStyleFont = (id: string, slot: StyleFontSlot) =>
  request<StyleDesign>(
    `/api/styles/${encodeURIComponent(id)}/font/${slot}`,
    { method: "DELETE" }
  );

export const getImageProjects = () =>
  request<ImageProject[]>("/api/images");

export const createImageProject = (input: {
  name: string;
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  overlay?: Partial<ImageOverlay>;

  model?: string | null;

  styleId?: string | null;
}) => post<ImageProject>("/api/images", input);

export const getImageProject = (id: string) =>
  request<ImageProject>(`/api/images/${encodeURIComponent(id)}`);

export const updateImageProject = (
  id: string,
  patch: Partial<
    Pick<
      ImageProject,
      | "name"
      | "prompt"
      | "kind"
      | "aspect"
      | "overlay"
      | "model"
      | "styleId"
    >
  >
) =>
  jsonBody<ImageProject>(`/api/images/${encodeURIComponent(id)}`, "PUT", patch);

export const renameImageProject = (id: string, name: string) =>
  updateImageProject(id, { name });

export const cloneImageProject = (id: string, name?: string) =>
  post<ImageProject>(
    `/api/images/${encodeURIComponent(id)}/clone`,
    name && name.trim() ? { name: name.trim() } : {}
  );

export const deleteImageProject = (id: string) =>
  request<void>(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getImageJunk = (id: string) =>
  request<ProjectJunk>(`/api/images/${encodeURIComponent(id)}/junk`);

export const cleanImageJunk = (id: string) =>
  post<{ freedBytes: number; deleted: number }>(
    `/api/images/${encodeURIComponent(id)}/junk/clean`
  );

export const uploadImageBackground = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<ImageProject>(
    `${serverOrigin()}/api/images/${encodeURIComponent(id)}/background`,
    { method: "POST", body: form }
  );
};

export const generateImage = (id: string, step?: ImageGenStep) =>
  post<Job>(
    `/api/images/${encodeURIComponent(id)}/generate`,
    step ? { step } : {}
  );

export interface LanInfo {

  ips: string[];
  webPort: number;

  tunnelDomain: string | null;
}

export const getLanInfo = () => request<LanInfo>("/api/lan-info");

export interface UploadSession {

  token: string;

  expiresAt: string;
}

export const createUploadSession = (projectId: string) =>
  post<UploadSession>("/api/upload-session", { projectId });

export const revokeUploadSession = (token: string) =>
  request<void>(`/api/upload-session/${encodeURIComponent(token)}`, {
    method: "DELETE",
  });

export interface TunnelStatus {

  installed: boolean;
  running: boolean;

  auto: boolean;

  mode: "named" | "quick" | null;

  url: string | null;

  domain: string | null;

  lastLog: string[];
}

export const getTunnelStatus = () => request<TunnelStatus>("/api/tunnel");

export const setTunnelDomain = (domain: string | null) =>
  jsonBody<TunnelStatus>("/api/tunnel/domain", "PUT", { domain });

export const startTunnel = (auto = false) =>
  post<{ mode: "named" | "quick"; auto: boolean }>("/api/tunnel/start", { auto });

export const stopTunnel = (onlyAuto = false) =>
  post<void>("/api/tunnel/stop", { onlyAuto });

export function closePhoneSessionOnUnload(uploadToken: string | null, stopAuto: boolean): void {

  const token = apiToken;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-fabuloki-token"] = token;
  if (uploadToken) {
    void fetch(`/api/upload-session/${encodeURIComponent(uploadToken)}`, {
      method: "DELETE",
      headers,
      keepalive: true,
    }).catch(() => {});
  }
  if (stopAuto) {
    void fetch("/api/tunnel/stop", {
      method: "POST",
      headers,
      body: JSON.stringify({ onlyAuto: true }),
      keepalive: true,
    }).catch(() => {});
  }
}

export const revealFile = (relPath: string) =>
  post<void>("/api/reveal", { relPath });

export const encodeMediaPath = (rel: string): string =>
  rel
    .split(/[\\/]+/)
    .filter((seg) => seg !== "" && seg !== ".")
    .map(encodeURIComponent)
    .join("/");

export const mediaUrl = (relPath: string) =>
  withUploadToken(
    `/media/${String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "")}`
  );

export const imageFileUrl = (projectId: string, file: string, version?: string | number) =>
  mediaUrl(`image-projects/${projectId}/${file}`) +
  (version !== undefined ? `?v=${encodeURIComponent(String(version))}` : "");

export interface RenderSettings {

  qcGate: boolean;
}

export type QcStatus = "pass" | "warn" | "fail";

export type QcPlatform = "tiktok" | "youtube" | "reels";

export interface QcCheck {
  id: string;
  label: string;
  status: QcStatus;
  detail: string;

  value?: number | null;

  frames?: string[];
}

export interface QcReport {
  checkedAt: string;

  file: string;

  fileMtime: string;
  platform: string;
  status: QcStatus;
  checks: QcCheck[];
}

export interface QcReportResponse {
  report: QcReport | null;
  stale?: boolean;
}

export const getQcReport = (projectId: string) =>
  request<QcReportResponse>(`/api/projects/${encodeURIComponent(projectId)}/qc`);

export const runProjectQc = (
  projectId: string,
  input?: { file?: string; platform?: QcPlatform }
) =>
  post<{ report: QcReport }>(
    `/api/projects/${encodeURIComponent(projectId)}/qc`,
    input ?? {}
  );

export type PublishPlatform = "tiktok" | "youtube" | "facebook";

export interface PublishItem {
  platform: PublishPlatform;
  title: string;

  description: string;
  hashtags: string[];
}

export interface PublishPack {
  generatedAt: string;

  transcriptRel: string;
  items: PublishItem[];

  subtitles: { srt: string; vtt: string };
  thumbnail: string | null;
  output: string | null;
}

export const getPublishPack = (projectId: string) =>
  request<{ pack: PublishPack | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/publish`
  );

export const createPublishPack = (
  projectId: string,
  platforms?: PublishPlatform[]
) =>
  post<{ pack: PublishPack }>(
    `/api/projects/${encodeURIComponent(projectId)}/publish`,
    platforms && platforms.length ? { platforms } : {}
  );

export const createSubtitles = (projectId: string) =>
  post<{ srt: string; vtt: string; cues: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/subtitles`
  );

export const subtitleDownloadUrl = (
  projectId: string,
  format: "srt" | "vtt",
  version?: string
) =>
  withUploadToken(
    `/api/projects/${encodeURIComponent(projectId)}/subtitles?format=${format}` +
      (version ? `&v=${encodeURIComponent(version)}` : "")
  );

export interface TrimSilenceRange {
  start: number;
  end: number;
  duration: number;
}

export interface TrimProfile {

  minSilenceSec: number;

  padSec: number;

  maxResidualSec: number;

  maxResidualRatio: number;
}

export interface TrimAnalysis {
  durationSec: number;

  noiseFloorDb: number;
  thresholdDb: number;
  profile: TrimProfile;
  silences: TrimSilenceRange[];
  keepRanges: Array<[number, number]>;
  removedSec: number;

  thresholdNote?: string;
  sweep?: Array<{ db: number; count: number; ratio: number; midpointRate: number }>;

  wordGuard?: { droppedSec: number; droppedRanges: number };
}

export type DeadWeightKind = "filler" | "stutter" | "repeat-take" | "hesitation";

export interface DeadWeightCandidate {
  kind: DeadWeightKind;
  start: number;
  end: number;
  text: string;

  confidence: number;

  reason: string;
  context: string;
}

export interface DeadWeightReport {
  candidates: DeadWeightCandidate[];
  totalSec: number;
  byKind: Record<DeadWeightKind, { count: number; sec: number }>;
}

export interface TrimVerification {
  residual: TrimSilenceRange[];
  totalSilenceSec: number;
  ratio: number;
  longest: number;
  pass: boolean;

  reason?: string;
}

export interface TrimAnalyzeResult {

  source: string;

  transcript: string | null;
  guarded: boolean;
  silence: TrimAnalysis;
  deadWeight: DeadWeightReport;
  note: string;
}

export const analyzeAutoTrim = (
  projectId: string,
  input?: { source?: string; level?: TrimAggressiveness }
) =>
  post<TrimAnalyzeResult>(
    `/api/projects/${encodeURIComponent(projectId)}/auto-trim/analyze`,
    input ?? {}
  );

export interface AutoTrimApplyResult {
  job: Job;
  level: TrimAggressiveness;
  profile: TrimProfile;
  source: string;

  approvedCandidates: number;
}

export const applyAutoTrim = (
  projectId: string,
  input?: {
    source?: string;
    level?: TrimAggressiveness;
    cutCandidates?: Array<{ start: number; end: number }>;
  }
) =>
  post<AutoTrimApplyResult>(
    `/api/projects/${encodeURIComponent(projectId)}/auto-trim/apply`,
    input ?? {}
  );

export interface AutoTrimReport {
  createdAt: string;
  jobId: string;
  level: TrimAggressiveness;
  profile: TrimProfile;

  source: string;

  output: string | null;
  transcript: { source: string | null; cut: string | null; guarded: boolean };
  duration: { beforeSec: number; afterSec: number | null; removedSec: number };

  removed: { silenceSec: number; approvedSec: number; ranges: number };
  threshold: { db: number; noiseFloorDb: number; note: string };
  candidates: {
    approved: number;

    rejected: Array<{ start: number; end: number }>;
  };
  verification: TrimVerification & { measuredOn: string; guarded: boolean };
  verdict: "pass" | "fail";
  note: string;
}

export async function getAutoTrimReport(
  projectId: string,
  version?: string
): Promise<AutoTrimReport | null> {
  const base = mediaUrl(
    `video-projects/${encodeURIComponent(projectId)}/assets/auto-trim-report.json`
  );

  const url = version
    ? `${base}${base.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
    : base;
  try {
    const report = await request<AutoTrimReport>(url);
    return report ?? null;
  } catch {
    return null;
  }
}

export type ReviewNoteStatus = "open" | "sent" | "resolved";

export interface ReviewNote {
  id: string;

  atSec: number;
  text: string;
  status: ReviewNoteStatus;
  createdAt: string;

  sentAt?: string;
}

export const REVIEW_TEXT_MAX = 500;

export const getReviewNotes = (projectId: string) =>
  request<{ notes: ReviewNote[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/review`
  );

export const addReviewNote = (projectId: string, atSec: number, text: string) =>
  post<{ note: ReviewNote }>(
    `/api/projects/${encodeURIComponent(projectId)}/review`,
    { atSec, text }
  );

export const updateReviewNote = (
  projectId: string,
  noteId: string,
  patch: { text?: string; status?: ReviewNoteStatus }
) =>
  jsonBody<{ note: ReviewNote }>(
    `/api/projects/${encodeURIComponent(projectId)}/review/${encodeURIComponent(noteId)}`,
    "PATCH",
    patch
  );

export const deleteReviewNote = (projectId: string, noteId: string) =>
  request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/review/${encodeURIComponent(noteId)}`,
    { method: "DELETE" }
  );

export const sendReviewNotes = (projectId: string, extraNotes?: string) =>
  post<{ sessionId: string; sentCount: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/review/send`,
    extraNotes && extraNotes.trim() ? { extraNotes: extraNotes.trim() } : {}
  );

export interface Clip {
  start: number;
  end: number;
  title: string;

  hook: string;
  reason: string;

  score: number;
}

export interface ClipsResponse {
  clips: Clip[];

  suggestedAt: string | null;
  sourceDurationSec?: number;
}

export const getClips = (projectId: string) =>
  request<ClipsResponse>(`/api/projects/${encodeURIComponent(projectId)}/clips`);

export const suggestClips = (
  projectId: string,
  input?: { count?: number; minSec?: number; maxSec?: number }
) =>
  post<{ clips: Clip[]; suggestedAt: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/clips/suggest`,
    input ?? {}
  );

export interface CreatedClipProject {
  id: string;
  name: string;
  sessionId: string | null;
}

export const createClipProjects = (
  projectId: string,
  input: {
    indexes: number[];
    width?: number;
    height?: number;
    autoEdit?: boolean;
  }
) =>
  post<{ created: CreatedClipProject[]; note?: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/clips/create`,
    input
  );

export type RepurposeAspect = "9:16" | "16:9" | "1:1" | "4:5";

export const REPURPOSE_SIZES: Record<
  RepurposeAspect,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const repurposeProject = (
  projectId: string,
  input: { aspect: RepurposeAspect; name?: string; autoEdit?: boolean }
) =>
  post<{ project: ProjectSummary; sessionId: string | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/repurpose`,
    input
  );

export type AutoCutStatus =
  | "draft"
  | "planning"
  | "planned"
  | "cutting"
  | "done"
  | "failed";

export type AutoCutMode = "time" | "ai" | "prompt";

export type AutoCutAspect = "keep" | "9:16" | "16:9" | "1:1" | "4:5";

export type AutoCutLayout = "auto" | "crop" | "fit";

export type AutoCutBackground = "gemini" | "blur" | "style";

export interface AutoCutSource {
  relPath: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;

  rotation: number;
}

export interface AutoCutParams {

  minutes?: number;

  overlapSec?: number;

  count?: number;
  minSec?: number;
  maxSec?: number;

  request?: string;
}

export interface AutoCutOutput {
  aspect: AutoCutAspect;
  layout: AutoCutLayout;
  background: AutoCutBackground;

  styleId: string | null;

  fps: number | null;
}

export interface AutoCutSegment {
  index: number;

  start: number;
  end: number;
  title: string;
  hook?: string;
  reason?: string;

  score?: number;
  selected: boolean;

  projectId?: string;

  appliedLayout?: "crop" | "fit";
}

export interface AutoCutMeta {
  id: string;
  name: string;
  status: AutoCutStatus;
  source: AutoCutSource;
  mode: AutoCutMode;
  params: AutoCutParams;
  output: AutoCutOutput;
  transcribe: boolean;
  autoEdit: boolean;

  brief: Brief;
  transcriptRel?: string | null;
  segments: AutoCutSegment[];
  error?: string | null;

  failedStep?: "plan" | "cut" | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutoCutSegmentPatch {
  index: number;
  start?: number;
  end?: number;
  title?: string;
  selected?: boolean;
}

export const AUTO_CUT_SIZES: Record<
  Exclude<AutoCutAspect, "keep">,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const AUTO_CUT_DEFAULT_PARAMS = {
  minutes: 5,
  overlapSec: 0,
  count: 5,
  minSec: 20,
  maxSec: 60,
} as const;

export type AutoCutStep = "plan" | "cut";

export function isAutoCutJob(job: Job, sessionId?: string): boolean {
  if (job.type !== "auto-cut") return false;
  return sessionId === undefined || job.projectId === sessionId;
}

export const getAutoCutSources = () =>
  request<{ files: FileInfo[] }>("/api/auto-cut/sources").then(
    (r) => r.files ?? []
  );

export const getAutoCutSessions = () =>
  request<{ sessions: AutoCutMeta[] }>("/api/auto-cut").then(
    (r) => r.sessions ?? []
  );

export const getAutoCutSession = (id: string) =>
  request<{ session: AutoCutMeta }>(
    `/api/auto-cut/${encodeURIComponent(id)}`
  ).then((r) => r.session);

export const createAutoCut = (input: {

  name?: string;
  sourceRel: string;
  mode: AutoCutMode;
  params?: AutoCutParams;
  output?: Partial<AutoCutOutput>;
  transcribe?: boolean;
  autoEdit?: boolean;

  brief?: Partial<Brief>;
}) => post<{ session: AutoCutMeta }>("/api/auto-cut", input).then((r) => r.session);

export const updateAutoCut = (
  id: string,
  patch: {
    name?: string;
    params?: AutoCutParams;
    output?: Partial<AutoCutOutput>;
    transcribe?: boolean;
    autoEdit?: boolean;

    brief?: Partial<Brief>;
    segments?: AutoCutSegmentPatch[];
  }
) =>
  jsonBody<{ session: AutoCutMeta }>(
    `/api/auto-cut/${encodeURIComponent(id)}`,
    "PATCH",
    patch
  ).then((r) => r.session);

export const planAutoCut = (id: string) =>
  post<{ job: Job }>(`/api/auto-cut/${encodeURIComponent(id)}/plan`).then(
    (r) => r.job
  );

export const cutAutoCut = (id: string) =>
  post<{ job: Job }>(`/api/auto-cut/${encodeURIComponent(id)}/cut`).then(
    (r) => r.job
  );

export const deleteAutoCut = (id: string, force = true) =>
  request<void>(
    `/api/auto-cut/${encodeURIComponent(id)}${force ? "?force=true" : ""}`,
    { method: "DELETE" }
  );

export interface Metrics {
  cpu: { percent: number; threads: number; model: string };
  gpu: {
    available: boolean;
    name: string | null;
    percent: number | null;
    vramUsedMb: number | null;
    vramTotalMb: number | null;
  };
}

export const getMetrics = () => request<Metrics>("/api/metrics");

export type DoctorLevel = "required" | "optional" | "info";

export interface DoctorFix {

  auto: boolean;
  size?: string;
  manual?: string;

  command?: string;

  link?: string;
  url?: string;
}

export interface DoctorCheck {
  id: string;

  label: string;
  level: DoctorLevel;
  status: "ok" | "missing";

  detail: string;

  note?: string | null;
  fix: DoctorFix | null;
}

export interface DoctorReport {
  platform: string;
  ok: boolean;
  missingRequired: string[];
  checks: DoctorCheck[];
}

export interface DoctorFixResult {
  ok: boolean;
  installed: boolean;
  timedOut: boolean;
  log: string[];
  report: DoctorReport;
}

export const getDoctor = (refresh = false) =>
  request<DoctorReport>(`/api/doctor${refresh ? "?refresh=1" : ""}`);

export const fixDoctor = (id: string) =>
  post<DoctorFixResult>("/api/doctor/fix", { id });

export type TextSourceKind = "url" | "text";

export type TextToVideoStatus =
  | "draft"
  | "extracting"
  | "scripting"
  | "ready"
  | "voicing"
  | "building"
  | "editing"
  | "done"
  | "failed";

export interface ScriptChunk {
  text: string;
  durationSec: number | null;
}

export interface ExtractedArticle {
  title: string;
  blocks: string[];
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  canonicalUrl: string | null;
  leadImage: string | null;
  lang: string | null;
  chars: number;
}

export interface TextToVideoSource {
  kind: TextSourceKind;
  url: string;
  text: string;
}

export type TtsEngine = "gemini" | "vieneu" | "voicestudio";

export const TTS_ENGINES: TtsEngine[] = ["voicestudio", "gemini", "vieneu"];

export interface TextToVideoVoice {

  engine: TtsEngine;

  model: string | null;
  name: string;

  style: string;

  language: string;

  speed: number;
}

export const TTS_SPEED_MIN = 0.8;
export const TTS_SPEED_MAX = 1.6;

export interface TextToVideoOutput {
  width: number;
  height: number;
  fps: number;

  styleId: string | null;
}

export interface TextToVideoMeta {
  id: string;
  name: string;
  source: TextToVideoSource;

  article: ExtractedArticle | null;
  script: ScriptChunk[];

  scriptModel: string | null;
  voice: TextToVideoVoice;
  output: TextToVideoOutput;

  brief: Brief;

  voiceFile: string | null;

  voiceDurationSec: number | null;
  transcriptFile: string | null;

  projectId: string | null;
  status: TextToVideoStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TEXT_TO_VIDEO_STATUS_LABEL: Record<TextToVideoStatus, string> = {
  draft: "ttv.status.draft",
  extracting: "ttv.status.extracting",
  scripting: "ttv.status.scripting",
  ready: "ttv.status.ready",
  voicing: "ttv.status.voicing",
  building: "ttv.status.building",
  editing: "ttv.status.editing",
  done: "ttv.status.done",
  failed: "ttv.status.failed",
};

export const TEXT_TO_VIDEO_STATUS_TONE: Record<
  TextToVideoStatus,
  "success" | "running" | "danger" | "muted"
> = {
  draft: "muted",
  extracting: "running",
  scripting: "running",
  ready: "muted",
  voicing: "running",
  building: "running",
  editing: "running",
  done: "success",
  failed: "danger",
};

export interface TtsModel {
  id: string;
  label: string;
}

export type TtsGender = "nam" | "nu" | "trung-tinh";

export type TtsRegion = "bac" | "trung" | "nam";

export type TtsVoiceKind = "preset" | "cloned";

export interface TtsVoice {

  engine: TtsEngine;

  name: string;

  title: string;

  label: string;
  gender: TtsGender;

  f0: number;
  kind: TtsVoiceKind;
  region: TtsRegion | null;

  timbreKey: string | null;

  note: string;
}

export interface TtsEngineStatus {
  engine: TtsEngine;

  available: boolean;

  canClone: boolean;

  reason: string | null;

  detail: string;
}

export interface ClonedVoice {
  id: string;
  name: string;
  gender: TtsGender;
  note: string;

  refFile: string;

  refDurationSec: number;
  createdAt: string;
  updatedAt: string;
}

export const CLONE_REF_MIN_SEC = 3;
export const CLONE_REF_IDEAL_MAX_SEC = 8;
export const CLONE_REF_MAX_SEC = 30;

export interface TtsLanguage {
  code: string;
  label: string;
}

export type TextToVideoAspect = "9:16" | "16:9" | "1:1" | "4:5";

export const TEXT_TO_VIDEO_SIZES: Record<
  TextToVideoAspect,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const TEXT_TO_VIDEO_FPS = [24, 25, 30, 60] as const;

export const TEXT_TO_VIDEO_DEFAULT_OUTPUT: TextToVideoOutput = {
  width: 1080,
  height: 1920,
  fps: 30,
  styleId: null,
};

export const TTS_CHARS_PER_SEC = 15;

export function estimateChunkSeconds(chunk: ScriptChunk): number {
  if (typeof chunk.durationSec === "number" && chunk.durationSec > 0) {
    return chunk.durationSec;
  }
  return chunk.text.trim().length / TTS_CHARS_PER_SEC;
}

export function estimateScriptSeconds(chunks: ScriptChunk[]): number {
  return chunks.reduce((sum, c) => sum + estimateChunkSeconds(c), 0);
}

export function scriptChars(chunks: ScriptChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.text.trim().length, 0);
}

export function isTextToVideoJob(job: Job, sessionId?: string): boolean {
  if (job.type !== "text-to-video") return false;
  return sessionId === undefined || job.projectId === sessionId;
}

export const getTextToVideoSessions = () =>
  request<TextToVideoMeta[]>("/api/text-to-video");

export const getTextToVideoSession = (id: string) =>
  request<TextToVideoMeta>(`/api/text-to-video/${encodeURIComponent(id)}`);

export const createTextToVideo = (input: {

  name?: string;
  source: TextToVideoSource;
  brief?: Partial<Brief>;
}) => post<TextToVideoMeta>("/api/text-to-video", input);

export const updateTextToVideo = (
  id: string,
  patch: {
    name?: string;
    source?: TextToVideoSource;
    voice?: TextToVideoVoice;
    output?: TextToVideoOutput;
    brief?: Partial<Brief>;
    script?: ScriptChunk[];

    scriptModel?: string | null;
  }
) =>
  jsonBody<TextToVideoMeta>(
    `/api/text-to-video/${encodeURIComponent(id)}`,
    "PATCH",
    patch
  );

export const deleteTextToVideo = (id: string) =>
  request<void>(`/api/text-to-video/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const extractTextToVideo = (id: string) =>
  post<TextToVideoMeta>(`/api/text-to-video/${encodeURIComponent(id)}/extract`);

export const scriptTextToVideo = (
  id: string,
  input?: { targetSeconds?: number; model?: string }
) =>
  post<TextToVideoMeta>(
    `/api/text-to-video/${encodeURIComponent(id)}/script`,
    input && (input.targetSeconds !== undefined || input.model !== undefined)
      ? input
      : undefined
  );

export const buildTextToVideo = (id: string) =>
  post<{ jobId: string }>(`/api/text-to-video/${encodeURIComponent(id)}/build`);

export const getTtsModels = () => request<TtsModel[]>("/api/tts/models");

export const getTtsVoices = (engine?: TtsEngine) =>
  request<TtsVoice[]>(
    engine ? `/api/tts/voices?engine=${encodeURIComponent(engine)}` : "/api/tts/voices"
  );

export const getTtsEngines = (refresh = false) =>
  request<TtsEngineStatus[]>(`/api/tts/engines${refresh ? "?refresh=1" : ""}`);

export const getVideoStyles = () => request<VideoStyle[]>("/api/video-styles");

export interface ManagedVideoStyle {
  id: string;
  name: string;
  art: string;
  avoid: string;
  palette: VideoStylePalette;
  motion: string;

  builtin: boolean;

  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VideoStyleUsage {
  kind: "video-project" | "text-to-video" | "auto-cut" | "translate-video";
  id: string;
  name: string;
}

export type ManagedVideoStyleDetail = ManagedVideoStyle & {
  usage: VideoStyleUsage[];
};

export interface VideoStyleInput {
  name: string;
  art: string;
  avoid: string;
  palette: VideoStylePalette;
  motion: string;
}

export const getManagedVideoStyles = () =>
  request<ManagedVideoStyle[]>("/api/video-styles?full=1");

export const getVideoStyleDetail = (id: string) =>
  request<ManagedVideoStyleDetail>(
    `/api/video-styles/${encodeURIComponent(id)}`
  );

export const createVideoStyle = (
  input: Partial<VideoStyleInput> & { id?: string; cloneFrom?: string }
) => post<ManagedVideoStyle>("/api/video-styles", input);

export const updateVideoStyle = (id: string, patch: Partial<VideoStyleInput>) =>
  jsonBody<ManagedVideoStyle>(
    `/api/video-styles/${encodeURIComponent(id)}`,
    "PUT",
    patch
  );

export const deleteVideoStyle = (id: string, force = false) =>
  request<void>(
    `/api/video-styles/${encodeURIComponent(id)}${force ? "?force=1" : ""}`,
    { method: "DELETE" }
  );

export const resetVideoStyle = (id: string) =>
  post<ManagedVideoStyle>(`/api/video-styles/${encodeURIComponent(id)}/reset`);

export const getClonedVoices = () => request<ClonedVoice[]>("/api/voices");

export const createClonedVoice = (input: {
  name: string;
  gender: TtsGender;
  note?: string;
  file: File;
}) => {
  const form = new FormData();
  form.append("file", input.file);
  form.append("name", input.name);
  form.append("gender", input.gender);
  if (input.note) form.append("note", input.note);
  return request<ClonedVoice>(`${serverOrigin()}/api/voices`, {
    method: "POST",
    body: form,
  });
};

export const updateClonedVoice = (
  id: string,
  patch: { name?: string; gender?: TtsGender; note?: string }
) => jsonBody<ClonedVoice>(`/api/voices/${encodeURIComponent(id)}`, "PATCH", patch);

export const deleteClonedVoice = (id: string) =>
  request<{ id: string }>(`/api/voices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const getTtsLanguages = () =>
  request<TtsLanguage[]>("/api/tts/languages");

export async function previewTtsVoice(input: {
  voice: string;

  engine?: TtsEngine;
  model?: string | null;
  style?: string;

  language?: string;

  speed?: number;

  uiLang?: "vi" | "en";

  text?: string;
}): Promise<Blob> {
  return requestTtsWav("/api/tts/preview", input);
}

export function generateVoiceStudioSpeech(input: {voice: string; text: string; speed: number}): Promise<Blob> {
  return requestTtsWav("/api/tts/voicestudio/speech", input);
}

async function requestTtsWav(endpoint: string, input: unknown): Promise<Blob> {
  const token = await ensureToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("x-fabuloki-token", token);

  let res: Response;
  try {
    res = await fetch(withUploadToken(endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0
    );
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string };
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {

    }
    throw new ApiError(code, message, res.status);
  }
  return res.blob();
}

export async function previewClonedVoice(input: {
  id: string;

  uiLang?: "vi" | "en";
}): Promise<Blob> {
  const token = await ensureToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("x-fabuloki-token", token);

  let res: Response;
  try {
    res = await fetch(
      withUploadToken(`/api/voices/${encodeURIComponent(input.id)}/preview`),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ uiLang: input.uiLang }),
      }
    );
  } catch {
    throw new ApiError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0
    );
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string };
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {

    }
    throw new ApiError(code, message, res.status);
  }
  return res.blob();
}

export type TranslateMode = "subtitle" | "dub" | "both";

export type TranslateStatus =
  | "draft"
  | "transcribing"
  | "transcribed"
  | "translating"
  | "translated"
  | "rendering"
  | "done"
  | "failed";

export const SUBTITLE_FONTS = ["vietnamese", "sans", "serif", "mono"] as const;

export type SubtitleFontId = (typeof SUBTITLE_FONTS)[number];

export type SubtitleBackdrop = "blur" | "solid" | "none";

export interface SubtitleStyle {

  fontFamily: string;
  fontSizePx: number;
  color: string;
  backdrop: SubtitleBackdrop;
  backdropColor: string;
  blurPx: number;

  bottomPx: number;
}

export interface TranslatedCue {

  start: number;

  end: number;

  text: string;

  dubText?: string;

  original?: string;
  speaker?: string;
}

export type SttProvider = "local" | "gemini" | "soniox";

export interface SttCapability {
  id: SttProvider;

  label: string;
  diarization: boolean;
  available: boolean;

  why?: string;
}

export interface TranscriptInfo {
  provider: SttProvider;
  language: string;

  diarized: boolean;
  speakers: string[];
  wordTimestamps: boolean;
}

export interface DubVoiceAssignment {

  speaker: string;
  voice: string;
  engine: TtsEngine;
}

export interface DubSettings {
  engine: TtsEngine;

  model: string | null;

  language: string | null;

  voices: Record<string, string>;
  keepOriginal: boolean;

  originalVolume: number;
}

export interface DubInfo {
  file: string;
  durationSec: number;
  cues: number;
  stretched: number;
  overflowed: number;
  clipped: number;
  minTempo: number;
  maxTempo: number;
  assignments: DubVoiceAssignment[];

  speakerF0: Record<string, number>;
  signature: string;
  createdAt: string;
}

export interface TranslateVideoSource {

  relPath: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface TranslateVideoMeta {
  id: string;
  name: string;

  autoNamed: boolean;
  source: TranslateVideoSource;

  sourceLang: string;

  targetLang: string;

  dubLang: string | null;
  mode: TranslateMode;

  sttProvider: SttProvider;
  transcriptFile: string | null;

  transcriptInfo: TranscriptInfo | null;
  cues: TranslatedCue[];
  subtitleStyle: SubtitleStyle;

  dub: DubSettings;

  dubInfo: DubInfo | null;

  outputFile: string | null;
  status: TranslateStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TRANSLATE_VIDEO_STATUS_LABEL: Record<TranslateStatus, string> = {
  draft: "tv.status.draft",
  transcribing: "tv.status.transcribing",
  transcribed: "tv.status.transcribed",
  translating: "tv.status.translating",
  translated: "tv.status.translated",
  rendering: "tv.status.rendering",
  done: "tv.status.done",
  failed: "tv.status.failed",
};

export const TRANSLATE_VIDEO_STATUS_TONE: Record<
  TranslateStatus,
  "success" | "running" | "danger" | "muted"
> = {
  draft: "muted",
  transcribing: "running",
  transcribed: "muted",
  translating: "running",
  translated: "muted",
  rendering: "running",
  done: "success",
  failed: "danger",
};

export const TRANSLATE_MODE_LABEL: Record<TranslateMode, string> = {
  subtitle: "tv.mode.subtitle",
  dub: "tv.mode.dub",
  both: "tv.mode.both",
};

export const TRANSLATE_SOURCE_LANGS = [
  "auto",
  "vi",
  "en",
  "zh",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "th",
  "id",
  "hi",
  "ar",
  "it",
] as const;

export const TRANSLATE_TARGET_LANGS = TRANSLATE_SOURCE_LANGS.filter(
  (code) => code !== "auto"
);

export const TRANSLATE_DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "vietnamese",
  fontSizePx: 48,
  color: "#ffffff",
  backdrop: "blur",
  backdropColor: "#000000",
  blurPx: 12,
  bottomPx: 120,
};

export const SUBTITLE_FONT_SIZE_MIN = 16;
export const SUBTITLE_FONT_SIZE_MAX = 160;
export const SUBTITLE_BLUR_MAX = 40;
export const SUBTITLE_BOTTOM_MAX = 600;

export const TRANSLATE_PROVIDER = "Gemini";

export const DEFAULT_TRANSLATE_MODEL = "gemini-2.5-flash";

export interface TranslateModelOption {
  id: string;
  labelKey: string;
}

export const TRANSLATE_MODELS: TranslateModelOption[] = [
  { id: "gemini-2.5-flash", labelKey: "tv.model.gemini-2.5-flash" },
  { id: "gemini-2.5-pro", labelKey: "tv.model.gemini-2.5-pro" },
  { id: "gemini-2.5-flash-lite", labelKey: "tv.model.gemini-2.5-flash-lite" },
];

export const DUB_ALL_SPEAKERS = "";

export const DUB_ORIGINAL_VOLUME_MAX = 0.12;
export const DUB_TEMPO_MAX = 1.25;

export const TRANSLATE_DEFAULT_DUB: DubSettings = {
  engine: "gemini",
  model: null,
  language: null,
  voices: {},
  keepOriginal: false,
  originalVolume: 0.1,
};

export function isTranslateVideoJob(job: Job, sessionId?: string): boolean {
  if (job.type !== "translate-video") return false;
  return sessionId === undefined || job.projectId === sessionId;
}

export const getTranslateVideos = () =>
  request<TranslateVideoMeta[]>("/api/translate-video");

export const getTranslateVideo = (id: string) =>
  request<TranslateVideoMeta>(`/api/translate-video/${encodeURIComponent(id)}`);

export const createTranslateVideo = (input?: { name?: string }) =>
  post<TranslateVideoMeta>("/api/translate-video", input);

export const updateTranslateVideo = (
  id: string,
  patch: {
    name?: string;
    sourceLang?: string;
    targetLang?: string;
    mode?: TranslateMode;
    sttProvider?: SttProvider;
    cues?: TranslatedCue[];
    subtitleStyle?: SubtitleStyle;

    dub?: DubSettings;
  }
) =>
  jsonBody<TranslateVideoMeta>(
    `/api/translate-video/${encodeURIComponent(id)}`,
    "PATCH",
    patch
  );

export const deleteTranslateVideo = (id: string) =>
  request<void>(`/api/translate-video/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const uploadTranslateVideoSource = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<TranslateVideoMeta>(
    `${serverOrigin()}/api/translate-video/${encodeURIComponent(id)}/source`,
    { method: "POST", body: form }
  );
};

export const getSttProviders = () =>
  request<SttCapability[]>("/api/translate-video/stt-providers");

export const transcribeTranslateVideo = (
  id: string,
  input?: { sttProvider?: SttProvider }
) =>
  post<{ jobId: string }>(
    `/api/translate-video/${encodeURIComponent(id)}/transcribe`,
    input && input.sttProvider !== undefined ? input : undefined
  );

export const translateTranslateVideo = (id: string, input?: { model?: string }) =>
  post<TranslateVideoMeta>(
    `/api/translate-video/${encodeURIComponent(id)}/translate`,
    input && input.model !== undefined ? input : undefined
  );

export const renderTranslateVideo = (id: string) =>
  post<{ jobId: string }>(
    `/api/translate-video/${encodeURIComponent(id)}/render`
  );

export interface DubPreviewResult {
  audio: Blob;

  voice: string;

  naturalSec: number;

  finalSec: number;

  sourceSec: number;
  tempo: number;

  clipped: boolean;

  overflowed: boolean;
}

export async function dubPreviewTranslateVideo(
  id: string,
  input?: { index?: number; voice?: string }
): Promise<DubPreviewResult> {
  const token = await ensureToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("x-fabuloki-token", token);

  let res: Response;
  try {
    res = await fetch(
      withUploadToken(
        `/api/translate-video/${encodeURIComponent(id)}/dub-preview`
      ),
      { method: "POST", headers, body: JSON.stringify(input ?? {}) }
    );
  } catch {
    throw new ApiError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0
    );
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string };
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {

    }
    throw new ApiError(code, message, res.status);
  }
  const num = (name: string): number => {
    const v = Number(res.headers.get(name));
    return Number.isFinite(v) ? v : 0;
  };
  return {
    audio: await res.blob(),
    voice: decodeURIComponent(res.headers.get("x-dub-voice") ?? ""),
    naturalSec: num("x-dub-natural"),
    finalSec: num("x-dub-final"),
    sourceSec: num("x-dub-source"),

    tempo: num("x-dub-tempo") || 1,
    clipped: res.headers.get("x-dub-clipped") === "1",
    overflowed: res.headers.get("x-dub-overflowed") === "1",
  };
}

export interface TimelineZoomKey {
  frame: number;
  scale: number;
  ease?: "linear" | "out" | "inOut";
  [key: string]: unknown;
}

export interface TimelineZoom {
  origin?: string;
  keys: TimelineZoomKey[];
  [key: string]: unknown;
}

export interface TimelineScene {
  id: string;

  src?: string;
  srcVideo?: string;
  srcImage?: string | null;
  render?: string;
  from?: number;
  to?: number;
  durationInFrames?: number;

  transitionOverlap?: number;
  muted?: boolean;
  zoom?: TimelineZoom;

  fit?: "cover" | "contain";

  transform?: TimelineFrameTransform;
  crop?: TimelineCrop;
  color?: ColorAdjust;

  volume?: number;

  fadeInSec?: number;
  fadeOutSec?: number;

  speed?: number;

  transition?: { type: TransitionType; [key: string]: unknown };
  [key: string]: unknown;
}

export type TransitionType =
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "wipe-left"
  | "wipe-right"
  | "zoom-in"
  | "zoom-out"
  | "blur"
  | "none";

export interface ColorAdjust {
  preset?: string;

  brightness?: number;

  contrast?: number;

  saturation?: number;

  temperature?: number;

  tint?: number;

  hue?: number;

  vignette?: number;

  blur?: number;
  [key: string]: unknown;
}

export interface TimelineCrop {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  [key: string]: unknown;
}

export interface TimelineFrameTransform {
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  [key: string]: unknown;
}

export type LayerAnim =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "pop"
  | "zoom";

export interface LayerKeyframe {
  frame: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;

  ease?: "linear" | "in" | "out" | "inOut";
  [key: string]: unknown;
}

export interface LayerStyle {

  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  backgroundColor?: string;
  paddingPx?: number;
  radiusPx?: number;
  strokeColor?: string;
  strokeWidthPx?: number;
  shadow?: boolean;
  [key: string]: unknown;
}

export interface Layer {
  id: string;
  kind: "image" | "video" | "text" | "shape";
  from: number;
  durationInFrames: number;

  src?: string;

  mediaStart?: number;

  muted?: boolean;

  volume?: number;

  text?: string;
  style?: LayerStyle;

  width?: number;

  aspect?: number;

  transform?: TimelineFrameTransform;

  opacity?: number;
  fit?: "cover" | "contain";
  crop?: TimelineCrop;
  color?: ColorAdjust;

  radiusPx?: number;

  animation?: { in?: LayerAnim; out?: LayerAnim; durationSec?: number; [key: string]: unknown };
  keyframes?: LayerKeyframe[];
  [key: string]: unknown;
}

export interface TimelineSfx {
  file: string;
  atFrame: number;
  volume?: number;
  mediaStart?: number;

  fadeInSec?: number;
  fadeOutSec?: number;
  [key: string]: unknown;
}

export interface TimelineMusic {
  file: string;
  volume?: number;
  duckVolume?: number;
  speech?: [number, number][];

  fadeInSec?: number;
  fadeOutSec?: number;
  [key: string]: unknown;
}

export interface TimelineAudio {
  voice: string | null;
  sfx: TimelineSfx[];
  music: TimelineMusic | null;
  [key: string]: unknown;
}

export interface TimelineCaptionWord {
  text: string;
  start: number;
  end: number;
  hi?: boolean;
  [key: string]: unknown;
}

export interface TimelineCueTransform {
  x?: number;
  y?: number;
  scale?: number;
  [key: string]: unknown;
}

export interface TimelineCaptionCue {
  from: number;
  durationInFrames: number;
  words: TimelineCaptionWord[];
  transform?: TimelineCueTransform;
  [key: string]: unknown;
}

export interface TimelineSubtitleCue {
  from: number;
  durationInFrames: number;
  text: string;
  transform?: TimelineCueTransform;
  [key: string]: unknown;
}

export type TimelineSubtitleStyle = Partial<SubtitleStyle> & { [key: string]: unknown };

export interface TimelineHighlightPart {
  t: string;
  hi?: boolean;
  [key: string]: unknown;
}

export interface TimelineHighlightCue {
  from: number;
  durationInFrames: number;
  kicker?: string;
  parts: TimelineHighlightPart[];
  tier?: "main" | "sub";
  accent?: "hot" | "cool";
  transform?: TimelineCueTransform;
  [key: string]: unknown;
}

export interface Timeline {
  scenes: TimelineScene[];
  audio: TimelineAudio;
  captions: TimelineCaptionCue[];
  subtitles: TimelineSubtitleCue[];

  subtitleStyle?: TimelineSubtitleStyle;
  overlays: TimelineHighlightCue[];

  layers?: Layer[];
}

export type TimelinePatch = Partial<Omit<Timeline, "subtitleStyle" | "layers">> & {
  subtitleStyle?: TimelineSubtitleStyle | null;
  layers?: Layer[] | null;
};

export interface TimelineMediaInfo {

  durationSec: number | null;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

export interface TimelinePreview {

  sceneRenders: Record<string, string | null>;

  watermark: { file: string; position: "top-left" } | null;

  media: Record<string, TimelineMediaInfo>;

  mediaVersions?: Record<string, number>;
}

export interface TimelineLock {

  agentBusy: boolean;

  renderActive: boolean;
  sessionId: string | null;
}

export interface TimelineProject {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: ProjectStatus;
  updatedAt: string | null;
}

export interface TimelineResponse {
  version: string;
  timeline: Timeline;
  project: TimelineProject;
  preview: TimelinePreview;
  lock: TimelineLock;
}

export interface TimelineSaved {
  version: string;
  timeline: Timeline;
}

export interface TimelineIssue {
  path: string;
  message: string;
}

export type TimelineRevisionSource = "editor" | "ai-before" | "ai-after" | "restore";

export interface TimelineRevision {

  rev: string;
  createdAt: string;

  label: string | null;
  source: TimelineRevisionSource;
  version: string;
}

export type LibraryKind = "sfx" | "music";

export interface LibraryItem {
  file: string;
  durationMs: number | null;
  description: string;
  tags: string[];

  available: boolean;
}

export interface LibraryImportResult {

  relPath: string;
  durationSec: number | null;

  copied: boolean;
}

export type EditorRenderQuality = "draft" | "final";

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const getTimeline = (projectId: string) =>
  request<TimelineResponse>(`${projectPath(projectId)}/timeline`);

export const saveTimeline = (
  projectId: string,
  baseVersion: string,
  timeline: TimelinePatch,
  label?: string
) =>
  jsonBody<TimelineSaved>(`${projectPath(projectId)}/timeline`, "PUT", {
    baseVersion,
    timeline,
    ...(label ? { label } : {}),
  });

const KEEPALIVE_MAX_BYTES = 60_000;

export function saveTimelineOnLeave(
  projectId: string,
  baseVersion: string,
  timeline: TimelinePatch,
  label: string,
  opts: { dryRun?: boolean } = {},
): { keepalive: boolean; promise: Promise<Response> | null } {
  const body = JSON.stringify({ baseVersion, timeline, label });
  const keepalive = new Blob([body]).size <= KEEPALIVE_MAX_BYTES;
  if (opts.dryRun) return { keepalive, promise: null };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiToken) headers["x-fabuloki-token"] = apiToken;
  const promise = fetch(withUploadToken(`${projectPath(projectId)}/timeline`), {
    method: "PUT",
    headers,
    body,
    keepalive,
  });

  promise.catch(() => {});
  return { keepalive, promise };
}

export const getTimelineRevisions = (projectId: string) =>
  request<TimelineRevision[]>(`${projectPath(projectId)}/timeline/revisions`);

export const restoreTimelineRevision = (
  projectId: string,
  rev: string,
  baseVersion: string
) =>
  post<TimelineSaved>(
    `${projectPath(projectId)}/timeline/revisions/${encodeURIComponent(rev)}/restore`,
    { baseVersion }
  );

export const getMediaInfo = (projectId: string, relPath: string) =>
  request<TimelineMediaInfo>(
    `${projectPath(projectId)}/media-info?path=${encodeURIComponent(relPath)}`
  );

export const getLibrarySfx = () => request<LibraryItem[]>("/api/library/sfx");

export const getLibraryMusic = () => request<LibraryItem[]>("/api/library/music");

export const importLibraryFile = (projectId: string, kind: LibraryKind, file: string) =>
  post<LibraryImportResult>(`${projectPath(projectId)}/library-import`, { kind, file });

export const startEditorRender = (
  projectId: string,
  quality: EditorRenderQuality,
  opts?: { force?: boolean }
) =>
  post<{ jobs: Job[] }>(`${projectPath(projectId)}/editor/render`, {
    quality,
    ...(opts?.force ? { force: true } : {}),
  });

export const sendEditorChat = (
  projectId: string,
  message: string,
  sessionId?: string,
  opts?: { model?: string; effort?: AgentEffort }
) =>
  post<{ sessionId: string }>(`${projectPath(projectId)}/editor/chat`, {
    message,
    ...(sessionId ? { sessionId } : {}),
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.effort ? { effort: opts.effort } : {}),
  });

export const timelineExportUrl = (projectId: string) =>
  withUploadToken(`${projectPath(projectId)}/timeline/export.xml`);

export function timelineConflictOf(err: unknown): TimelineSaved | null {
  if (!(err instanceof ApiError) || err.code !== "VERSION_CONFLICT") return null;
  const current = err.data.current as TimelineSaved | undefined;
  return current && typeof current.version === "string" ? current : null;
}

export function timelineIssuesOf(err: unknown): TimelineIssue[] {
  if (!(err instanceof ApiError) || err.code !== "INVALID_TIMELINE") return [];
  return Array.isArray(err.data.issues) ? (err.data.issues as TimelineIssue[]) : [];
}

export type ImageProviderId = "gemini-api";

export interface ImageProviderInfo {
  id: ImageProviderId | string;
  label: string;

  configured: boolean;
  models: string[];
}

export interface ImageProvidersResponse {
  default: ImageProviderId | "auto" | string;

  providers: ImageProviderInfo[];
}

export const getImageProviders = () => request<ImageProvidersResponse>("/api/image-providers");

export interface GenerateProjectImageInput {
  prompt: string;

  provider?: ImageProviderId | "auto";

  purpose: "filler" | "layer";

  allowText?: boolean;
}

export interface GenerateImageTask {
  status: "running" | "done" | "failed";

  relPath?: string;
  provider?: string;
  error?: { code: string; message: string };
  elapsedSec: number;
}

export const generateProjectImage = (projectId: string, body: GenerateProjectImageInput) =>
  post<{ taskId: string }>(`${projectPath(projectId)}/generate-image`, body);

export const getGenerateImageTask = (projectId: string, taskId: string) =>
  request<GenerateImageTask>(
    `${projectPath(projectId)}/generate-image/${encodeURIComponent(taskId)}`
  );

export const generateProjectText = (
  projectId: string,
  body: { prompt: string; atSec?: number; context?: string }
) => post<{ text: string }>(`${projectPath(projectId)}/generate-text`, body);

export const startEditorHandoff = (
  projectId: string,
  body: { instruction: string; finishMode?: "draft" | "final" }
) =>
  post<{
    sessionId: string;
    finishMode: "draft" | "final";

    beforeRev: string | null;
  }>(`${projectPath(projectId)}/editor/handoff`, body);
