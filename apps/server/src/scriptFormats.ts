export const SCRIPT_FORMATS = {
  mood: {
    label: "Voiceoff / Mood",
    story: "Mở bằng một cảm giác, dẫn vào không gian, làm rõ một chi tiết rồi để lại dư âm.",
    edit: "Dùng nhịp chậm, khoảng thở, xen cảnh rộng và cận chất liệu. Chuyển cảnh mềm và tiết chế chữ.",
  },
  painpoint: {
    label: "Painpoint",
    story: "Nêu vấn đề cụ thể, cho thấy hệ quả, đưa giải pháp rồi chốt lợi ích.",
    edit: "Vào vấn đề nhanh, đổi cảnh theo từng ý và nhấn từ khóa đúng lúc nếu brief bật nhấn chữ.",
  },
  debate: {
    label: "Phản biện",
    story: "Nêu quan điểm quen thuộc, đặt lại vấn đề, đưa ví dụ có căn cứ rồi chốt góc nhìn.",
    edit: "Tạo nhịp đối chiếu giữa hai góc nhìn, ngắt nhẹ khi chuyển luận điểm và dành thời gian cho ví dụ.",
  },
  tour: {
    label: "Housetour",
    story: "Định vị công trình, dẫn qua các không gian theo lộ trình, dừng ở chi tiết đáng chú ý rồi chốt trải nghiệm.",
    edit: "Dùng cảnh rộng để định vị, theo hướng di chuyển nhất quán và xen cảnh cận khi lời đọc nhắc tới chi tiết.",
  },
} as const;

export type ScriptFormat = keyof typeof SCRIPT_FORMATS;

export function isScriptFormat(value: unknown): value is ScriptFormat {
  return typeof value === "string" && Object.hasOwn(SCRIPT_FORMATS, value);
}

export function scriptFormatEditLine(format: ScriptFormat | null): string {
  if (!format) return "";
  const { label, story, edit } = SCRIPT_FORMATS[format];
  return `- Dạng kịch bản (${label}): ${story} ${edit} Điều chỉnh theo lời đọc và asset có sẵn. Dùng dạng này cho cấu trúc và nhịp; giữ màu, font và logo theo Style Design, phối hợp motion theo phong cách dựng đã chọn và tuân thủ các công tắc trong brief.`;
}
