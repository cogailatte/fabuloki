import fs from "node:fs";
import path from "node:path";
import type { Brief } from "./meta.js";
import { repoRoot } from "./config.js";

export const quizzyMotions = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "assets/quizzy/motions.json"), "utf8"),
) as Array<{id: string; name: string; motion: string}>;

export function quizzyMotionLines(brief: Pick<Brief, "skill" | "quizzyMotionIds" | "subtitles" | "highlightEnabled" | "keyLayoutEnabled" | "sfxMode" | "autoCut">): string[] {
  if (brief.skill !== "quizzy-edit") return [];
  const ids = brief.quizzyMotionIds ?? [];
  const choices = ids.length ? quizzyMotions.filter(item => ids.includes(item.id)) : quizzyMotions;
  return [
    "## Motion Quizzy trong luồng dựng",
    "ƯU TIÊN CẤU HÌNH: Các công tắc trong brief quyết định tính năng được dùng. Mô tả mẫu dưới đây chỉ gợi ý chuyển động, không được bật lại tính năng đã tắt.",
    brief.autoCut ? "Tự cắt theo mức trong brief." : "Tự cắt TẮT: giữ các đoạn nguồn, không cắt lại vì hook hay nhịp motion.",
    brief.subtitles ? "Phụ đề BẬT: khớp lời và đặt trên track riêng." : "Phụ đề TẮT: không tạo phụ đề karaoke hay phụ đề từng từ theo preset Quizzy.",
    brief.highlightEnabled ? "Nhấn từ BẬT: áp theo keyword trong brief." : "Nhấn từ TẮT: bỏ Word Punch, chữ nhấn và nhấn keyword trong các mẫu.",
    brief.keyLayoutEnabled ? "Bố cục Key BẬT: giữ các vùng Key theo brief; motion phải tránh che hoặc tạo thêm một bộ key trùng nội dung." : "Bố cục Key TẮT: không tạo các vùng Key cố định trên/dưới theo mẫu.",
    brief.sfxMode === "none" ? "SFX TẮT: không thêm tiếng hiệu ứng, kể cả mẫu có tiếng." : "SFX theo chế độ trong brief; không dùng tiếng của clip tham chiếu.",
    ids.length ? "Người dùng chọn các mẫu dưới đây. Ưu tiên chúng ở các ý phù hợp." : "AI tự chọn motion phù hợp từ danh mục dưới đây.",
    ...choices.map(item => `- ${item.id} · ${item.name}: ${item.motion}`),
    "Dùng mô tả mẫu để dựng motion bằng HyperFrames hoặc Remotion với video, lời và dữ liệu của dự án.",
    "Chọn theo nghĩa của câu, khoảng một motion lớn mỗi 5–8 giây. Giữ màu/font theo nhận diện thương hiệu, các lớp phụ đề và SFX được bật thì đặt ở track riêng. Không ép dùng hết mẫu.",
    "Nếu mẫu cần ảnh, dữ liệu hay tách nền chưa có, bỏ qua mẫu đó và báo lý do. Báo cáo bản nháp phải ghi mẫu đã dùng và mốc giây; không báo đã áp nếu chưa dựng được.",
  ];
}
