"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/IconButton";

export function EditableTitle({
  value,
  fallback,
  onSave,
  onError,
  editLabel,
  emptyError,
  saveLabel,
  cancelLabel,
}: {

  value: string | null;

  fallback: string;

  onSave: (next: string) => Promise<void>;
  onError: (message: string | null) => void;
  editLabel: string;
  emptyError: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function start() {
    onError(null);
    setDraft(value ?? fallback);
  }

  function cancel() {
    onError(null);
    setDraft(null);
  }

  async function save() {
    if (draft === null || saving) return;
    const next = draft.trim();

    if (!next) {
      onError(emptyError);
      return;
    }
    if (next === value) {
      cancel();
      return;
    }
    setSaving(true);
    onError(null);
    try {
      await onSave(next);
      setDraft(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (draft === null) {
    return (
      <span className="inline-flex max-w-full items-center gap-2">
        {value ?? fallback}
        <IconButton
          label={editLabel}
          disabled={value === null}
          onClick={start}
        >
          <Pencil size={15} strokeWidth={2} />
        </IconButton>
      </span>
    );
  }

  return (
    <span className="flex w-full max-w-md items-center gap-2">
      <input
        className="input"
        autoFocus
        value={draft}
        disabled={saving}
        aria-label={editLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
      />
      <IconButton label={saveLabel} disabled={saving} onClick={save}>
        {saving ? (
          <Loader2 size={15} strokeWidth={2} className="animate-spin" />
        ) : (
          <Check size={15} strokeWidth={2} />
        )}
      </IconButton>
      <IconButton label={cancelLabel} disabled={saving} onClick={cancel}>
        <X size={15} strokeWidth={2} />
      </IconButton>
    </span>
  );
}
