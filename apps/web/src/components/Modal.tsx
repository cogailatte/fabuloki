"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/lib/i18n";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {

  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  wide = false,
  dismissible = true,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;

  wide?: boolean;

  dismissible?: boolean;
}) {
  const { t } = useT();
  const dialogRef = useRef<HTMLDivElement>(null);

  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const first = focusablesIn(dialog).find((el) => !el.closest("[data-modal-header]"));
      (first ?? dialog).focus();
    }
    return () => {
      const back = restoreRef.current;
      restoreRef.current = null;
      if (back && back.isConnected) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissible]);

  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const list = focusablesIn(dialog);
    if (list.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--text)]/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >

      <div
        ref={dialogRef}
        className={`card max-h-[90vh] w-full overflow-y-auto outline-none ${
          wide ? "max-w-[960px]" : "max-w-[640px]"
        }`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <div className="mb-4 flex items-center justify-between" data-modal-header="">
          <h2 className="text-sm font-semibold">{title}</h2>
          {dismissible && (
            <IconButton label={t("common.close")} size="sm" onClick={onClose}>
              <X size={15} strokeWidth={2} />
            </IconButton>
          )}
        </div>
        <div className="flex flex-col gap-3">{children}</div>
        {footer && (
          <div className="mt-5 flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
