# Nguồn và giấy phép

## Mã nguồn

- **AIEVv2** là dự án gốc của noti.vn. Bản đối chiếu sử dụng [mốc b11efbd](https://github.com/notivn/AIEVv2/commit/b11efbdf9ce007100701eca69ae7127e7da51e56). [Giấy phép tại mốc đối chiếu](https://github.com/notivn/AIEVv2/blob/b11efbdf9ce007100701eca69ae7127e7da51e56/LICENSE).
- **Bisedit 2.0.1** là bản trung gian được dùng khi chuyển mã sang Fabuloki. Gói Bisedit có `LICENSE` MIT mang thông báo `Copyright (c) 2026 noti.vn` và trường `license` là `MIT` trong `package.json`.
- **Fabuloki** phát triển từ gói Bisedit. Bản sao [LICENSE](LICENSE) giữ nguyên thông báo bản quyền và điều khoản MIT của AIEVv2. Xem [phạm vi chuyển mã và tài sản](docs/SOURCE-MIGRATION.md).

## Tài sản và thư viện

- **Logo Fabuloki** là biểu tượng của dự án. Danh mục logo bên thứ ba đi kèm bắt đầu trống. Xem [quyền sử dụng logo tải vào](assets/brand-logos/README.md).
- **Biểu tượng ngôn ngữ** dùng hai SVG được giữ nguyên từ [AIEVv2](https://github.com/notivn/AIEVv2/tree/b11efbdf9ce007100701eca69ae7127e7da51e56/apps/web/public/flags).
- **Font Inter** dùng trong giao diện và bản xuất theo [SIL Open Font License](engines/remotion/public/fonts/OFL.txt).
- **Hiệu ứng âm thanh** gồm sáu WAV tổng hợp cho Fabuloki. Nguồn nằm trong [danh mục hiệu ứng](assets/sound-effects/library.json).
- **Ảnh README** được chụp từ Fabuloki trên Windows với clip minh họa tạo bằng FFmpeg cho bài hướng dẫn. [Ảnh giao diện](docs/media/fabuloki-auto-cut.png).
- **Remotion và các thư viện phụ thuộc** có giấy phép riêng. Phiên bản sử dụng được ghi trong [tệp khóa phụ thuộc](package-lock.json). Xem [điều khoản Remotion](https://www.remotion.dev/docs/license) nếu sử dụng hoặc đóng gói bản phân phối.
