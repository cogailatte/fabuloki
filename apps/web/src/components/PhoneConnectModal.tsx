"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import {
  closePhoneSessionOnUnload,
  createUploadSession,
  getLanInfo,
  getTunnelStatus,
  revokeUploadSession,
  startTunnel,
  stopTunnel,
  type LanInfo,
  type TunnelStatus,
} from "@/lib/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { InfoHint } from "@/components/InfoHint";
import { useT } from "@/lib/i18n";

const TUNNEL_OPTION = "__tunnel__";

const TUNNEL_POLL_MS = 2000;
const TUNNEL_POLL_TIMEOUT_MS = 40_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PhoneConnectModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const [lan, setLan] = useState<LanInfo | null>(null);

  const [sel, setSel] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);

  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState<"start" | "stop" | null>(null);
  const [tunnelError, setTunnelError] = useState<string | null>(null);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const startedHereRef = useRef(false);
  const [startedHere, setStartedHere] = useState(false);
  const markStartedHere = (v: boolean) => {
    startedHereRef.current = v;
    setStartedHere(v);
  };

  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLan(null);
    setSel(null);
    setError(null);
    getLanInfo()
      .then((info) => {
        if (!alive) return;
        setLan(info);

        setSel(info.tunnelDomain ? TUNNEL_OPTION : info.ips[0] ?? null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTunnel(null);
    setTunnelBusy(null);
    setTunnelError(null);

    markStartedHere(false);
    getTunnelStatus()
      .then((s) => {
        if (!alive) return;
        setTunnel(s);

        if (s.running && s.auto) markStartedHere(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let created: string | null = null;
    setToken(null);
    createUploadSession(projectId)
      .then((s) => {
        created = s.token;
        tokenRef.current = s.token;
        if (alive) setToken(s.token);

        else void revokeUploadSession(s.token).catch(() => {});
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      setToken(null);
      tokenRef.current = null;
      if (created) void revokeUploadSession(created).catch(() => {});
      if (startedHereRef.current) {

        startedHereRef.current = false;

        void stopTunnel(true).catch(() => {});
      }
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onPageHide = () => {
      closePhoneSessionOnUnload(tokenRef.current, startedHereRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [open]);

  const viaTunnel = sel === TUNNEL_OPTION && !!lan?.tunnelDomain;
  const url =
    lan && sel && token
      ? viaTunnel
        ? `https://${lan.tunnelDomain}/m/${projectId}?k=${token}`
        : `http://${sel}:${lan.webPort}/m/${projectId}?k=${token}`
      : null;

  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (alive) setQr(dataUrl);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [url]);

  async function handleStartTunnel() {
    setTunnelBusy("start");
    setTunnelError(null);
    try {

      await startTunnel(true);
      markStartedHere(true);
      const deadline = Date.now() + TUNNEL_POLL_TIMEOUT_MS;
      let live = false;
      while (Date.now() < deadline) {
        await sleep(TUNNEL_POLL_MS);
        if (!openRef.current) return;
        const s = await getTunnelStatus().catch(() => null);
        if (s) setTunnel(s);
        if (s?.running && s.url) {
          live = true;
          break;
        }
      }
      if (!live) {
        setTunnelError(t("phone.tunnel-timeout"));
        return;
      }
      const info = await getLanInfo();
      if (!openRef.current) return;
      setLan(info);
      if (info.tunnelDomain) setSel(TUNNEL_OPTION);
    } catch (e) {
      setTunnelError(e instanceof Error ? e.message : String(e));
    } finally {
      if (openRef.current) setTunnelBusy(null);
    }
  }

  async function handleStopTunnel() {
    setTunnelBusy("stop");
    setTunnelError(null);
    try {
      await stopTunnel();
      markStartedHere(false);
      const [s, info] = await Promise.all([getTunnelStatus(), getLanInfo()]);
      if (!openRef.current) return;
      setTunnel(s);
      setLan(info);

      setSel(info.ips[0] ?? null);
    } catch (e) {
      setTunnelError(e instanceof Error ? e.message : String(e));
    } finally {
      if (openRef.current) setTunnelBusy(null);
    }
  }

  const canStartTunnel = Boolean(
    !viaTunnel && tunnel?.installed && !tunnel.running
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("phone.title")}
      footer={

        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {canStartTunnel && (
            <>

              <InfoHint
                className="self-center"
                titleKey="help.phone-tunnel.title"
                bodyKey="help.phone-tunnel.body"
                size={15}
              />
              <Button
                onClick={() => void handleStartTunnel()}
                disabled={tunnelBusy !== null}
              >
                {tunnelBusy === "start"
                  ? t("phone.tunnel-starting")
                  : t("phone.tunnel-start")}
              </Button>
            </>
          )}
        </>
      }
    >
      {error && <ErrorBanner message={error} />}
      {tunnelError && <ErrorBanner message={tunnelError} />}

      <p className="text-sm text-[var(--text-muted)]">{t("phone.desc")}</p>

      {!lan && !error && (
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">
          {t("phone.loading")}
        </p>
      )}

      {lan && lan.ips.length === 0 && !lan.tunnelDomain && (
        <Banner tone="danger" message={t("phone.no-ip")} />
      )}

      {lan && lan.ips.length + (lan.tunnelDomain ? 1 : 0) > 1 && (
        <Field label={t("phone.ip-label")} htmlFor="phone-network">
          <select
            id="phone-network"
            className="input"
            value={sel ?? ""}
            onChange={(e) => setSel(e.target.value)}
          >

            {lan.tunnelDomain && (
              <option value={TUNNEL_OPTION}>
                {`${lan.tunnelDomain} (Internet)`}
              </option>
            )}
            {lan.ips.map((addr) => (
              <option key={addr} value={addr}>
                {addr}
              </option>
            ))}
          </select>
        </Field>
      )}

      {url && (
        <div className="flex flex-col items-center gap-3">
          {qr && (

            <img
              src={qr}
              alt={t("phone.qr-alt")}
              className="h-60 w-60 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2"
            />
          )}
          <code className="select-all break-all rounded-[var(--radius)] bg-[var(--bg-subtle)] p-2 text-sm">
            {url}
          </code>
        </div>
      )}

      <p className="text-sm text-[var(--text-muted)]">
        {startedHere ? t("phone.session-note-tunnel") : t("phone.session-note")}
      </p>

      {viaTunnel ? (

        <Banner tone="info" message={t("phone.tunnel-active")}>

          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t("phone.tunnel-warn")}{" "}
            <button
              type="button"
              className="font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
              onClick={() => void handleStopTunnel()}
              disabled={tunnelBusy !== null}
            >
              {t("phone.tunnel-stop")}
            </button>
          </p>
        </Banner>
      ) : (
        <Banner tone="info" message={t("phone.note")}>

          {tunnel && !tunnel.installed && (
            <p className="mt-1 flex items-start gap-1 text-sm text-[var(--text-muted)]">
              <span className="min-w-0 flex-1">
                {t("phone.tunnel-missing")}{" "}
                <Link
                  href="/connections"
                  className="font-medium text-[var(--primary)] hover:underline"
                >
                  {t("nav.connections")} →
                </Link>
              </span>
              <InfoHint
                titleKey="help.phone-tunnel.title"
                bodyKey="help.phone-tunnel.body"
              />
            </p>
          )}

          {tunnel?.running && lan?.tunnelDomain && (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t("phone.tunnel-ready")}{" "}
              <button
                type="button"
                className="font-medium text-[var(--primary)] hover:underline"
                onClick={() => setSel(TUNNEL_OPTION)}
              >
                {t("phone.tunnel-use")}
              </button>
            </p>
          )}
        </Banner>
      )}

      <Banner tone="danger" message={t("phone.keep-awake")} />
    </Modal>
  );
}
