"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Panel } from "@/components/Panel";
import { useT } from "@/lib/i18n";

const CONFIRM_TEXT = "DELETE";

export function ConfirmDeleteModal({
  open,
  title,
  description,
  items,
  busy = false,
  busyLabel,
  confirmLabel,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;

  title?: string;

  description?: ReactNode;

  items?: string[];

  busy?: boolean;
  busyLabel?: string;
  confirmLabel?: string;

  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t, tf } = useT();
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const confirmed = text === CONFIRM_TEXT;

  function close() {
    if (!busy) onClose();
  }

  return (
    <Modal
      title={
        <span className="text-[var(--danger)]">
          {title ?? t("confirm.title")}
        </span>
      }
      open={open}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !confirmed}
            onClick={onConfirm}
          >
            <Trash2 size={14} strokeWidth={2} />
            {busy
              ? (busyLabel ?? t("common.deleting"))
              : (confirmLabel ?? t("common.delete"))}
          </Button>
        </>
      }
    >

      {error && (
        <ErrorBanner
          message={<span className="whitespace-pre-line">{error}</span>}
        />
      )}
      {description && <div className="text-sm">{description}</div>}
      {items && items.length > 0 && (
        <Panel>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item} className="break-all text-sm font-medium">
                {item}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Field
        htmlFor="confirm-delete-text"
        label={
          <>
            {t("confirm.type-before")}{" "}
            <code className="rounded bg-[var(--danger-bg)] px-1 text-xs font-semibold text-[var(--danger)]">
              {CONFIRM_TEXT}
            </code>{" "}
            {t("confirm.type-after")}
          </>
        }
      >
        <input
          id="confirm-delete-text"
          className="input"
          autoFocus
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && confirmed && !busy) onConfirm();
          }}
          placeholder={CONFIRM_TEXT}
          aria-label={tf("confirm.type-aria", { text: CONFIRM_TEXT })}
        />
      </Field>
    </Modal>
  );
}
