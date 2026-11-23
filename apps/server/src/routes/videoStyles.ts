import { Router } from "express";
import {
  builtinVideoStyle,
  isBuiltinVideoStyle,
  readVideoStyles,
  videoStyleUsage,
  writeVideoStyles,
  type VideoStyle,
  type VideoStylePalette,
} from "../videoStyles.js";
import { HttpError, isKebabCase, nowIso, toKebabAscii } from "../util.js";

const router = Router();

interface ManagedVideoStyle extends VideoStyle {

  builtin: boolean;

  usageCount: number;
}

function findStyle(styles: VideoStyle[], id: string): VideoStyle {
  const style = styles.find((s) => s.id === id);
  if (!style) {
    throw new HttpError(404, "VIDEO_STYLE_NOT_FOUND", `Không tìm thấy phong cách dựng "${id}"`);
  }
  return style;
}

function requiredStr(body: Record<string, unknown>, key: string, label: string): string {
  const v = typeof body[key] === "string" ? (body[key] as string).trim() : "";
  if (!v) {
    throw new HttpError(400, "INVALID_VIDEO_STYLE", `Thiếu ${key} - ${label}`);
  }
  return v;
}

function normPalette(raw: unknown): VideoStylePalette {
  if (raw !== "brand" && raw !== "loose") {
    throw new HttpError(400, "INVALID_PALETTE", 'palette phải là "brand" hoặc "loose"');
  }
  return raw;
}

function managedOf(style: VideoStyle, usageCount: number): ManagedVideoStyle {
  return { ...style, builtin: isBuiltinVideoStyle(style.id), usageCount };
}

router.get("/", (req, res) => {
  const { styles } = readVideoStyles();
  if (req.query.full === "1" || req.query.full === "true") {
    res.json(
      styles.map((s) => managedOf(s, videoStyleUsage(s.id).length)),
    );
    return;
  }
  res.json(
    styles.map((s) => ({
      id: s.id,
      name: s.name,
      palette: s.palette,
      motion: s.motion,
    })),
  );
});

router.get("/:id", (req, res) => {
  const { styles } = readVideoStyles();
  const style = findStyle(styles, req.params.id);
  const usage = videoStyleUsage(style.id);
  res.json({ ...managedOf(style, usage.length), usage });
});

router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const data = readVideoStyles();

  let base: Omit<VideoStyle, "id" | "createdAt" | "updatedAt"> | null = null;
  if ("cloneFrom" in body) {
    if (typeof body.cloneFrom !== "string") {
      throw new HttpError(400, "INVALID_CLONE_FROM", "cloneFrom phải là id phong cách (string)");
    }
    const src = findStyle(data.styles, body.cloneFrom);
    base = { name: src.name, art: src.art, avoid: src.avoid, palette: src.palette, motion: src.motion };
  }

  const pick = (key: "name" | "art" | "avoid" | "motion", label: string): string => {
    if (key in body || !base) return requiredStr(body, key, label);
    return base[key];
  };
  const name = pick("name", "tên phong cách");
  const art = pick("art", "chỉ đạo mỹ thuật cho ảnh (viết tiếng Anh)");
  const avoid = pick("avoid", "thứ cần tránh trong ảnh (viết tiếng Anh)");
  const motion = pick("motion", "cách dựng cảnh và chuyển động (viết tiếng Việt)");
  const palette = "palette" in body ? normPalette(body.palette) : (base?.palette ?? "brand");

  let id: string;
  if ("id" in body && body.id !== null && body.id !== "") {
    if (typeof body.id !== "string" || !isKebabCase(body.id.trim())) {
      throw new HttpError(
        400,
        "INVALID_VIDEO_STYLE_ID",
        "id phải là kebab-case (vd: giay-gap-nhat)",
      );
    }
    id = body.id.trim();
    if (data.styles.some((s) => s.id === id)) {
      throw new HttpError(409, "VIDEO_STYLE_EXISTS", `Phong cách dựng "${id}" đã tồn tại`);
    }
  } else {
    const baseId = toKebabAscii(name) || "phong-cach";
    id = baseId;
    for (let n = 2; data.styles.some((s) => s.id === id); n++) id = `${baseId}-${n}`;
  }

  const now = nowIso();
  const style: VideoStyle = { id, name, art, avoid, palette, motion, createdAt: now, updatedAt: now };
  data.styles.push(style);

  data.removedBuiltins = data.removedBuiltins.filter((x) => x !== id);
  writeVideoStyles(data);
  res.status(201).json(managedOf(style, 0));
});

router.put("/:id", (req, res) => {
  const data = readVideoStyles();
  const style = findStyle(data.styles, req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;

  if ("id" in body && typeof body.id === "string" && body.id.trim() !== style.id) {
    throw new HttpError(
      400,
      "VIDEO_STYLE_ID_IMMUTABLE",
      "Không đổi được id của phong cách - project cũ trỏ vào id này. Tạo phong cách mới rồi chọn lại.",
    );
  }

  const patch: Partial<Pick<VideoStyle, "name" | "art" | "avoid" | "motion" | "palette">> = {};
  if ("name" in body) patch.name = requiredStr(body, "name", "tên phong cách");
  if ("art" in body) {
    patch.art = requiredStr(body, "art", "chỉ đạo mỹ thuật cho ảnh (viết tiếng Anh)");
  }
  if ("avoid" in body) {
    patch.avoid = requiredStr(body, "avoid", "thứ cần tránh trong ảnh (viết tiếng Anh)");
  }
  if ("motion" in body) {
    patch.motion = requiredStr(body, "motion", "cách dựng cảnh và chuyển động (viết tiếng Việt)");
  }
  if ("palette" in body) patch.palette = normPalette(body.palette);
  Object.assign(style, patch);

  style.updatedAt = nowIso();
  writeVideoStyles(data);
  res.json(managedOf(style, videoStyleUsage(style.id).length));
});

router.delete("/:id", (req, res) => {
  const data = readVideoStyles();
  const style = findStyle(data.styles, req.params.id);
  const force = req.query.force === "1" || req.query.force === "true";
  const usage = videoStyleUsage(style.id);
  if (usage.length > 0 && !force) {
    throw new HttpError(
      409,
      "VIDEO_STYLE_IN_USE",
      `Phong cách "${style.name}" đang được ${usage.length} project dùng: ` +
        `${usage.map((u) => u.name).join(", ")}. Xóa vẫn được (các project đó sẽ về "AI tự quyết") ` +
        "nhưng phải xác nhận - gọi lại với ?force=1.",
    );
  }
  data.styles = data.styles.filter((s) => s.id !== style.id);

  if (isBuiltinVideoStyle(style.id) && !data.removedBuiltins.includes(style.id)) {
    data.removedBuiltins.push(style.id);
  }
  writeVideoStyles(data);
  res.status(204).end();
});

router.post("/:id/reset", (req, res) => {
  const id = req.params.id;
  const original = builtinVideoStyle(id);
  if (!original) {
    throw new HttpError(
      400,
      "NOT_BUILTIN_VIDEO_STYLE",
      `"${id}" không phải phong cách mặc định nên không có bản gốc để khôi phục`,
    );
  }
  const data = readVideoStyles();
  const cur = data.styles.find((s) => s.id === id);
  if (cur) {
    cur.name = original.name;
    cur.art = original.art;
    cur.avoid = original.avoid;
    cur.palette = original.palette;
    cur.motion = original.motion;
    cur.updatedAt = nowIso();
  } else {
    data.styles.push(original);
  }
  data.removedBuiltins = data.removedBuiltins.filter((x) => x !== id);
  writeVideoStyles(data);
  const style = findStyle(data.styles, id);
  res.json(managedOf(style, videoStyleUsage(id).length));
});

export default router;
