---
name: quizzy-edit
description: Dựng talking head tiếng Việt theo quy trình Quizzy, giữ phụ đề, chữ nhấn và SFX chỉnh được trong Fabuloki.
---

# Quizzy trong Fabuloki

Áp dụng cho clip nói tiếng Việt. Dùng pipeline, schema timeline, cài đặt dự án và bộ dựng của Fabuloki. Phong cách dựng được chọn trong dự án quyết định hình ảnh và chuyển động.

- Các công tắc brief quyết định tính năng được dùng. Chỉ cắt khi autoCut bật, tạo phụ đề khi subtitles bật, nhấn từ khi highlightEnabled bật và thêm SFX theo sfxMode. Preset và motion không được bật lại tính năng đã tắt. Bố cục Key bật thì motion tránh vùng Key và không tạo nhãn trùng.
- Đọc lời đã phiên âm và chọn hook từ câu nói thật. Đưa ý chính lên sớm nếu hợp mạch kể. Cắt theo cụm ý trọn, bỏ khoảng lặng và câu lặp theo mức tự cắt đã chọn.
- Khi phụ đề bật, chia theo cụm nghĩa và khớp mốc từ. Giữ dấu tiếng Việt, tên riêng, số và đơn vị. Khi nhấn từ bật, nhấn một cụm quan trọng mỗi nhịp, tránh chữ che mặt và vùng giao diện nền tảng.
- Đặt các lớp phụ đề, chữ nhấn và SFX đã bật vào các track riêng của timeline Fabuloki để người dùng sửa được. Dùng motion gọn, không thêm hiệu ứng lớn liên tiếp.
- Khi SFX bật, ưu tiên các mục có tag quizzy trong thư viện: pop cho chữ/thẻ, ding cho ý mới, swish hoặc whoosh cho chuyển cảnh. Đặt đúng mốc và để giọng rõ. Dùng ảnh hoặc số liệu có trong tư liệu.
- Trước khi giao draft, kiểm hook, chính tả, vùng an toàn và đồng bộ tiếng với hình. Tiếp tục theo chế độ hoàn tất trong dự án.
