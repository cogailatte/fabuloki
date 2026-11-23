"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { getTtsVoices, previewTtsVoice, generateVoiceStudioSpeech, type TtsVoice } from "@/lib/api";

export function VoiceStudioVoices({ playing, onPlay, onStop }: {
  playing: string | null;
  onPlay: (key: string, src: string, opts?: {objectUrl?: boolean}) => void;
  onStop: () => void;
}) {
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(1);
  const [output, setOutput] = useState<{blob: Blob; url: string; voice: string} | null>(null);

  useEffect(() => {
    return () => { if (output) URL.revokeObjectURL(output.url); };
  }, [output]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getTtsVoices("voicestudio").then(items => {
      if (active) {
        setVoices(items);
        setSelectedVoice(current => items.some(voice => voice.name === current) ? current : items[0]?.name ?? "");
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [revision]);

  async function preview(voice: TtsVoice) {
    const key = "voicestudio:" + voice.name;
    if (playing === key) { onStop(); return; }
    if (busy) return;
    onStop();
    setBusy(voice.name);
    setError("");
    try {
      const wav = await previewTtsVoice({engine: "voicestudio", voice: voice.name, language: "vi-VN", uiLang: "vi", speed: 1});
      if (mounted.current) onPlay(key, URL.createObjectURL(wav), {objectUrl: true});
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selectedVoice || !text.trim()) return;
    const voice = voices.find(item => item.name === selectedVoice);
    if (!voice) return;
    onStop();
    setBusy("generate");
    setError("");
    try {
      const blob = await generateVoiceStudioSpeech({voice: selectedVoice, text, speed});
      if (mounted.current) setOutput({blob, url: URL.createObjectURL(blob), voice: voice.title});
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)]">Giọng được lấy từ VoiceStudio đang mở trên máy này. Khi dựng, chọn nguồn giọng VoiceStudio và đúng tên giọng.</p>
        <Button variant="secondary" disabled={loading || busy !== null} onClick={() => setRevision(value => value + 1)}>Tải lại giọng</Button>
      </div>
      {error && <ErrorBanner message="VoiceStudio chưa hoàn tất thao tác" detail={error} />}
      <Card>
        <form onSubmit={generate} className="grid gap-4">
          <h2 className="text-sm font-semibold">Tạo giọng đọc</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2">Giọng đọc
              <select className="input" value={selectedVoice} disabled={loading || busy !== null}
                onChange={event => setSelectedVoice(event.target.value)}>
                {!voices.length && <option value="">Chưa có giọng</option>}
                {voices.map(voice => <option key={voice.name} value={voice.name}>{voice.title}</option>)}
              </select>
            </label>
            <label className="grid gap-2">Tốc độ
              <select className="input" value={speed} disabled={busy !== null}
                onChange={event => setSpeed(Number(event.target.value))}>
                {[.75, 1, 1.15, 1.25, 1.5].map(value => <option key={value} value={value}>{value === 1 ? "Bình thường" : "×" + value}</option>)}
              </select>
            </label>
          </div>
          <label className="grid gap-2">Nội dung cần đọc
            <textarea className="input" rows={6} maxLength={4096} value={text} required
              disabled={busy !== null} placeholder="Nhập lời thuyết minh của bạn…"
              onChange={event => setText(event.target.value)} />
            <span className="text-meta text-[var(--text-muted)]">{text.length} / 4096 ký tự</span>
          </label>
          <div>
            <Button type="submit" disabled={loading || busy !== null || !selectedVoice || !text.trim()}>
              {busy === "generate" ? "Đang tạo giọng đọc…" : "Tạo âm thanh"}
            </Button>
          </div>
          {output && <div className="flex flex-wrap items-center gap-3" role="status">
            <span>Đã tạo bằng {output.voice}</span>
            <Button variant="secondary" onClick={() => {
              if (playing === "studio-output") onStop();
              else onPlay("studio-output", URL.createObjectURL(output.blob), {objectUrl: true});
            }}>{playing === "studio-output" ? "Dừng" : "Nghe kết quả"}</Button>
            <a className="underline" href={output.url} download="voicestudio.wav">Tải WAV</a>
          </div>}
        </form>
      </Card>
      {loading ? <p role="status">Đang lấy danh sách giọng…</p> : voices.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {voices.map(voice => (
            <Card key={voice.name}>
              <div className="grid gap-3">
                <h2 className="font-semibold">{voice.title}</h2>
                <p className="text-meta text-[var(--text-muted)]">VoiceStudio · Giọng đã lưu</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant={selectedVoice === voice.name ? "primary" : "secondary"} disabled={busy !== null}
                    onClick={() => setSelectedVoice(voice.name)}>{selectedVoice === voice.name ? "Đang chọn" : "Chọn giọng"}</Button>
                  <Button variant="secondary" disabled={busy !== null} onClick={() => void preview(voice)}>
                    {busy === voice.name ? "Đang tạo bản nghe thử…" : playing === "voicestudio:" + voice.name ? "Dừng" : "Nghe thử"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : !error && <p role="status">Chưa lấy được giọng đã lưu. Mở VoiceStudio rồi bấm Tải lại giọng.</p>}
    </div>
  );
}
