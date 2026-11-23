

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export const sceneSpeedOf = (scene: { speed?: unknown }): number => {
  const v = scene.speed;
  return typeof v === "number" && Number.isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX ? v : 1;
};

export const footageDurationFrames = (
  from: number,
  to: number,
  fps: number,
  speed = 1,
): number => {
  const sourceFrames = Math.round(to * fps) - Math.round(from * fps);
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(1, Math.round(sourceFrames / rate));
};

export const rawSceneDurationFrames = (
  scene: {
    durationInFrames?: unknown;
    srcVideo?: unknown;
    from?: unknown;
    to?: unknown;
    speed?: unknown;
  },
  fps: number,
): number | null => {
  if (typeof scene.durationInFrames === "number") return scene.durationInFrames;
  if (
    typeof scene.srcVideo === "string" &&
    scene.srcVideo &&
    typeof scene.from === "number" &&
    typeof scene.to === "number"
  ) {
    return footageDurationFrames(scene.from, scene.to, fps, sceneSpeedOf(scene));
  }
  return null;
};
