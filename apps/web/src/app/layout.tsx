import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import { FAVICON } from "@/lib/brand";
import { Shell } from "@/components/Shell";
import { StaleChunkGuard } from "@/components/StaleChunkGuard";
import { LanguageProvider } from "@/lib/i18n";
import { EventsProvider } from "@/lib/useEvents";

export const metadata: Metadata = {
  title: "Fabuloki",
  description: "Dựng video và kể chuyện bằng AI",

  icons: { icon: FAVICON },
};

const THEME_SCRIPT = `try{if(localStorage.getItem("fabuloki-theme")!=="light")document.documentElement.setAttribute("data-theme","dark")}catch(e){}`;

const TOKEN_URL_SCRIPT = `try{var u=new URL(location.href),t=u.searchParams.get("t");if(t&&!u.searchParams.get("k")){localStorage.setItem("fabuloki_api_token",t);u.searchParams.delete("t");history.replaceState(history.state,"",u.pathname+u.search+u.hash)}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: TOKEN_URL_SCRIPT + THEME_SCRIPT }} />
        <StaleChunkGuard />
        <LanguageProvider>
          <EventsProvider>
            <Shell>{children}</Shell>
          </EventsProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
