"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { createVideoStyle, getProjects, getSfx, getVideoStyles, mediaUrl, updateBrief } from "@/lib/api";
import { QuizzyMotionLibrary } from "@/components/QuizzyMotionLibrary";

const modes = [
  ["edit", "Dựng clip"],
  ["style", "Học style"],
  ["library", "Motion & SFX"],
] as const;
type Mode = (typeof modes)[number][0];

export default function QuizzyPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("edit");
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof getProjects>> | null>(null);
  const [styles, setStyles] = useState<Awaited<ReturnType<typeof getVideoStyles>>>([]);
  const [sounds, setSounds] = useState<Awaited<ReturnType<typeof getSfx>>>([]);
  const [project, setProject] = useState("");
  const [motionIds, setMotionIds] = useState<string[]>([]);
  const [preset, setPreset] = useState("quizzy-kem-vang");
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [savedStyle, setSavedStyle] = useState("");
  const [sound, setSound] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getProjects(), getVideoStyles(), getSfx()]).then(([items, presets, library]) => {
      if (!active) return;
      setProjects(items);
      setStyles(presets.filter(item => item.id.startsWith("quizzy-")));
      setSounds(library.filter(item => item.tags.includes("quizzy")));
    }).catch(error => {
      if (active) setMessage(error.message);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!reference) return;
    const url = URL.createObjectURL(reference);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);

  async function applyQuizzy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !styles.some(style => style.id === preset)) return;
    setBusy(true);
    setMessage("");
    try {
      await updateBrief(project, {
        skill: "quizzy-edit",
        quizzyMotionIds: motionIds,
        videoStyleEnabled: true,
        videoStyleId: preset,
      });
      router.push("/projects/" + encodeURIComponent(project) + "#project-block-brief");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  async function saveStyle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    const notes = String(fields.get("motion") ?? "").trim();
    if (!name || !notes) return;
    setBusy(true);
    setMessage("");
    try {
      const style = await createVideoStyle({
        cloneFrom: preset,
        name: "Quizzy · " + name,
        motion: notes,
      });
      setStyles(current => [...current, style]);
      setPreset(style.id);
      setSavedStyle(style.id);
      setMessage("Đã lưu phong cách. Bạn có thể chọn nó trong tab Dựng clip.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <PageHeader title="Quizzy" subtitle="Dựng video người nói trực diện bằng tiếng Việt." />
      <nav className="flex flex-wrap gap-2" aria-label="Chế độ Quizzy">
        {modes.map(([id, label]) => (
          <Button key={id} variant={mode === id ? "primary" : "secondary"}
            aria-pressed={mode === id} disabled={busy}
            onClick={() => { setMode(id); setMessage(""); }}>
            {label}
          </Button>
        ))}
      </nav>
      <section className="rounded-xl border border-[var(--border)] p-4 sm:p-6">
        {mode === "edit" && (
          <form onSubmit={applyQuizzy} className="grid max-w-xl gap-4">
            <h2 className="text-sm font-semibold">Dựng clip theo Quizzy</h2>
            <label className="grid gap-2">Dự án
              <select className="input" value={project} onChange={event => setProject(event.target.value)} required>
                <option value="">{projects === null ? "Đang tải dự án…" : "Chọn dự án video"}</option>
                {projects?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="grid gap-2">Phong cách dựng
              <select className="input" value={preset} onChange={event => setPreset(event.target.value)}>
                {styles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <p className="text-sm text-[var(--text-muted)]">{motionIds.length ? motionIds.length + " motion đã chọn. " : "AI tự chọn motion theo lời nói. "}Phụ đề, nhấn từ, âm thanh và chế độ hoàn tất theo thiết lập của dự án. Sau khi áp dụng, mở dự án để kiểm tra và bắt đầu dựng.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy || !project || !styles.some(item => item.id === preset)}>Áp dụng và mở dự án</Button>
              <Link href="/projects" className="underline">Danh sách dự án</Link>
            </div>
          </form>
        )}
        {mode === "style" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="grid content-start gap-3">
              <h2 className="text-sm font-semibold">Xem video tham chiếu</h2>
              <label className="grid gap-2">Video mẫu
                <input className="input" type="file" accept="video/*"
                  onChange={event => { setReferenceUrl(""); setReference(event.target.files?.[0] ?? null); }} />
              </label>
              {referenceUrl && <video controls playsInline src={referenceUrl} className="max-h-80 w-full rounded-lg bg-black" />}
            </div>
            <form onSubmit={saveStyle} className="grid content-start gap-3">
              <h2 className="text-sm font-semibold">Ghi và lưu phong cách</h2>
              <p className="text-sm text-[var(--text-muted)]">Xem mẫu và ghi lại nhịp cắt, màu, chữ và chuyển động. Fabuloki lưu ghi chú thành một phong cách dựng có thể chọn lại.</p>
              <label className="grid gap-2">Tên phong cách<input className="input" name="name" maxLength={70} required /></label>
              <label className="grid gap-2">Ghi chú dựng<textarea className="input" name="motion" rows={5} required placeholder="00:02 · chữ vàng bật lên khi nói từ khóa…" /></label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy || !styles.some(item => item.id === preset)}>Lưu phong cách</Button>
                {savedStyle && <Link className="underline" href={"/video-styles/" + encodeURIComponent(savedStyle)}>Mở phong cách đã lưu</Link>}
              </div>
            </form>
          </div>
        )}
        {mode === "library" && (
          <div className="grid gap-6">
            <QuizzyMotionLibrary selectedIds={motionIds} onSelectionChange={setMotionIds} />
            <div className="grid content-start gap-3">
              <h2 className="text-sm font-semibold">Âm thanh Quizzy</h2>
              <label className="grid gap-2">Nghe thử
                <select className="input" value={sound} onChange={event => setSound(event.target.value)}>
                  <option value="">Chọn tiếng hiệu ứng</option>
                  {sounds.map(item => <option key={item.file} value={item.file}>{item.description}</option>)}
                </select>
              </label>
              {sound && <audio key={sound} controls src={mediaUrl("assets/sound-effects/" + sound)} className="w-full" />}
              <Link href="/sfx" className="underline">Mở thư viện SFX Fabuloki</Link>
            </div>
          </div>
        )}
      </section>
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  );
}
