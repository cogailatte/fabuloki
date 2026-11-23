"use client";

import { Check, Loader2 } from "lucide-react";
import type { FileInfo, Job, ProjectStatus, SceneMeta } from "@/lib/api";
import { useT } from "@/lib/i18n";

const STEPS = [
  "pipeline.analyze",
  "pipeline.build-scenes",
  "pipeline.render-draft",
  "pipeline.assemble-draft",
  "pipeline.render-final",
  "pipeline.done",
] as const;

export interface PipelineStageInput {
  metaStatus: ProjectStatus | undefined;
  hasOutput: boolean;
  scenes: SceneMeta[];
  renders: FileInfo[];

  jobs: Job[];

  sessionRunning: boolean;
}

export interface PipelineStage {
  stage: number;
  active: boolean;
}

function doneJobFloor(jobs: Job[]): number {
  let floor = 0;
  for (const j of jobs) {
    if (j.status !== "done") continue;
    const f =
      j.type === "scene-draft"
        ? 3
        : j.type === "assemble-draft"
          ? 4
          : j.type === "scene-final" || j.type === "assemble-final"
            ? 5
            : 0;
    if (f > floor) floor = f;
  }
  return floor;
}

export function deriveStage(input: PipelineStageInput): PipelineStage | null {
  const { metaStatus, hasOutput, scenes, renders, jobs, sessionRunning } =
    input;

  if (metaStatus === "done" && hasOutput) return { stage: 6, active: false };

  const activeTypes = new Set(
    jobs
      .filter((j) => j.status === "running" || j.status === "queued")
      .map((j) => j.type)
  );
  if (activeTypes.has("scene-final") || activeTypes.has("assemble-final"))
    return { stage: 5, active: true };
  if (activeTypes.has("assemble-draft")) return { stage: 4, active: true };
  if (activeTypes.has("scene-draft")) return { stage: 3, active: true };

  const hasDraftRender = renders.some((f) => f.kind === "video");
  const artifactFloor = hasDraftRender ? 3 : scenes.length > 0 ? 2 : 0;
  const floor = Math.max(artifactFloor, doneJobFloor(jobs));

  if (sessionRunning) {

    return { stage: Math.max(floor, 1), active: true };
  }

  if (floor === 0) return null;
  return { stage: floor, active: false };
}

export function StepperBar({
  steps,
  stage,
  active,
  done,
  marker = "dot",
  wrapLabels = false,
  ariaLabel,
}: {
  steps: readonly string[];
  stage: number;
  active: boolean;
  done: boolean;
  marker?: "dot" | "spinner";
  wrapLabels?: boolean;
  ariaLabel?: string;
}) {
  const { t } = useT();
  return (
    <ol className="flex w-full min-w-0 items-start" aria-label={ariaLabel}>
      {steps.flatMap((label, i) => {
        const n = i + 1;
        const passed = n < stage || (n === stage && done);
        const current = n === stage && !done;
        const labelCls = current
          ? "font-semibold text-[var(--text)]"
          : passed
            ? "text-[var(--text-muted)]"
            : "text-[var(--text-muted)] opacity-60";
        const items = [];
        if (i > 0) {

          items.push(
            <li
              key={`c-${i}`}
              aria-hidden="true"
              className={`mx-1 mt-2 h-px min-w-2 flex-1 ${
                n <= stage ? "bg-[var(--success)]" : "bg-[var(--border)]"
              }`}
            />,
          );
        }
        items.push(
          <li
            key={label}
            className="flex shrink-0 flex-col items-center gap-1"
            aria-current={current ? "step" : undefined}
          >
            <span aria-hidden="true" className="flex h-4 items-center justify-center">
              {passed ? (
                <Check size={13} strokeWidth={3.5} className="text-[var(--success)]" />
              ) : current && marker === "spinner" ? (
                <Loader2
                  size={14}
                  strokeWidth={2.5}
                  className="animate-spin text-[var(--primary)]"
                />
              ) : current ? (
                <span
                  className={`h-2.5 w-2.5 rounded-full bg-[var(--primary)] ring-[3px] ring-[var(--primary-soft)]${
                    active ? " animate-pulse" : ""
                  }`}
                />
              ) : (
                <span className="h-2 w-2 rounded-full bg-[var(--border)]" />
              )}
            </span>
            <span
              className={`text-center text-xs leading-tight ${
                wrapLabels ? "" : "whitespace-nowrap"
              } ${labelCls}`}
            >
              {t(label)}
            </span>
          </li>,
        );
        return items;
      })}
    </ol>
  );
}

export function PipelineTimeline(props: PipelineStageInput) {
  const { t, tf } = useT();
  const derived = deriveStage(props);
  if (!derived) return null;
  const { stage, active } = derived;

  const done = stage === 6 && !active;
  return (
    <StepperBar
      steps={STEPS}
      stage={stage}
      active={active}
      done={done}
      ariaLabel={tf("pipeline.aria", { stage, label: t(STEPS[stage - 1]) })}
    />
  );
}
