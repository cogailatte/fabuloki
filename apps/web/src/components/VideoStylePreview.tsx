"use client";

import { useId, useState, type CSSProperties } from "react";
import { Pause, Play, Maximize2 } from "lucide-react";
import { previewPreset, type StylePreviewPreset } from "@/lib/video-style-previews";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";
import css from "./VideoStylePreview.module.css";

function Artwork({ preset: p, id }: { preset: StylePreviewPreset; id: string }) {
  const f = p.family;
  const outline = ["drawing", "blueprint", "ink"].includes(f);
  const data = f === "data" || f === "app";
  const isometric = f === "iso" || f === "glass";
  const collage = f === "collage";
  const serif = ["paint", "ink", "folk", "deco", "film", "map"].includes(f);
  return (
    <svg viewBox="0 0 640 400" aria-hidden="true">
      <defs>
        <pattern id={`${id}-grid`} width={f === "pixel" ? 20 : 32} height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke={p.ink} strokeOpacity=".12" /></pattern>
        <pattern id={`${id}-dots`} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.3" fill={p.ink} opacity=".18" /></pattern>
        <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L7 0" stroke={p.ink} strokeOpacity=".22" /></pattern>
        <filter id={`${id}-paper`}><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".10"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter>
        <filter id={`${id}-glow`}><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <linearGradient id={`${id}-glass`} x2="1" y2="1"><stop stopColor="#ffffff" stopOpacity=".9"/><stop offset=".5" stopColor={p.accent}/><stop offset="1" stopColor={p.secondary}/></linearGradient>
      </defs>
      <rect width="640" height="400" fill={p.bg}/>
      {["blueprint", "pixel", "science", "app"].includes(f) && <rect width="640" height="400" fill={`url(#${id}-grid)`}/>}
      {["comic", "retro"].includes(f) && <rect width="640" height="400" fill={`url(#${id}-dots)`}/>}
      {["paint", "folk", "ink", "map", "drawing", "collage", "film"].includes(f) && <rect width="640" height="400" fill={p.bg} filter={`url(#${id}-paper)`} opacity=".7"/>}
      {f === "deco" && <g stroke={p.accent} opacity=".45">{Array.from({length:13},(_,i)=><path key={i} d={`M320 330L${32+i*48} 0`}/>)}</g>}
      {f === "retro" && <g fill="none" strokeWidth="16" opacity=".5">{[0,1,2,3].map(i=><circle key={i} cx="540" cy="100" r={40+i*23} stroke={i%2?p.accent:p.secondary}/>)}</g>}
      {f === "neon" && <g stroke={p.secondary} opacity=".45">{Array.from({length:10},(_,i)=><path key={i} d={`M320 200L${-250+i*130} 400`}/>)}{[250,275,310,355].map(y=><path key={y} d={`M0 ${y}H640`}/>)}</g>}
      <g className={css.title} fill={p.ink} fontFamily={serif?"Georgia,serif":"Inter,Arial,sans-serif"}>
        <text x="36" y="41" fontSize="12" letterSpacing="3">B I S C O N S  /  DESIGN STORIES</text>
        <text x="36" y="83" fontSize={f==="type"?"42":"32"} fontWeight={serif?"400":"800"}>{f==="terminal"?"> KHONG GIAN_":"KHÔNG GIAN"}</text>
        <text x="36" y="118" fontSize={f==="type"?"42":"32"} fontWeight={serif?"400":"800"}>{f==="terminal"?"> DANG SONG_":"ĐÁNG SỐNG"}</text>
      </g>
      <g className={css.subject}>
        {data ? <>
          <rect x="250" y="149" width="330" height="174" rx={f==="app"?16:0} fill={p.secondary} opacity=".3" stroke={p.ink}/>
          <text x="271" y="180" fontSize="15" fill={p.ink} fontFamily="Inter,sans-serif">{f==="app"?"Fabuloki / PROJECT":"ÁNH SÁNG TỰ NHIÊN"}</text>
          {[70,106,140,94,120].map((h,i)=><rect key={i} x={278+i*55} y={303-h*.65} width="30" height={h*.65} rx={f==="app"?5:0} fill={i===2?p.accent:p.ink} opacity={i===2?1:.65}/>)}
          <path d="M274 311H558" stroke={p.ink}/>
        </> : f === "terminal" ? <g fill={p.ink} fontFamily="monospace" fontSize="18"><text x="245" y="181">[ BUILD YOUR HOME ]</text><text x="245" y="217"> /\__________</text><text x="245" y="245">/  \    []   |</text><text x="245" y="273">|__|___[]___|</text><text x="245" y="309">status: inspired ▌</text></g>
        : f === "map" ? <><path d="M230 310Q260 200 348 263T553 167" fill="none" stroke={p.accent} strokeWidth="5" strokeDasharray="9 7"/>{[[250,280],[350,262],[460,245],[550,170]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="9" fill={p.accent}/><circle cx={x} cy={y} r="3" fill={p.bg}/><text x={x-10} y={y-20} fill={p.ink} fontSize="14">0{i+1}</text></g>)}</>
        : f === "science" ? <g fill="none" stroke={p.accent} filter={`url(#${id}-glow)`}><ellipse cx="410" cy="233" rx="130" ry="45" transform="rotate(-25 410 233)"/><ellipse cx="410" cy="233" rx="130" ry="45" transform="rotate(35 410 233)"/><ellipse cx="410" cy="233" rx="130" ry="45" transform="rotate(90 410 233)"/><circle cx="410" cy="233" r="22" fill={p.accent}/><circle cx="500" cy="180" r="7" fill={p.secondary}/></g>
        : isometric ? <g stroke={p.ink} strokeWidth="1.5"><path d="M280 210L410 146 544 207 410 275Z" fill={f==="glass"?`url(#${id}-glass)`:p.accent}/><path d="M280 210V285L410 350V275Z" fill={p.secondary}/><path d="M410 275L544 207V284L410 350Z" fill={p.accent}/><path d="M315 240V279L355 299V260Z" fill={p.bg}/><path d="M455 273V309L496 289V254Z" fill={p.bg}/></g>
        : <>
          {collage && <rect x="246" y="143" width="344" height="192" fill="#ffffff" stroke={p.ink} strokeWidth="2" transform="rotate(-5 410 240)"/>}
          <circle cx="507" cy="167" r={f==="clay"?35:27} fill={p.accent} opacity=".9"/>
          <path d="M222 317L340 186 431 278 494 215 604 317Z" fill={p.secondary} opacity=".6"/>
          <g className={css.line} fill={outline?"none":p.accent} stroke={p.ink} strokeWidth={f==="comic"?5:outline?2:1} strokeLinejoin={f==="clay"?"round":"miter"} filter={f==="neon"?`url(#${id}-glow)`:undefined}>
            {f==="pixel" ? <path d="M280 310V210H300V190H320V170H340V150H360V170H380V190H400V210H440V310Z" shapeRendering="crispEdges"/> : <path d="M278 309V216L355 157 437 216V309Z"/>}
            <path d="M355 157L514 193 558 240V309H437V216Z" fill={outline?"none":p.secondary}/>
            <path d="M304 242H330V272H304ZM365 234H402V309H365ZM465 244H527V272H465Z" fill={outline?"none":p.bg}/>
            <path d="M254 310H575"/>
          </g>
          {f==="paper" && <><path d="M355 157L388 225 437 216Z" fill={p.ink} opacity=".18"/><path d="M355 157L278 216 330 207Z" fill={p.bg} opacity=".6"/></>}
          {f==="clay" && <ellipse cx="414" cy="330" rx="144" ry="10" fill={p.ink} opacity=".14"/>}
          {outline && <rect x="279" y="217" width="159" height="92" fill={`url(#${id}-hatch)`} opacity=".55"/>}
          {f==="blueprint" && <g fill="none" stroke={p.accent} strokeWidth="1"><path d="M259 149V327M574 182V327M259 330H574M273 149H367"/><path d="M252 323L266 337M568 323L580 337"/></g>}
          {f==="comic" && <path d="M533 94L552 116 588 112 576 138 601 157 565 162 552 185 537 160 508 165 519 140 500 119 530 122Z" fill={p.accent} stroke={p.ink} strokeWidth="3"/>}
          {f==="folk" && <g fill="none" stroke={p.accent} strokeWidth="2"><path d="M25 146H615M25 345H615"/>{[40,80,120,160,200].map(x=><circle key={x} cx={x} cy="329" r="5"/>)}</g>}
        </>}
      </g>
      <g className={css.detail} fill={p.ink} fontFamily="Inter,Arial,sans-serif"><rect x="36" y="174" width="50" height="3" fill={p.accent}/><text x="36" y="205" fontSize="13">Ánh sáng.</text><text x="36" y="229" fontSize="13">Chất liệu.</text><text x="36" y="253" fontSize="13">Cảm xúc.</text></g>
      <text x="36" y="373" fill={p.ink} fontFamily="Inter,Arial,sans-serif" fontSize="11" letterSpacing="2">Fabuloki — MOTION STUDY</text>
      <text x="584" y="373" textAnchor="end" fill={p.ink} fontFamily="monospace" fontSize="11">06 SEC / LOOP</text>
      {f==="film" && <><rect width="640" height="22" fill="#111111"/><rect y="378" width="640" height="22" fill="#111111"/></>}
    </svg>
  );
}

export function VideoStyleArtwork({ id, playing = false, hover = false }: { id: string; playing?: boolean; hover?: boolean }) {
  const p = previewPreset(id);
  const unique = useId().replace(/:/g, "");
  const { lang } = useT();
  if (!p) return <div className="flex aspect-[8/5] items-center justify-center rounded-lg bg-[var(--bg-subtle)] p-5 text-center text-sm text-[var(--text-muted)]">{lang === "vi" ? "Phong cách tùy chỉnh · chưa có mẫu minh họa" : "Custom style · no motion study yet"}</div>;
  return <div className={`${css.frame} ${hover ? css.hoverable : ""}`} data-family={p.family} data-playing={playing} style={{ "--preview-bg": p.bg } as CSSProperties}><Artwork preset={p} id={unique}/></div>;
}

export function VideoStylePreview({ id, name, motion }: { id: string; name: string; motion: string }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const { lang } = useT();
  const p = previewPreset(id);
  const vi = lang === "vi";
  return <div className="w-full" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <button type="button" className="group relative block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" aria-label={`${vi ? "Xem mẫu chuyển động" : "Preview motion"}: ${name}`} onClick={e=>{e.stopPropagation();setPlaying(true);setOpen(true);}} onKeyDown={e=>e.stopPropagation()}>
      <VideoStyleArtwork id={id} hover/>
      {p && <span className="absolute right-3 bottom-3 inline-flex items-center gap-2 rounded-full bg-black/75 px-3 py-2 text-xs font-semibold text-white"><Play size={13}/>{vi?"Xem chuyển động":"Preview motion"}<Maximize2 size={12}/></span>}
    </button>
    <Modal title={name} open={open} onClose={()=>setOpen(false)} wide footer={<><Button variant="secondary" onClick={()=>setOpen(false)}>{vi?"Đóng":"Close"}</Button>{p && <Button onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?(vi?"Tạm dừng":"Pause"):(vi?"Phát mẫu":"Play")}</Button>}</>}>
      {open && <div className="flex flex-col gap-4"><VideoStyleArtwork id={id} playing={playing}/><p className="text-sm text-[var(--text-muted)]">{motion}</p></div>}
    </Modal>
  </div>;
}
