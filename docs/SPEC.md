# SPEC Fabuloki

## Hành vi hiện hành

| Phạm vi | Yêu cầu | Nguồn |
| --- | --- | --- |
| Nhận diện | Dùng tên và biểu tượng Fabuloki. Giao diện có chủ đề tối mặc định với nền xanh lá đậm, điểm nhấn xanh non và vàng đồng. Người dùng có thể chuyển chủ đề. | Yêu cầu khởi tạo của chủ dự án, [layout](../apps/web/src/app/layout.tsx), [token màu](../apps/web/src/app/globals.css). |
| Khởi động | Giao diện mặc định ở `127.0.0.1:6868`, API ở `127.0.0.1:6869`. Script khởi động cùng hai tiến trình và dừng chúng theo vòng đời launcher. | [Launcher](../start/local.mjs), [API](../apps/server/src/index.ts). |
| Dựng video | Dự án giữ cảnh, phụ đề và âm thanh trên timeline. Cảnh HyperFrames đi qua hàng đợi trước khi Remotion ghép MP4. Bản cuối đi sau bản nháp; cấu hình QC có thể chặn xuất nếu kiểm tra thất bại. | [Hàng đợi](../apps/server/src/routes/timeline.ts), [điều kiện render](../apps/server/src/jobRules.ts), [lắp ráp](../apps/server/src/jobs/assemble.ts). |
| Nội dung | Giữ Auto Cut, Dịch video, Giọng đọc, Style Design, Studio Kịch bản, Quizzy và chọn hiệu ứng cho từng nguồn. Quizzy và Kho hiệu ứng hiển thị mô tả mẫu. Danh mục không phụ thuộc footage từ gói cũ. | [Menu](../apps/web/src/components/Shell.tsx), [mẫu kịch bản](../apps/server/src/scriptFormats.ts), [motion](../assets/quizzy/motions.json), [hiệu ứng](../assets/edit-effects/catalog.json). |
| Kết nối | Claude hoặc Codex cho luồng tương ứng. Gemini API dùng cho tạo ảnh. VoiceStudio lấy hồ sơ giọng từ dịch vụ tại `127.0.0.1:3900` khi có. | [Nhà cung cấp](../apps/server/src/routes/providers.ts), [Gemini](../apps/server/src/imageProviders/index.ts), [VoiceStudio](../apps/server/src/voiceStudio.ts). |
| Dữ liệu | Git chỉ lưu mã, cấu hình mẫu và tài sản có nguồn. Dự án, dữ liệu người dùng, khóa, mô hình, cache, bản dựng và kết quả xuất lưu cục bộ. | [Quy tắc Git](../.gitignore), [thư mục dữ liệu](../apps/server/src/config.ts). |

## Phép thử

- `npm run typecheck` kiểm tra kiểu của giao diện, API và engine.
- Khởi động từ bản build rồi kiểm tra trang dự án và `/api/health`. Mở Dashboard, Quizzy và Kho hiệu ứng trong trình duyệt. Kiểm tra giao diện khổ máy tính và điện thoại.
- Dùng một cảnh HyperFrames để xếp hàng bản nháp, chạy QC, xuất bản cuối và giải mã MP4 bằng FFmpeg. Việc này kiểm tra luồng dựng tại máy. Kết nối tài khoản và các chức năng trực tuyến cần phép thử riêng với nhà cung cấp.
