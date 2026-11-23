# API cục bộ

API chạy tại `http://127.0.0.1:6869` theo cấu hình mặc định. Đường gọi từ máy khác cần thông tin xác thực theo [middleware](../apps/server/src/index.ts).

| Thao tác | Endpoint | Tham chiếu |
| --- | --- | --- |
| Tạo và đọc dự án | `POST /api/projects`, `GET /api/projects/:id` | [Dự án](../apps/server/src/routes/projects.ts) |
| Đọc, lưu timeline và yêu cầu dựng | `GET /api/projects/:id/timeline`, `PUT /api/projects/:id/timeline`, `POST /api/projects/:id/editor/render` với `quality: "draft"` hoặc `"final"` | [Timeline](../apps/server/src/routes/timeline.ts) |
| Đọc công việc đã xếp | `GET /api/jobs/:id` | [Hàng đợi](../apps/server/src/routes/jobs.ts) |
| Kiểm tra video | `POST /api/projects/:id/qc`; có thể gửi `file` theo đường dẫn tương đối của repo | [QC](../apps/server/src/routes/qc.ts) |
| Yêu cầu ảnh theo brief | `POST /api/illustrations` | [Ảnh dự án](../apps/server/src/routes/illustrations.ts) |
| Tra hoặc tải logo có nguồn | `POST /api/brand-logos` | [Logo](../apps/server/src/routes/brandLogos.ts) |

Dùng schema và điều kiện của từng route làm nguồn khi ghép payload. Xem [SPEC](SPEC.md) cho quy trình nháp, QC và final.
