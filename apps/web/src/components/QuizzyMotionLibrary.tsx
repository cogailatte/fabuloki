"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import motions from "../../../../assets/quizzy/motions.json";

export function QuizzyMotionLibrary({ selectedIds, onSelectionChange }: {
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
} = {}) {
  const [localIds, setLocalIds] = useState<string[]>([]);
  const selected = selectedIds ?? localIds;
  const update = onSelectionChange ?? setLocalIds;

  return (
    <section className="grid gap-4">
      <h2 className="text-sm font-semibold">Motion Quizzy · {motions.length} mẫu</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Button small variant={selected.length ? "secondary" : "primary"} onClick={() => update([])}>AI tự chọn</Button>
        <span role="status" className="text-sm">{selected.length ? "Đã chọn " + selected.length + " mẫu" : "AI chọn mẫu theo lời nói"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {motions.map(({ id, name, motion }) => {
          const active = selected.includes(id);
          return (
            <article key={id} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold">{name}</h3>
              <p className="text-meta text-[var(--text-muted)]">{motion}</p>
              <div>
                <Button small variant={active ? "primary" : "secondary"} aria-pressed={active}
                  onClick={() => update(active ? selected.filter(value => value !== id) : [...selected, id])}>
                  {active ? "Đã chọn" : "Chọn mẫu"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
