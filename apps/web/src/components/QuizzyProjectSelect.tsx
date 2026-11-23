"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { QuizzyMotionLibrary } from "@/components/QuizzyMotionLibrary";
import { getVideoStyles, type Brief, type VideoStyle } from "@/lib/api";

export function QuizzyProjectSelect({
  value,
  onChange,
}: {
  value: Brief;
  onChange: (patch: Partial<Brief>) => void;
}) {
  const [styles, setStyles] = useState<VideoStyle[]>([]);
  const [motionOpen, setMotionOpen] = useState(false);
  const [error, setError] = useState("");
  const active = value.skill === "quizzy-edit";

  useEffect(() => {
    let alive = true;
    getVideoStyles().then(items => {
      if (alive) setStyles(items.filter(item => item.id.startsWith("quizzy-")));
    }).catch(error => {
      if (alive) setError(error instanceof Error ? error.message : String(error));
    });
    return () => { alive = false; };
  }, []);

  function choose(styleId: string) {
    onChange({
      skill: "quizzy-edit",
      videoStyleEnabled: true,
      videoStyleId: styleId,
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border border-[var(--border)] p-3">
      <label className="grid gap-2">
        Cách dựng video
        <select className="input" value={active ? "quizzy" : "custom"}
          onChange={event => {
            if (event.target.value === "quizzy") {
              const selected = styles.find(style => style.id === value.videoStyleId);
              choose(selected?.id ?? styles[0].id);
            } else {
              onChange({
                skill: null,
                ...(value.videoStyleId?.startsWith("quizzy-")
                  ? { videoStyleEnabled: false, videoStyleId: null } : {}),
              });
            }
          }}>
          <option value="custom">Theo thiết lập dự án</option>
          <option value="quizzy" disabled={!styles.length}>Quizzy</option>
        </select>
      </label>
      {active && (
        <>
          <label className="grid gap-2">
            Phong cách Quizzy
            <select className="input" value={value.videoStyleId ?? ""}
              onChange={event => choose(event.target.value)}>
              {!styles.some(style => style.id === value.videoStyleId) && (
                <option value={value.videoStyleId ?? ""}>Chọn phong cách Quizzy</option>
              )}
              {styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button small variant="secondary" onClick={() => setMotionOpen(true)}>Chọn motion</Button>
            <span className="text-meta">{value.quizzyMotionIds?.length ? value.quizzyMotionIds.length + " mẫu đã chọn" : "AI tự chọn motion"}</span>
          </div>
          <Modal wide open={motionOpen} title="Motion Quizzy" onClose={() => setMotionOpen(false)}
            footer={<Button onClick={() => setMotionOpen(false)}>Xong</Button>}>
            {motionOpen && <QuizzyMotionLibrary selectedIds={value.quizzyMotionIds ?? []}
              onSelectionChange={ids => onChange({quizzyMotionIds: ids})} />}
          </Modal>
          <p className="text-meta text-[var(--text-muted)]">
            Quizzy chọn cách dựng motion. Các công tắc bên dưới quyết định phụ đề, nhấn từ, bố cục Key và âm thanh. Màu, font và logo theo nhận diện thương hiệu.
          </p>
        </>
      )}
      {error && <p role="status" className="text-meta">Chưa tải được preset Quizzy. Tải lại trang để thử lại.</p>}
    </div>
  );
}
