import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { BRAND_BODY_FAMILY, BRAND_HEADING_FAMILY, ensureBrandFont } from "./brandFonts";
import type { PosterProps, PosterStat } from "./posterManifest";

type Orientation = "vertical" | "horizontal" | "square";

const orientationOf = (aspect: PosterProps["aspect"]): Orientation => {
  if (aspect === "16:9") return "horizontal";
  if (aspect === "1:1") return "square";
  return "vertical";
};

const hexToRgb = (hex: string): [number, number, number] => {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [16, 17, 19];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const mix = (a: string, b: string, t: number): string => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

const SYSTEM_STACK = "Inter, 'Segoe UI', Roboto, sans-serif";

const fontFamily = (brandFamily: string | null, preferred: string): string => {
  const name = preferred.trim();
  const tail = !name || name === "Inter" ? SYSTEM_STACK : `'${name.replace(/'/g, "")}', ${SYSTEM_STACK}`;
  return brandFamily ? `'${brandFamily}', ${tail}` : tail;
};

const splitTitle = (title: string): { plain: string; highlight: string } => {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return { plain: title.trim(), highlight: "" };
  const take = words.length >= 4 ? 2 : 1;
  return {
    plain: words.slice(0, -take).join(" "),
    highlight: words.slice(-take).join(" "),
  };
};

type ParticleSpec = {
  x: string;
  y: string;
  size: number;
  color: "accent" | "secondary";
  opacity: number;
  shape: "dot" | "plus";
};

const PARTICLES: Record<Orientation, ParticleSpec[]> = {

  horizontal: [
    { x: "47.5%", y: "24%", size: 14, color: "accent", opacity: 0.5, shape: "plus" },
    { x: "52%", y: "42%", size: 8, color: "secondary", opacity: 0.6, shape: "dot" },
    { x: "45.5%", y: "66%", size: 6, color: "accent", opacity: 0.45, shape: "dot" },
    { x: "53.5%", y: "75%", size: 10, color: "secondary", opacity: 0.38, shape: "plus" },
  ],

  vertical: [
    { x: "76%", y: "50%", size: 14, color: "accent", opacity: 0.5, shape: "plus" },
    { x: "86%", y: "57%", size: 8, color: "secondary", opacity: 0.55, shape: "dot" },
    { x: "68%", y: "46%", size: 6, color: "accent", opacity: 0.4, shape: "dot" },
    { x: "90%", y: "65%", size: 10, color: "secondary", opacity: 0.38, shape: "plus" },
  ],
  square: [
    { x: "78%", y: "40%", size: 14, color: "accent", opacity: 0.5, shape: "plus" },
    { x: "87%", y: "48%", size: 8, color: "secondary", opacity: 0.55, shape: "dot" },
    { x: "14%", y: "44%", size: 6, color: "accent", opacity: 0.4, shape: "dot" },
    { x: "9%", y: "36%", size: 10, color: "secondary", opacity: 0.38, shape: "plus" },
  ],
};

type VertPos = "top" | "middle" | "bottom";
type HorizPos = "left" | "center" | "right";

const AUTO_POSITION: Record<Orientation, `${VertPos}-${HorizPos}`> = {
  horizontal: "middle-left",
  square: "bottom-center",
  vertical: "bottom-left",
};

function focusOf(
  orientation: Orientation,
  vert: VertPos,
  horiz: HorizPos,
  isAuto: boolean,
): { x: number; y: number } {
  if (isAuto) {
    if (orientation === "horizontal") return { x: 18, y: 55 };
    if (orientation === "square") return { x: 50, y: 96 };
    return { x: 42, y: 94 };
  }

  const edge = orientation === "horizontal" ? 20 : 32;
  const x = horiz === "left" ? edge : horiz === "right" ? 100 - edge : 50;
  const y = vert === "top" ? 12 : vert === "bottom" ? 92 : 50;
  return { x, y };
}

export const Poster: React.FC<PosterProps> = ({ aspect, background, design, overlay }) => {

  const { width, height } = useVideoConfig();
  const orientation = orientationOf(aspect);
  const { colors, fonts, fontFiles, logoFile, brandName, effects } = design;
  const { title, subtitle, stats, cta, showLogo, position } = overlay;

  const isAutoPosition = position === "auto";
  const resolvedPosition = isAutoPosition ? AUTO_POSITION[orientation] : position;
  const [vert, horiz] = resolvedPosition.split("-") as [VertPos, HorizPos];

  const flexAlign =
    horiz === "left" ? "flex-start" : horiz === "right" ? "flex-end" : "center";

  const focus = focusOf(orientation, vert, horiz, isAutoPosition);

  const hasBrandHeading = ensureBrandFont(BRAND_HEADING_FAMILY, fontFiles.heading);
  const hasBrandBody = ensureBrandFont(BRAND_BODY_FAMILY, fontFiles.body);

  const u = width / 1080;

  const marginX = Math.round(width * 0.07);
  const marginY = Math.round(height * 0.07);

  const validStats = stats.filter((s: PosterStat) => s.value.trim() !== "");
  const hasTitle = title.trim() !== "";
  const hasSubtitle = subtitle.trim() !== "";
  const hasCta = cta.trim() !== "";
  const hasBrandName = brandName.trim() !== "";
  const { plain, highlight } = splitTitle(title);

  const gradientBackground = [
    `radial-gradient(ellipse 130% 95% at 85% -12%, ${rgba(colors.primary, 0.5)} 0%, ${rgba(colors.primary, 0.16)} 40%, transparent 68%)`,
    `radial-gradient(ellipse 100% 80% at -10% 105%, ${rgba(colors.primary, 0.16)} 0%, transparent 50%)`,
    `linear-gradient(160deg, ${mix(colors.background, colors.primary, 0.22)} 0%, ${colors.background} 48%, ${mix(colors.background, "#000000", 0.3)} 100%)`,
  ].join(", ");

  const tintDirection =
    horiz === "left" && vert === "middle"
      ? "100deg"
      : horiz === "right" && vert === "middle"
        ? "260deg"
        : vert === "top"
          ? "to bottom"
          : "to top";
  const brandTint = `linear-gradient(${tintDirection}, ${rgba(colors.primary, 0.1)} 0%, transparent 55%)`;

  const scrimBase = mix(colors.background, "#000000", 0.55);

  const scrimSpec =
    orientation === "horizontal"
      ? { size: "78% 115%", a0: 0.88, s1: 42, a1: 0.6, s2: 66, a2: 0.24 }
      : orientation === "square"
        ? { size: "115% 72%", a0: 0.88, s1: 44, a1: 0.58, s2: 68, a2: 0.22 }
        : { size: "130% 60%", a0: 0.9, s1: 44, a1: 0.6, s2: 68, a2: 0.24 };
  const scrimGradient =
    `radial-gradient(ellipse ${scrimSpec.size} at ${focus.x}% ${focus.y}%, ` +
    `${rgba(scrimBase, scrimSpec.a0)} 0%, ${rgba(scrimBase, scrimSpec.a1)} ${scrimSpec.s1}%, ` +
    `${rgba(scrimBase, scrimSpec.a2)} ${scrimSpec.s2}%, transparent ${orientation === "horizontal" ? 84 : 85}%)`;

  const glowCenter = isAutoPosition
    ? orientation === "horizontal"
      ? "24% 48%"
      : orientation === "square"
        ? "50% 72%"
        : "32% 74%"
    : `${focus.x}% ${vert === "top" ? focus.y + 8 : vert === "bottom" ? focus.y - 8 : focus.y}%`;
  const titleGlow = `radial-gradient(${Math.round(640 * u)}px ${Math.round(460 * u)}px at ${glowCenter}, ${rgba(colors.primary, 0.14)} 0%, ${rgba(colors.primary, 0.06)} 55%, transparent 100%)`;

  const titleSize = Math.round((orientation === "horizontal" ? 54 : orientation === "square" ? 76 : 88) * u);
  const subtitleSize = Math.round((orientation === "horizontal" ? 26 : 30) * u);
  const statValueSize = Math.round(34 * u);
  const statLabelSize = Math.round(15 * u);
  const ctaSize = Math.round(20 * u);
  const eyebrowSize = Math.round(15 * u);
  const logoHeight = Math.round((orientation === "horizontal" ? 40 : 56) * u);

  const headingFont = fontFamily(hasBrandHeading ? BRAND_HEADING_FAMILY : null, fonts.heading);
  const bodyFont = fontFamily(hasBrandBody ? BRAND_BODY_FAMILY : null, fonts.body);

  const logoCorner: React.CSSProperties = isAutoPosition
    ? orientation === "horizontal"
      ? { top: marginY, right: marginX }
      : { top: marginY, left: marginX }
    : {
        ...(vert === "top" ? { bottom: marginY } : { top: marginY }),
        ...(horiz === "right" ? { left: marginX } : { right: marginX }),
      };

  const logoNode =
    showLogo && logoFile ? (
      <Img
        src={staticFile(logoFile)}
        style={{
          position: "absolute",
          ...logoCorner,
          height: logoHeight,
          width: "auto",
          objectFit: "contain",
          filter: `drop-shadow(0 ${2 * u}px ${10 * u}px rgba(0,0,0,0.35))`,
        }}
      />
    ) : null;

  const padTop = Math.round(titleSize * 0.18);
  const padBottom = Math.round(titleSize * 0.12);
  const padRight = Math.round(titleSize * 0.06);

  const highlightStyle: React.CSSProperties = effects.gradient
    ? {
        display: "inline-block",
        lineHeight: 1.2,
        overflow: "visible",
        padding: `${padTop}px ${padRight}px ${padBottom}px 0`,
        margin: `${-padTop}px ${-padRight}px ${-padBottom}px 0`,
        backgroundImage: `linear-gradient(94deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
        textShadow: "none",
      }
    : { color: colors.primary };

  const contentAlign: React.CSSProperties = {
    justifyContent:
      vert === "top" ? "flex-start" : vert === "bottom" ? "flex-end" : "center",
    alignItems: flexAlign,
    textAlign: horiz,
  };

  const centered = horiz === "center";

  const contentMaxWidth =
    orientation === "horizontal"
      ? Math.round(width * (horiz === "center" ? 0.72 : 0.47))
      : Math.round(width - marginX * 2);

  const particleColor = (c: ParticleSpec["color"]): string =>
    c === "accent" ? colors.accent : colors.secondary;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, fontFamily: bodyFont }}>

      {background ? (
        <Img
          src={staticFile(background)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AbsoluteFill style={{ background: gradientBackground }} />
      )}

      <AbsoluteFill style={{ background: brandTint }} />

      <AbsoluteFill style={{ background: scrimGradient }} />

      <AbsoluteFill style={{ background: titleGlow }} />

      {(isAutoPosition ? PARTICLES[orientation] : []).map((p, i) =>
        p.shape === "plus" ? (
          <svg
            key={i}
            width={Math.round(p.size * u)}
            height={Math.round(p.size * u)}
            viewBox="0 0 24 24"
            style={{ position: "absolute", left: p.x, top: p.y, opacity: p.opacity }}
          >
            <path
              d="M12 3.5v17M3.5 12h17"
              stroke={particleColor(p.color)}
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        ) : (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: Math.round(p.size * u),
              height: Math.round(p.size * u),
              borderRadius: "50%",
              backgroundColor: particleColor(p.color),
              opacity: p.opacity,
            }}
          />
        ),
      )}

      {logoNode}

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          padding: `${marginY}px ${marginX}px`,
          ...contentAlign,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: contentMaxWidth,
            alignItems: flexAlign,
          }}
        >

          {hasBrandName ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: Math.round(9 * u),
                padding: `${Math.round(8 * u)}px ${Math.round(18 * u)}px`,
                borderRadius: 999,
                border: `1px solid ${rgba(colors.primary, 0.45)}`,
                backgroundColor: rgba(colors.primary, 0.12),
                fontFamily: headingFont,
                fontSize: eyebrowSize,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: colors.primary,
                marginBottom: Math.round(18 * u),
              }}
            >
              <span
                style={{
                  width: Math.round(7 * u),
                  height: Math.round(7 * u),
                  borderRadius: "50%",
                  backgroundColor: colors.primary,
                  boxShadow: `0 0 ${10 * u}px ${rgba(colors.primary, 0.8)}`,
                }}
              />
              {brandName.trim()}
            </div>
          ) : null}

          {hasTitle ? (
            <h1
              style={{
                margin: 0,
                fontFamily: headingFont,
                fontSize: titleSize,
                fontWeight: 900,
                lineHeight: 1.14,
                letterSpacing: "-0.03em",
                color: colors.text,
                textWrap: "balance",
                textShadow: `0 ${2 * u}px ${20 * u}px rgba(0,0,0,0.45)`,
              }}
            >
              {highlight === "" ? (
                title.trim()
              ) : (
                <>
                  {plain} <span style={highlightStyle}>{highlight}</span>
                </>
              )}
            </h1>
          ) : null}

          {hasTitle ? (
            <div
              style={{
                width: "52%",
                height: Math.round(2 * u),
                marginTop: Math.round(16 * u),
                borderRadius: 999,

                background: centered
                  ? `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`
                  : horiz === "right"
                    ? `linear-gradient(270deg, ${colors.primary}, transparent)`
                    : `linear-gradient(90deg, ${colors.primary}, transparent)`,
              }}
            />
          ) : null}

          {hasSubtitle ? (
            <p
              style={{
                margin: 0,
                marginTop: hasTitle ? Math.round(18 * u) : 0,
                fontFamily: bodyFont,
                fontSize: subtitleSize,
                fontWeight: 500,
                lineHeight: 1.4,
                letterSpacing: "0.01em",
                color: rgba(colors.text, 0.78),
                maxWidth: "34ch",
                textShadow: `0 ${1 * u}px ${12 * u}px rgba(0,0,0,0.35)`,
              }}
            >
              {subtitle.trim()}
            </p>
          ) : null}

          {validStats.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "stretch",
                gap: Math.round(14 * u),
                justifyContent: flexAlign,
                marginTop: Math.round(24 * u),
              }}
            >
              {validStats.map((stat: PosterStat, i: number) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: Math.round(3 * u),
                    alignItems: flexAlign,
                    padding: `${Math.round(14 * u)}px ${Math.round(20 * u)}px`,
                    borderRadius: Math.round(14 * u),

                    backgroundColor: effects.liquidGlass
                      ? rgba(colors.text, 0.07)
                      : mix(colors.background, colors.text, 0.08),
                    border: `1px solid ${rgba(colors.text, effects.liquidGlass ? 0.14 : 0.1)}`,
                    ...(effects.liquidGlass
                      ? {
                          backdropFilter: `blur(${Math.round(12 * u)}px)`,
                          WebkitBackdropFilter: `blur(${Math.round(12 * u)}px)`,
                        }
                      : {}),
                  }}
                >
                  <span
                    style={{
                      fontFamily: headingFont,
                      fontSize: statValueSize,
                      fontWeight: 800,
                      lineHeight: 1.1,
                      letterSpacing: "-0.01em",
                      color: colors.primary,
                    }}
                  >
                    {stat.value}
                  </span>
                  {stat.label.trim() !== "" ? (
                    <span
                      style={{
                        fontFamily: bodyFont,
                        fontSize: statLabelSize,
                        fontWeight: 500,
                        letterSpacing: "0.04em",
                        color: rgba(colors.text, 0.62),
                      }}
                    >
                      {stat.label}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {hasCta ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                alignSelf: flexAlign,
                marginTop: Math.round(24 * u),
                height: Math.round(52 * u),
                padding: `0 ${Math.round(30 * u)}px`,
                borderRadius: 999,
                backgroundColor: colors.primary,
                boxShadow: `0 ${8 * u}px ${24 * u}px ${rgba(colors.primary, 0.35)}`,
                fontFamily: headingFont,
                fontSize: ctaSize,
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: "#ffffff",
                whiteSpace: "nowrap",
              }}
            >
              {cta.trim()}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
