import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import {
  BRAND_BODY_FAMILY,
  BRAND_HEADING_FAMILY,
  ensureBrandFont,
} from "./brandFonts";
import type { ThumbnailProps } from "./thumbnailManifest";

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
  const tail =
    !name || name === "Inter" ? SYSTEM_STACK : `'${name.replace(/'/g, "")}', ${SYSTEM_STACK}`;
  return brandFamily ? `'${brandFamily}', ${tail}` : tail;
};

export const Thumbnail: React.FC<ThumbnailProps> = ({
  background,
  frame,
  title,
  design,
}) => {

  const { width, height } = useVideoConfig();
  const { colors, fonts, fontFiles, effects, logoFile, brandName } = design;
  const horizontal = width > height;

  const hasBrandHeading = ensureBrandFont(BRAND_HEADING_FAMILY, fontFiles.heading);
  const hasBrandBody = ensureBrandFont(BRAND_BODY_FAMILY, fontFiles.body);
  const headingFont = fontFamily(hasBrandHeading ? BRAND_HEADING_FAMILY : null, fonts.heading);
  const bodyFont = fontFamily(hasBrandBody ? BRAND_BODY_FAMILY : null, fonts.body);

  const u = width / 1080;
  const marginX = Math.round(width * 0.06);
  const marginY = Math.round(height * 0.055);

  const titleSize = Math.round((horizontal ? 66 : 108) * u);
  const eyebrowSize = Math.round((horizontal ? 15 : 26) * u);
  const logoHeight = Math.round((horizontal ? 40 : 60) * u);

  const gradientBackground = [
    `radial-gradient(ellipse 130% 95% at 85% -12%, ${rgba(colors.primary, 0.5)} 0%, ${rgba(colors.primary, 0.16)} 40%, transparent 68%)`,
    `radial-gradient(ellipse 100% 80% at -10% 105%, ${rgba(colors.primary, 0.16)} 0%, transparent 50%)`,
    `linear-gradient(160deg, ${mix(colors.background, colors.primary, 0.22)} 0%, ${colors.background} 48%, ${mix(colors.background, "#000000", 0.3)} 100%)`,
  ].join(", ");

  const scrimBase = mix(colors.background, "#000000", 0.55);
  const scrim = horizontal
    ? `linear-gradient(90deg, ${rgba(scrimBase, 0.88)} 0%, ${rgba(scrimBase, 0.62)} 34%, ${rgba(scrimBase, 0.18)} 52%, transparent 68%)`
    : `linear-gradient(180deg, transparent 40%, ${rgba(scrimBase, 0.3)} 56%, ${rgba(scrimBase, 0.86)} 74%, ${rgba(scrimBase, 0.95)} 100%)`;

  const cardRadius = Math.round(36 * u);
  const cardStyle: React.CSSProperties = horizontal
    ? {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        right: marginX,
        width: Math.round(width * 0.52),
        height: Math.round(height * 0.78),
      }
    : {
        position: "absolute",
        top: marginY,
        left: "50%",
        transform: "translateX(-50%)",
        width: width - marginX * 2,
        height: Math.round(height * 0.56),
      };

  const titleStyle: React.CSSProperties = effects.gradient
    ? {
        display: "inline-block",
        padding: "0.5em 0.06em 0.22em 0",
        margin: "-0.5em -0.06em -0.22em 0",
        backgroundImage: `linear-gradient(94deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
        textShadow: "none",
      }
    : {
        display: "inline-block",
        padding: "0.5em 0.06em 0.22em 0",
        margin: "-0.5em -0.06em -0.22em 0",
        color: colors.text,
        textShadow: `0 ${Math.round(6 * u)}px ${Math.round(30 * u)}px rgba(0,0,0,0.55)`,
      };

  const titleZone: React.CSSProperties = horizontal
    ? {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: marginX,
        width: Math.round(width * 0.36),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        textAlign: "left",
      }
    : {
        position: "absolute",
        left: marginX,
        right: marginX,
        top: marginY + Math.round(height * 0.56),
        bottom: marginY,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      };

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, fontFamily: bodyFont }}>

      {background ? (
        <Img
          src={staticFile(background)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "brightness(0.82) saturate(0.95)",
          }}
        />
      ) : (
        <AbsoluteFill style={{ background: gradientBackground }} />
      )}

      <AbsoluteFill
        style={{
          background: `linear-gradient(to top, ${rgba(colors.primary, 0.1)} 0%, transparent 55%)`,
        }}
      />

      <AbsoluteFill style={{ background: scrim }} />

      {frame ? (
        <div
          style={{
            ...cardStyle,
            borderRadius: cardRadius,
            overflow: "hidden",
            border: `${Math.max(2, Math.round(3 * u))}px solid ${rgba(colors.text, 0.2)}`,
            boxShadow: `0 ${Math.round(28 * u)}px ${Math.round(70 * u)}px rgba(0,0,0,0.55), 0 0 0 ${Math.max(1, Math.round(1.5 * u))}px ${rgba(colors.primary, 0.35)}`,
          }}
        >
          <Img
            src={staticFile(frame)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      ) : null}

      <AbsoluteFill
        style={{
          background: horizontal
            ? `radial-gradient(${Math.round(560 * u)}px ${Math.round(420 * u)}px at 22% 55%, ${rgba(colors.primary, 0.16)} 0%, transparent 100%)`
            : `radial-gradient(${Math.round(700 * u)}px ${Math.round(380 * u)}px at 50% 82%, ${rgba(colors.primary, 0.18)} 0%, transparent 100%)`,
        }}
      />

      <div style={titleZone}>
        {logoFile ? (
          <Img
            src={staticFile(logoFile)}
            style={{
              height: logoHeight,
              width: "auto",
              objectFit: "contain",
              marginBottom: Math.round(20 * u),
              filter: `drop-shadow(0 ${2 * u}px ${10 * u}px rgba(0,0,0,0.4))`,
            }}
          />
        ) : brandName.trim() !== "" ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: Math.round(9 * u),
              padding: `${Math.round(8 * u)}px ${Math.round(20 * u)}px`,
              borderRadius: 999,
              border: `1px solid ${rgba(colors.primary, 0.5)}`,
              backgroundColor: rgba(colors.primary, 0.14),
              fontFamily: headingFont,
              fontSize: eyebrowSize,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: colors.primary,
              marginBottom: Math.round(20 * u),
            }}
          >
            <span
              style={{
                width: Math.round(8 * u),
                height: Math.round(8 * u),
                borderRadius: "50%",
                backgroundColor: colors.primary,
                boxShadow: `0 0 ${10 * u}px ${rgba(colors.primary, 0.8)}`,
              }}
            />
            {brandName.trim()}
          </div>
        ) : null}

        {title.trim() !== "" ? (
          <h1
            style={{
              margin: 0,
              fontFamily: headingFont,
              fontSize: titleSize,
              fontWeight: 900,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
              textWrap: "balance",
            }}
          >
            <span style={titleStyle}>{title.trim()}</span>
          </h1>
        ) : null}

        {title.trim() !== "" ? (
          <div
            style={{
              width: Math.round(220 * u),
              height: Math.max(2, Math.round(7 * u)),
              borderRadius: 999,
              marginTop: Math.round(26 * u),
              background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
              boxShadow: `0 0 ${Math.round(26 * u)}px ${rgba(colors.primary, 0.6)}`,
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
