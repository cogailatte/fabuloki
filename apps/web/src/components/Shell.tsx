"use client";

import {
  AudioLines,
  BookOpen,
  ChevronDown,
  CircleQuestionMark,
  Clapperboard,
  ExternalLink,
  FileText,
  FolderOpen,
  Images,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  ListVideo,
  MessageSquare,
  Mic,
  Palette,
  Sparkles,
  Shapes,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Scissors,
  ScrollText,
  Settings2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { getHealth, type Health } from "@/lib/api";
import { Button } from "@/components/Button";
import { GUIDE_PANEL_ID, GuidePanel } from "@/components/GuidePanel";
import { HardwareMeter } from "@/components/HardwareMeter";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

import { FAVICON } from "@/lib/brand";
import { useT } from "@/lib/i18n";

const REPO_URL = process.env.NEXT_PUBLIC_FABULOKI_REPO_URL;

const NAV_STORAGE_KEY = "fabuloki-nav";
const PANEL_STORAGE_KEY = "fabuloki-panel";

const SHELL_SCRIPT = `try{var d=document.documentElement,p=location.pathname.split("/");if(p[1]==="projects"&&p[3]==="editor"&&!p[4]){d.setAttribute("data-nav","collapsed")}else{var n=localStorage.getItem("${NAV_STORAGE_KEY}");if(n==="collapsed"||n==="expanded")d.setAttribute("data-nav",n)}if(localStorage.getItem("${PANEL_STORAGE_KEY}")==="collapsed")d.setAttribute("data-panel","collapsed")}catch(e){}`;

function isEditorPath(pathname: string): boolean {
  const parts = pathname.split("/");
  return parts[1] === "projects" && parts[3] === "editor" && !parts[4];
}

const NAV_AUTO_COLLAPSE = "(max-width: 1439.98px)";

const PANEL_DRAWER = "(max-width: 1279.98px)";

function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const PRIMARY_NAV = [
  { href: "/", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "nav.projects", icon: Clapperboard },
  { href: "/quizzy", label: "nav.quizzy", icon: Sparkles },
] as const;

const OTHER_NAV = [
  { href: "/auto-cut", label: "nav.auto-cut", icon: Scissors },
  { href: "/text-to-video", label: "nav.text-to-video", icon: FileText },
  { href: "/translate-video", label: "nav.translate-video", icon: Languages },
  { href: "/voices", label: "nav.voices", icon: Mic },
  { href: "/images", label: "nav.images", icon: Images },
] as const;

const LIBRARY_NAV = [
  { href: "/styles", label: "nav.styles", icon: Palette },

  { href: "/video-styles", label: "nav.video-styles", icon: Shapes },
  { href: "/edit-effects", label: "nav.edit-effects", icon: Sparkles },
  { href: "/queue", label: "nav.queue", icon: ListVideo },
  { href: "/assets", label: "nav.assets", icon: FolderOpen },
  { href: "/sfx", label: "nav.sfx", icon: AudioLines },
  { href: "/prompts", label: "nav.prompts", icon: ScrollText },
  { href: "/skills", label: "nav.skills", icon: BookOpen },
  { href: "/config", label: "nav.config", icon: Settings2 },
  { href: "/connections", label: "nav.connections", icon: Plug },
] as const;

type NavEntry = (typeof PRIMARY_NAV | typeof OTHER_NAV | typeof LIBRARY_NAV)[number];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageTitle(pathname: string): string {
  const item = [...PRIMARY_NAV, ...OTHER_NAV, ...LIBRARY_NAV].filter((n) => isActive(pathname, n.href)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return item?.label ?? "nav.dashboard";
}

const HEALTH_POLL_MS = 30_000;

function BackendStatus() {
  const { t } = useT();
  const [health, setHealth] = useState<Health | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const h = await getHealth();
        if (!alive) return;
        setHealth(h);
        setReachable(true);
      } catch {
        if (!alive) return;
        setHealth(null);
        setReachable(false);
      }
    }
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const ok = reachable === true && health?.ok === true;
  const label =
    reachable === null
      ? t("shell.backend-checking")
      : ok
        ? t("shell.backend-ok")
        : reachable
          ? t("shell.backend-partial")
          : t("shell.backend-unreachable");

  return (
    <div className="flex items-center gap-2" title={label}>
      <span
        className={`h-2 w-2 rounded-full ${
          ok ? "bg-[var(--success)]" : "bg-[var(--danger)]"
        } ${reachable === null ? "opacity-40" : ""}`}
      />
      <span className="hidden text-xs text-[var(--text-muted)] md:inline">
        {label}
      </span>
    </div>
  );
}

interface ShellPanelApi {

  slot: HTMLElement | null;

  register: (title: string) => () => void;

  reveal: () => void;
}

const ShellPanelContext = createContext<ShellPanelApi | null>(null);

export function ShellRightPanel({
  title,
  children,
}: {

  title: string;
  children: ReactNode;
}) {
  const api = useContext(ShellPanelContext);

  useEffect(() => {
    if (!api) return;
    return api.register(title);
  }, [api, title]);

  if (!api?.slot) return null;
  return createPortal(children, api.slot);
}

export function useRevealShellPanel(): () => void {
  const api = useContext(ShellPanelContext);
  return api?.reveal ?? noop;
}
const noop = () => {};

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const pathname = usePathname();

  const [panelTitle, setPanelTitle] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const [navCollapsed, setNavCollapsed] = useState(false);

  const [guideOpen, setGuideOpen] = useState(false);
  const guideBtnRef = useRef<HTMLButtonElement>(null);
  const closeGuide = useCallback(() => {
    setGuideOpen(false);

    guideBtnRef.current?.focus();
  }, []);

  const syncNav = useCallback(() => {
    const attr = document.documentElement.getAttribute("data-nav");
    if (attr === "collapsed") setNavCollapsed(true);
    else if (attr === "expanded") setNavCollapsed(false);
    else setNavCollapsed(window.matchMedia(NAV_AUTO_COLLAPSE).matches);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(NAV_AUTO_COLLAPSE);
    syncNav();
    mq.addEventListener("change", syncNav);
    return () => mq.removeEventListener("change", syncNav);
  }, [syncNav]);

  const navChoiceRef = useRef<"collapsed" | "expanded" | null>(null);

  const onEditor = isEditorPath(pathname);
  useEffect(() => {
    if (!onEditor) return;
    const root = document.documentElement;
    root.setAttribute("data-nav", "collapsed");
    syncNav();
    return () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(NAV_STORAGE_KEY);
      } catch {

      }
      const pref =
        navChoiceRef.current ?? (saved === "collapsed" || saved === "expanded" ? saved : null);

      if (pref) root.setAttribute("data-nav", pref);
      else root.removeAttribute("data-nav");
      syncNav();
    };
  }, [onEditor, syncNav]);

  const setNav = useCallback((next: boolean) => {
    navChoiceRef.current = next ? "collapsed" : "expanded";
    setNavCollapsed(next);

    document.documentElement.setAttribute(
      "data-nav",
      next ? "collapsed" : "expanded"
    );
    try {
      localStorage.setItem(NAV_STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {

    }
  }, []);

  const setPanelCollapsed = useCallback((next: boolean) => {
    const root = document.documentElement;
    if (next) root.setAttribute("data-panel", "collapsed");
    else root.removeAttribute("data-panel");
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {

    }
  }, []);

  const register = useCallback((title: string) => {
    setPanelTitle(title);
    return () => setPanelTitle(null);
  }, []);

  const reveal = useCallback(() => {
    setPanelCollapsed(false);
    if (window.matchMedia(PANEL_DRAWER).matches) setDrawerOpen(true);
  }, [setPanelCollapsed]);

  const panelApi = useMemo<ShellPanelApi>(
    () => ({ slot, register, reveal }),
    [slot, register, reveal]
  );

  if (pathname === "/m" || pathname.startsWith("/m/")) {
    return <>{children}</>;
  }

  const navToggleLabel = navCollapsed
    ? t("shell.nav-expand")
    : t("shell.nav-collapse");
  const navToggleShort = navCollapsed
    ? t("shell.nav-expand-short")
    : t("shell.nav-collapse-short");

  const otherActive = OTHER_NAV.some(({ href }) => isActive(pathname, href));

  function navLink({ href, label, icon: Icon }: NavEntry) {
    const text = t(label);
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        title={text}
        aria-label={text}
        aria-current={active ? "page" : undefined}
        className={`nav-item ${active ? "active" : ""}`}
      >
        <Icon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
        <span className="shell-nav-label min-w-0 truncate">{text}</span>
      </Link>
    );
  }

  return (
    <ShellPanelContext.Provider value={panelApi}>
      <div className="flex h-screen flex-col">
        <script dangerouslySetInnerHTML={{ __html: SHELL_SCRIPT }} />

        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4">
          <Link href="/" aria-label="Fabuloki" className="flex shrink-0 items-center gap-3">

            <img src={FAVICON} alt="" className="size-8 shrink-0" />
            <span className="text-sm font-bold tracking-tight text-[var(--text)]">Fabuloki</span>
          </Link>

          <span className="min-w-0 truncate text-sm font-semibold">
            {t(pageTitle(pathname))}
          </span>

          <div className="ml-auto flex items-center gap-3">

            <Button
              ref={guideBtnRef}
              variant="secondary"
              small
              onClick={() => (guideOpen ? closeGuide() : setGuideOpen(true))}
              aria-expanded={guideOpen}
              aria-controls={GUIDE_PANEL_ID}
              aria-label={t("guide.open")}
              title={t("guide.open-hint")}
            >
              <CircleQuestionMark size={14} strokeWidth={2} aria-hidden="true" />
              <span className="hidden sm:inline">{t("guide.open")}</span>
            </Button>
            {panelTitle !== null && (
              <button
                type="button"
                onClick={() => setDrawerOpen((o) => !o)}
                className="shell-panel-drawer shell-icon-btn"
                aria-expanded={drawerOpen}
                aria-controls="shell-panel-body"
                aria-label={t("shell.panel-open")}
                title={t("shell.panel-open")}
              >
                <MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            <HardwareMeter />
            <BackendStatus />
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside
            id="shell-nav"
            className="shell-nav flex shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-subtle)]"
          >

            <div className="shell-nav-head">
              <button
                type="button"
                onClick={() => setNav(!navCollapsed)}
                className="shell-nav-toggle"
                aria-expanded={!navCollapsed}
                aria-controls="shell-nav"
                aria-label={navToggleLabel}
                title={navToggleLabel}
              >

                <PanelLeftClose
                  size={16}
                  strokeWidth={1.75}
                  className="only-nav-expanded shrink-0"
                  aria-hidden="true"
                />
                <PanelLeftOpen
                  size={16}
                  strokeWidth={1.75}
                  className="only-nav-collapsed shrink-0"
                  aria-hidden="true"
                />
                <span className="shell-nav-label min-w-0 truncate">
                  {navToggleShort}
                </span>
              </button>
            </div>

            <nav
              className="flex flex-col gap-1"
              aria-label={t("shell.nav-aria")}
            >
              {PRIMARY_NAV.map(navLink)}
              <details key={String(otherActive)} open={otherActive} className="group">
                <summary
                  title={t("nav.other-features")}
                  aria-label={t("nav.other-features")}
                  className={`nav-item cursor-pointer list-none [&::-webkit-details-marker]:hidden ${otherActive ? "active" : ""}`}
                >
                  <LayoutGrid size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                  <span className="shell-nav-label min-w-0 flex-1 truncate">{t("nav.other-features")}</span>
                  <span className="shell-nav-label">
                    <ChevronDown size={14} className="group-open:rotate-180" aria-hidden="true" />
                  </span>
                </summary>
                <div className="mt-1 flex flex-col gap-1 ps-[var(--shell-nav-item-pad)]">
                  {OTHER_NAV.map(navLink)}
                </div>
              </details>
              {LIBRARY_NAV.map(navLink)}
            </nav>

            {REPO_URL && (
              <div className="shell-nav-foot mt-auto flex flex-col gap-1">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={REPO_URL}
                  aria-label={t("nav.source")}
                  className="shell-nav-source inline-flex items-center gap-2 rounded-[var(--radius)] py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  <GithubMark size={14} />
                  <span className="shell-nav-label min-w-0 flex-1 truncate">
                    {t("nav.source")}
                  </span>
                  <ExternalLink
                    size={12}
                    strokeWidth={2}
                    className="shell-nav-label shrink-0 opacity-60"
                    aria-hidden="true"
                  />
                </a>

              </div>
            )}
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="w-full p-5">{children}</div>
          </main>

          <div
            className={`shell-panel-scrim ${
              drawerOpen && panelTitle !== null ? "is-open" : ""
            }`}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={`shell-panel ${panelTitle === null ? "is-empty" : ""} ${
              drawerOpen ? "is-open" : ""
            }`}
            aria-label={panelTitle ?? undefined}
            aria-hidden={panelTitle === null ? true : undefined}
          >

            <button
              type="button"
              onClick={() => setPanelCollapsed(false)}
              className="shell-panel-strip"
              aria-expanded={false}
              aria-controls="shell-panel-body"
              aria-label={t("shell.panel-expand")}
              title={t("shell.panel-expand")}
            >
              <PanelRightOpen size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="shell-panel-strip-label">{panelTitle}</span>
            </button>

            <div
              id="shell-panel-body"
              className="shell-panel-body min-h-0 min-w-0 flex-1 flex-col gap-3 p-3"
            >
              <div className="flex shrink-0 items-center justify-between gap-2">
                <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <MessageSquare
                    size={15}
                    strokeWidth={2}
                    className="shrink-0 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                  <span className="truncate">{panelTitle}</span>
                </h2>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPanelCollapsed(true)}
                    className="shell-panel-toggle shell-icon-btn"
                    aria-expanded={true}
                    aria-controls="shell-panel-body"
                    aria-label={t("shell.panel-collapse")}
                    title={t("shell.panel-collapse")}
                  >
                    <PanelRightClose
                      size={16}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="shell-panel-drawer shell-icon-btn"
                    aria-label={t("shell.panel-close")}
                    title={t("shell.panel-close")}
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div ref={setSlot} className="flex min-h-0 flex-1 flex-col gap-3" />
            </div>
          </aside>
        </div>
      </div>
      <GuidePanel open={guideOpen} onClose={closeGuide} pathname={pathname} />
    </ShellPanelContext.Provider>
  );
}
