"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { EditEffectLibrary } from "@/components/EditEffectLibrary";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { setAssetEditEffect, type FileInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function AssetEffectPicker({ projectId, asset, onChanged }: {
  projectId: string;
  asset: FileInfo;
  onChanged: () => void;
}) {
  const { lang } = useT();
  const vi = lang === "vi";
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await setAssetEditEffect(projectId, asset.relPath, selected);
      setOpen(false);
      onChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button small variant="secondary" onClick={() => {
        setSelected(asset.editEffectId ?? null);
        setError("");
        setOpen(true);
      }}>
        <Sparkles size={14} aria-hidden="true" />
        {asset.editEffectId === "none"
          ? (vi ? "Không hiệu ứng" : "No effect")
          : asset.editEffectName ?? (vi ? "Chọn hiệu ứng" : "Choose effect")}
      </Button>
      <Modal
        wide
        open={open}
        dismissible={!saving}
        title={`${vi ? "Hiệu ứng cho nguồn" : "Source effect"} · ${asset.name}`}
        onClose={() => setOpen(false)}
        footer={<>
          <Button variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
            {vi ? "Hủy" : "Cancel"}
          </Button>
          <Button disabled={saving || selected === (asset.editEffectId ?? null)} onClick={() => void save()}>
            {saving ? (vi ? "Đang lưu…" : "Saving…") : (vi ? "Lưu lựa chọn" : "Save selection")}
          </Button>
        </>}
      >
        {open && <div className="flex flex-col gap-4">
          {error && <ErrorBanner message={vi ? "Không lưu được hiệu ứng" : "Could not save effect"} detail={error} />}
          <p className="text-sm text-[var(--text-muted)]">
            {vi ? "Lựa chọn này được dùng khi AI dựng các đoạn lấy từ nguồn này." : "This choice is used when AI edits segments from this source."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button small disabled={saving} variant={selected === null ? "primary" : "secondary"} onClick={() => setSelected(null)}>
              {vi ? "AI tự chọn" : "Let AI choose"}
            </Button>
            <Button small disabled={saving} variant={selected === "none" ? "primary" : "secondary"} onClick={() => setSelected("none")}>
              {vi ? "Không hiệu ứng" : "No effect"}
            </Button>
          </div>
          <EditEffectLibrary selected={selected} disabled={saving} onSelect={setSelected} />
        </div>}
      </Modal>
    </>
  );
}
