"use client";

import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cloneProject } from "@/lib/api";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

interface ClonedProject {
  id: string;
  name: string;
}

export function CloneProjectModal({
  source,
  onClose,
  onCloned,
  clone = cloneProject,
  descriptionKey = "clone.description",
}: {

  source: { id: string; name: string } | null;
  onClose: () => void;
  onCloned: (p: ClonedProject) => void;

  clone?: (id: string, name?: string) => Promise<ClonedProject>;
  descriptionKey?: string;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceId = source?.id ?? null;
  const sourceName = source?.name ?? null;
  useEffect(() => {
    if (sourceId !== null) {
      setName(`${sourceName ?? sourceId} ${t("clone.copy-suffix")}`);
      setError(null);
    }
  }, [sourceId, sourceName, t]);

  async function onClone() {
    if (!source || cloning) return;
    setCloning(true);
    setError(null);
    try {
      const p = await clone(source.id, name.trim() || undefined);
      onCloned(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }

  function close() {
    if (!cloning) onClose();
  }

  return (
    <Modal
      title={t("clone.title")}
      open={source !== null}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" disabled={cloning} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button disabled={cloning || name.trim().length === 0} onClick={onClone}>
            <Copy size={14} strokeWidth={2} />
            {cloning ? t("clone.cloning") : t("clone.action")}
          </Button>
        </>
      }
    >
      {error && (
        <ErrorBanner message={t("clone.error")} detail={error} />
      )}
      <p className="text-sm text-[var(--text-muted)]">{t(descriptionKey)}</p>
      <Field
        label={t("clone.new-name")}
        htmlFor="clone-project-name"
        hint={t("clone.id-hint")}
      >
        <input
          id="clone-project-name"
          className="input"
          autoFocus
          value={name}
          disabled={cloning}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onClone();
            }
          }}
        />
      </Field>
    </Modal>
  );
}
