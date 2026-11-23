# Rà soát mã nguồn chuyển sang Fabuloki

Phạm vi là bản mã nguồn đầu tiên của Fabuloki. Gói macOS nguồn được giữ ở thư mục ban đầu. Lịch sử nguồn công khai dùng để tham chiếu nằm trong [thông báo giấy phép](../THIRD_PARTY_NOTICES.md).

## Giữ lại

| Nhóm | Lý do |
| --- | --- |
| Giao diện, API, Remotion, phụ thuộc khóa phiên bản | Là đường chạy của dashboard, timeline, render, QC và các luồng dự án. |
| Chỉ dẫn dựng, thư viện phong cách, cấu trúc kịch bản, Quizzy, danh mục hiệu ứng | Là dữ liệu được giao diện và phiên dựng đọc. Giữ ID motion và hiệu ứng để có thể lưu lựa chọn trên dự án. |
| Mã Claude, Codex, Gemini API, Soniox và VoiceStudio | Phục vụ các lựa chọn kết nối hiện có của dự án. Mỗi kết nối cần thiết lập khi dùng. |
| Danh mục logo, hồ sơ nguồn, flag và font cần cho giao diện và render | Giữ các tham chiếu cần thiết. Xem phạm vi giấy phép trong [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md). |

Bản mã nguồn để công khai dùng danh mục logo trống. Danh mục tải về hoặc do người dùng thêm được lưu trên máy. [Nguồn và quyền sử dụng logo](../assets/brand-logos/README.md).

## Bỏ lại hoặc thay thế

| Bỏ lại | Lý do và ảnh hưởng |
| --- | --- |
| `.runtime/`, `node_modules/`, `.next/`, `dist/`, Python, FFmpeg và tệp native của gói Mac | Môi trường và bản dựng tái tạo được. Gói native Mac không dùng được trên Windows. |
| Các file `.command`, bộ tạo ZIP Mac, mẫu hướng dẫn phát hành cũ, `release.json`, script bật firewall và script cập nhật repo cũ | Khởi động từ mã nguồn dùng launcher Fabuloki. Tắt nút cập nhật cũ vì chưa có bộ phát hành cập nhật của Fabuloki. |
| Dữ liệu dự án, bản xuất, media nhập, log, cache, hồ sơ giọng và cài đặt xác thực | Đây là dữ liệu máy hoặc dữ liệu của người dùng. App tự tạo thư mục cần thiết khi chạy. |
| Logo, favicon, liên kết quảng bá và hướng dẫn mang nhận diện của bản cũ | Thay bằng thương hiệu và tài liệu Fabuloki. Giữ thông báo quyền tác giả gốc theo giấy phép. |
| Các MP4 motion Quizzy, ảnh và video mẫu kho hiệu ứng, clip Monolith và toàn bộ âm thanh mẫu cũ | Chưa có bằng chứng quyền phân phối cho các media đó trong gói nhận được. Quizzy và kho hiệu ứng dùng mô tả cùng ID gốc, phong cách dùng minh họa đồ họa, kho âm thanh có sáu WAV tổng hợp mới. Các preview video cũ vắng mặt. |
| Gateway phiên web ChatGPT, gateway cookie Gemini và bộ gỡ watermark đi kèm | Đây là đường tạo ảnh tùy chọn phụ thuộc cookie hoặc token phiên tài khoản. Luồng tạo ảnh giữ Gemini API và tải ảnh lên. |
| Tài liệu kế hoạch cũ, hướng dẫn khởi động cũ và tài liệu bao bì portable | Yêu cầu đang dùng nằm trong SPEC và hướng dẫn khởi động nằm trong README. |
| Comment mô tả, lịch sử triển khai và ví dụ comment trong mã nguồn | Chuẩn PCC yêu cầu đưa quy tắc kiểm được về SPEC, test hoặc kiểu dữ liệu. Thông báo giấy phép và chỉ thị kỹ thuật bắt buộc được giữ khi cần. |
