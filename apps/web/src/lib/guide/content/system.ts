import type { GuideContent } from "@/lib/guide/types";

type Ids = "queue" | "config" | "connections" | "phone-upload" | "troubleshooting";

export const vi: Pick<GuideContent, Ids> = {
  queue: {
    title: "Render Queue",
    summary:
      "Nơi theo dõi mọi job render và xử lý của hệ thống: đang chờ, đang chạy, đã xong hay bị lỗi, kèm tiến độ và log đầy đủ. Mọi lần render, kể cả do AI tự chạy, đều đi qua hàng đợi này.",
    blocks: [
      {
        heading: "Các loại job",
        bullets: [
          "**Scene draft** / **Scene final** - render một scene HyperFrames (chữ chuyển động, phụ đề karaoke, đồ họa) thành MP4.",
          "**Lắp ráp draft** / **Lắp ráp final** - Remotion ghép các scene, footage, giọng đọc, sound effect và nhạc thành video hoàn chỉnh.",
          "**Tạo ảnh** - dựng ảnh của Images Project.",
          "**Cắt tự động** - chia một video dài thành nhiều project con (trang Auto cut videos).",
          "**Cắt tự động (đo)** - đo và cắt khoảng lặng, từ đệm, đoạn quay hỏng khỏi footage trước khi dựng.",
          "**Text to video** và **Dịch video** - các phiên của hai trang cùng tên.",
        ],
      },
      {
        heading: "Đọc bảng job",
        paragraphs: [
          "Bảng hiện 50 job gần nhất và tự cập nhật theo thời gian thực, không cần tải lại trang. Cột **Tiến độ** có thanh phần trăm kèm bước đang làm khi job đang chạy.",
          "Cột **Thời gian** là thời lượng job đã chạy; rê chuột vào để xem job được tạo lúc nào.",
        ],
        bullets: [
          "**Chờ** - đã xếp hàng, đợi tới lượt.",
          "**Đang chạy** - đang render, xem phần trăm ở cột **Tiến độ**.",
          "**Hoàn thành** - xong, file đã được ghi ra.",
          "**Lỗi** - dừng giữa chừng, bấm vào dòng đó để đọc log.",
          "**Đã hủy** - bạn đã tự hủy job này.",
        ],
      },
      {
        heading: "Lọc và tìm job",
        bullets: [
          "Các chip **Tất cả**, **Chờ**, **Đang chạy**, **Hoàn thành**, **Lỗi** lọc theo trạng thái và hiện sẵn số job mỗi loại. Chọn được nhiều chip cùng lúc.",
          "Job **Đã hủy** không có chip riêng - bấm **Tất cả** để thấy chúng.",
          "Ô tìm kiếm lọc theo tên project, tên scene hoặc id job.",
        ],
      },
      {
        heading: "Xem log của một job",
        steps: [
          "Bấm vào một dòng bất kỳ trong bảng.",
          "Khung **Log - <id job>** mở ra bên dưới, kèm trạng thái và thanh tiến độ của job đó.",
          "Log mới tự chảy xuống cuối; kéo lên đọc dòng cũ thì khung đứng yên cho bạn đọc.",
          "Bấm nút **Đóng log** ở góc khung khi xem xong.",
        ],
        tip: "Job bị **Lỗi** thì lý do thường nằm ở mấy dòng cuối cùng của log - đọc từ dưới lên trước.",
      },
      {
        heading: "Hủy và chạy lại",
        paragraphs: [
          "Job đang **Chờ** hoặc **Đang chạy** có nút **Hủy** ở cuối dòng. Hủy giữa chừng thì bản render dở bị bỏ, lần sau phải chạy lại từ đầu.",
          "Hàng đợi không có nút chạy lại. Muốn chạy lại thì vào trang project: **Render scene draft** và **Lắp ráp draft** nằm trong menu **Xem thêm**, còn **Render final** là nút riêng.",
          "Một lượt render gồm nhiều job nối nhau (ví dụ scene final rồi lắp ráp final): job đi trước lỗi thì job đi sau cũng báo **Lỗi** và chỉ đích danh job hỏng, để không lắp ra video bằng bản render cũ.",
        ],
      },
      {
        heading: "Bao nhiêu job chạy cùng lúc",
        paragraphs: [
          "Số job chạy song song đặt ở **Job render đồng thời (queue)** trong trang **Cấu hình**, từ 1 đến 4, mặc định là 2. Đổi là có hiệu lực ngay.",
          "Hai job của CÙNG một project không bao giờ chạy đồng thời, để khỏi ghi đè file của nhau - job sau sẽ đợi job trước xong. Song song chỉ xảy ra giữa các project khác nhau.",
        ],
        tip: "Máy yếu hoặc render hay chết giữa chừng thì để **Job render đồng thời (queue)** ở mức 1.",
      },
      {
        heading: "Luật draft trước, final sau",
        paragraphs: [
          "Hệ thống từ chối mọi job final khi project chưa có một lần **Lắp ráp draft** thành công. Draft render nhanh và rẻ, nên lỗi phải được bắt ở đó chứ không phải ở bản final chạy hàng chục phút.",
          "Ngoài ra, khi công tắc **Chặn render final khi QC chưa đạt** đang bật (mặc định), **Lắp ráp final** bị từ chối nếu bản draft chưa chạy QC, kết quả QC đã cũ, hoặc còn hạng mục không đạt.",
        ],
        steps: [
          "Render bản draft toàn bài và xem lại trên trang project.",
          "Trong card **QC tự động**, bấm **Chạy QC** (hoặc **Đo lại** nếu đã render lại).",
          "Sửa các hạng mục **Không đạt**, render draft và QC lại cho tới khi đạt.",
          "Bấm **Render final** - video thành phẩm được ghi vào thư mục outputs/.",
        ],
      },
      {
        warning:
          "Tắt hệ thống hoặc khởi động lại server khi còn job thì mọi job đang chạy và đang chờ đều chuyển sang **Lỗi** (bước ghi \"Server khởi động lại khi job đang chạy\"). Chờ hàng đợi trống rồi hãy tắt, hoặc chạy lại các job đó sau.",
      },
    ],
  },

  config: {
    title: "Cấu hình",
    summary: "Kiểm tra môi trường và điều chỉnh hàng đợi dựng.",
    blocks: [{heading: "Chạy trên máy", bullets: ["Kiểm tra Node.js, FFmpeg và Chrome ở Cấu hình.", "Nếu cần nhận dạng lời hoặc giọng đọc ngoại tuyến, mở mục cài Python tương ứng."]}, {heading: "Khi dựng", bullets: ["Số job đồng thời quyết định số project chạy cùng lúc.", "Bản cuối có thể chờ kết quả QC của bản nháp."]}],
  },
  connections: {
    title: "Kết nối",
    summary: "Quản lý nhà cung cấp khi dùng tính năng trực tuyến.",
    blocks: [{heading: "Dịch vụ AI", bullets: ["Thiết lập Claude để viết kịch bản hoặc dựng video.", "Chọn Codex cho phiên dựng khi CLI đã đăng nhập và có danh sách model.", "Dùng khóa Gemini API để tạo ảnh, dịch hoặc đọc lời tùy tính năng.", "Có thể cấu hình Soniox để nhận dạng lời nói." ]}, {heading: "Kết nối điện thoại", paragraphs: ["Mặc định app chỉ lắng nghe trên máy đang chạy. Nếu bạn chủ động mở đường truy cập, chia sẻ đúng mã phiên tải lên."]}],
  },
  "phone-upload": {
    title: "Tải file từ điện thoại",
    summary:
      "Quét mã QR để gửi video và ảnh từ điện thoại thẳng vào một project, không cần cáp hay ứng dụng chuyển file. Cùng WiFi là dùng được ngay; ở xa thì đi qua Cloudflare Tunnel.",
    blocks: [
      {
        heading: "Gửi file khi cùng WiFi",
        steps: [
          "Mở trang project, tìm card **Nguồn & Asset** và bấm **Kết nối điện thoại**.",
          "Máy có nhiều mạng thì chọn đúng địa chỉ trong ô **Mạng (IP máy chủ)** - thường là địa chỉ bắt đầu bằng 192.168.",
          "Dùng camera điện thoại quét mã QR. Trang **Tải file vào project** mở ra trên điện thoại.",
          "Bấm **Chọn video / ảnh** để lấy file có sẵn, hoặc **Quay video / chụp ảnh mới** để quay ngay.",
          "File tải xong vào thẳng card **Nguồn & Asset** của project trên máy tính.",
        ],
      },
      {
        heading: "Lần đầu trên Windows",
        paragraphs: [
          "Điện thoại phải cùng WiFi với máy chạy hệ thống. Lần đầu Windows hỏi về tường lửa (firewall) thì chọn **Allow**.",
          "Script khởi động tự mở cổng 6868 và 6869 trên tường lửa nếu được chạy với quyền quản trị.",
        ],
        tip: "Điện thoại không mở được trang: kiểm tra hai máy cùng một WiFi, thử địa chỉ khác trong ô **Mạng (IP máy chủ)**, và xem tường lửa đã cho phép chưa.",
      },
      {
        warning:
          "Giữ màn hình điện thoại sáng khi đang tải file lớn - tắt màn hình là trình duyệt ngừng gửi. Đợi tới khi trang báo tải xong mới khóa máy.",
      },
      {
        heading: "Link chỉ sống khi cửa sổ QR còn mở",
        paragraphs: [
          "Mỗi lần mở cửa sổ **Kết nối điện thoại** là một link mới mang mã riêng. Đóng cửa sổ là link bị khóa ngay, điện thoại sẽ báo \"Link đã hết hạn - mở lại mã QR trên máy tính.\"",
          "Cần gửi tiếp thì mở lại cửa sổ trên máy tính và quét mã mới.",
        ],
      },
      {
        heading: "Gửi qua 4G/5G (không cùng WiFi)",
        steps: [
          "Máy chạy hệ thống cần có cloudflared - cài bằng nút **Cài tự động** ở mục cloudflared trong trang **Cấu hình**.",
          "Trong cửa sổ **Kết nối điện thoại**, bấm **Bật Internet (Cloudflare Tunnel)** ở cuối cửa sổ. Mã QR tự đổi sang link Internet sau vài giây.",
          "Nếu tunnel đã chạy sẵn, bấm **Dùng link Internet** để đổi mã QR sang đường Internet.",
          "Gửi xong bấm **Tắt Internet**, hoặc đóng cửa sổ - tunnel bật từ chính cửa sổ này sẽ tự tắt theo.",
        ],
        tip: "Tunnel bật từ trang **Kết nối** hoặc bằng script thì vẫn chạy sau khi đóng cửa sổ QR, cho tới khi bạn tự tắt.",
      },
      {
        heading: "Quick Tunnel hay domain riêng",
        bullets: [
          "Không khai domain: hệ thống dùng Quick Tunnel với địa chỉ ngẫu nhiên dạng xxx.trycloudflare.com, ĐỔI mỗi lần bật lại.",
          "Muốn địa chỉ cố định: điền domain vào ô **Domain riêng (TUNNEL_DOMAIN)** ở trang **Kết nối**, hoặc thêm TUNNEL_DOMAIN=<domain-của-bạn> vào file .env. Mã QR khi đó dùng https://<domain>/m/<project>.",
          "Domain riêng cần làm trước một lần trên máy: cloudflared tunnel login, create và route dns.",
        ],
      },
      {
        heading: "Mở tunnel bằng script",
        bullets: [
          "Windows: nhấp đúp start\\tunnel.bat",
          "macOS: nhấp đúp start/tunnel.command",
          "Linux: chạy ./start/tunnel.sh",
        ],
        paragraphs: [
          "Có TUNNEL_DOMAIN trong .env thì script chạy tunnel theo domain đó, không có thì chạy Quick Tunnel.",
        ],
      },
      {
        warning:
          "Dashboard chưa có đăng nhập: ai có link tunnel là vào được toàn bộ dashboard. Không bao giờ chia sẻ link công khai, chỉ mở public khi đã bọc thêm Cloudflare Access, và tắt tunnel ngay khi dùng xong.",
      },
    ],
  },

  troubleshooting: {
    title: "Xử lý sự cố",
    summary:
      "Các lỗi hay gặp và cách xử lý: khởi động, dừng, cập nhật hệ thống, thiếu công cụ, render lỗi, mất dấu tiếng Việt và phiên AI bị gián đoạn.",
    blocks: [
      {
        heading: "Khởi động, dừng và cập nhật",
        bullets: [
          "Khởi động - Windows: start\\start.bat · macOS: start/start.command · Linux: ./start/start.sh",
          "Dừng - Windows: start\\stop.bat (hoặc đóng cửa sổ \"Fabuloki - LOG\") · macOS: start/stop.command · Linux: ./start/stop.sh",
        ],
        paragraphs: [
          "Script khởi động tự kiểm tra máy, cài gói lần đầu, build, tạo file .env, chạy hệ thống rồi mở http://127.0.0.1:6868. Hệ thống đang chạy sẵn thì script chỉ mở lại trình duyệt; chạy dở dang thì nó tự dọn và khởi động lại.",
          "Bình thường bạn không cần script cập nhật - chip cập nhật ở cuối thanh bên trái làm việc đó. Chỉ dùng script khi giao diện không mở được.",
        ],
      },
      {
        heading: "macOS chặn file hoặc file không chạy",
        bullets: [
          "macOS báo file đến từ nhà phát triển không xác định: chuột phải vào file → **Open** → **Open**.",
          "File .sh không nhấp đúp được trên macOS - hãy dùng file .command.",
          "Trên macOS và Linux, log của hệ thống nằm ở start/server.log; trên Windows là cửa sổ \"Fabuloki - LOG\".",
        ],
      },
      {
        heading: "Chấm trạng thái backend trên thanh trên cùng",
        bullets: [
          "Chấm xanh, **Backend hoạt động** - mọi thứ bình thường.",
          "Chấm đỏ, **Không kết nối được backend** - phần xử lý phía sau đã tắt hoặc bị treo. Chạy lại script khởi động; script tự dọn và bật lại.",
        ],
        paragraphs: [
          "Chấm tự kiểm tra lại mỗi 30 giây. Màn hình hẹp chỉ hiện chấm, rê chuột vào để đọc trạng thái.",
        ],
      },
      {
        heading: "Thiếu công cụ hoặc chưa đăng nhập Claude",
        steps: [
          "Mở **Cấu hình** và xem card **Kiểm tra hệ thống**. Mục bắt buộc thiếu sẽ có badge đỏ và đứng đầu danh sách.",
          "Bấm **Cài tự động** với FFmpeg, Google Chrome, Claude Code; Node.js thì tải ở nodejs.org (cần bản 22 trở lên).",
          "**Đăng nhập Claude** không tự làm thay được: mở terminal, gõ claude rồi /login - hoặc dán ANTHROPIC_API_KEY ở trang **Kết nối**.",
          "Bấm **Kiểm tra lại**. Muốn làm từ terminal thì chạy node start/doctor.mjs --fix ở thư mục gốc.",
        ],
        tip: "Thiếu công cụ không chặn hệ thống khởi động - dashboard vẫn lên để bạn sửa ngay trên giao diện.",
      },
      {
        heading: "Python quá cũ hoặc quá mới",
        paragraphs: [
        ],
        bullets: [
          "macOS: chạy brew install python@3.13. Python 3.9 có sẵn của macOS quá cũ, còn brew install python có thể ra bản quá mới.",
          "Windows và Linux: tải Python 3.13 tại python.org/downloads.",
          "Cài xong bấm lại **Cài tự động** ở mục đó - môi trường Python cũ dựng bằng bản không hợp lệ sẽ được xóa và dựng lại tự động.",
        ],
      },
      {
        heading: "Render bị lỗi",
        steps: [
          "Mở **Render Queue**, bấm chip **Lỗi** rồi bấm vào job hỏng để đọc log - lý do thường nằm ở mấy dòng cuối.",
          "Sửa nguyên nhân (thiếu file, scene lỗi...) hoặc nhờ AI sửa trong khung chat của project.",
          "Chạy lại bản draft từ trang project (**Render scene draft** hoặc **Lắp ráp draft** trong menu **Xem thêm**), xem lại rồi mới render final.",
        ],
        bullets: [
          "Job final bị từ chối ngay: project chưa có **Lắp ráp draft** thành công, hoặc QC chưa chạy / chưa đạt trên bản draft hiện tại.",
          "Render hay đứng hoặc chết giữa chừng: trong **Cấu hình** hạ **Worker Chrome (HyperFrames)** và **Remotion concurrency** về mốc có ★, đặt **Job render đồng thời (queue)** về 1, hoặc tắt **GPU cho capture (browser)**.",
          "Job báo \"Server khởi động lại khi job đang chạy\": hệ thống bị tắt giữa chừng - chỉ cần chạy lại.",
        ],
      },
      {
        heading: "Chữ tiếng Việt bị mất dấu hoặc lệch dấu",
        bullets: [
          "Dùng font có trong Style Design: gõ tên font Google Fonts là hệ thống tự tải bản đủ bộ dấu tiếng Việt. Font lạ máy không có thì trình duyệt thay font khác, và thứ vỡ đầu tiên luôn là dấu.",
          "Thấy lỗi trong bản draft: ở card **Duyệt bản draft**, ghim ghi chú đúng giây bị lỗi (ví dụ \"chữ ở 00:12 bị cụt dấu\") rồi bấm **Gửi cho AI sửa**. AI đã có sẵn cách sửa lỗi chữ gradient mất dấu trong skill.",
          "Sau khi sửa, render lại bản draft và soi kỹ chỗ đó trước khi render final.",
        ],
      },
      {
        heading: "Phiên AI bị gián đoạn",
        paragraphs: [
          "Phiên AI bị ngắt (server khởi động lại, lỗi mạng...) hiện trạng thái **Tạm dừng**. Khi công tắc **Tự chạy tiếp** trong khung chat đang bật, phiên tự chạy tiếp khoảng 15 giây sau khi hệ thống lên lại, hoặc vài giây sau khi gặp lỗi.",
          "Phiên tự dừng hẳn nếu chạy lại nhiều lần liên tiếp mà không có tiến bộ (phiên dựng video theo **Số lần AI được tự làm lại một video** trong **Cấu hình**, phiên chat thường 3 lần). Khi đó gửi một tin nhắn để AI làm tiếp.",
        ],
      },
      {
        heading: "Video thành phẩm nằm ở đâu",
        bullets: [
          "Mọi video lắp ráp nằm trong thư mục outputs/ ở thư mục gốc của dự án.",
          "Bản draft: outputs/<tên-project>-draft.mp4 - mỗi lần render draft sẽ ghi đè bản trước.",
          "Bản final: outputs/<tên-project>-v1.mp4, -v2.mp4... - mỗi lần render final thêm một phiên bản mới, không ghi đè.",
          "Cũng xem và tải được ngay trên trang project hoặc trang **Assets**.",
        ],
      },
      {
        heading: "Dùng chung công cụ giữa nhiều bản cài",
        paragraphs: [
        ],
        steps: [
          "Thêm dòng FABULOKI_RUNTIME_DIR=<đường-dẫn> vào file .env của TỪNG bản cài (đường dẫn tuyệt đối, hoặc tương đối tính từ thư mục gốc).",
          "Cách đơn giản nhất: trỏ thẳng vào .runtime của bản đang chạy, ví dụ FABULOKI_RUNTIME_DIR=D:\\AIEV\\.runtime - không phải chuyển gì, chỉ đừng xóa bản cũ.",
        ],
        warning:
          "Không chạy hai bản cài cùng lúc trên một .runtime. Giọng đã nhân bản nằm ở assets/voices/, không đi theo .runtime - chép thư mục đó sang bằng tay.",
      },
      {
        heading: "Cập nhật không xong",
        paragraphs: [
          "Cửa sổ báo **Cập nhật chưa hoàn tất** thì bản cũ vẫn chạy bình thường, vì script tải code mới trước rồi mới tắt hệ thống. Log đầy đủ ở start/update.log.",
          "Báo \"Đang có job render - chờ xong rồi cập nhật.\": chờ Render Queue trống (không còn job **Đang chạy** hay **Chờ**) rồi bấm lại.",
        ],
      },
    ],
  },
};

export const en: Pick<GuideContent, Ids> = {
  queue: {
    title: "Render Queue",
    summary:
      "Track every render and processing job in the system - waiting, running, finished or failed - with live progress and the full log. Every render goes through this queue, including the ones the AI starts on its own.",
    blocks: [
      {
        heading: "Job types",
        bullets: [
          "**Scene draft** / **Scene final** - renders one HyperFrames scene (kinetic text, karaoke subtitles, motion graphics) to MP4.",
          "**Assemble draft** / **Assemble final** - Remotion stitches the scenes, footage, voice, sound effects and music into the finished video.",
          "**Image generation** - builds an Images Project image.",
          "**Auto cut** - splits a long video into several child projects (the Auto cut videos page).",
          "**Auto-trim** - measures and removes silences, fillers and bad takes from the footage before editing.",
          "**Text to video** and **Translate video** - sessions from the pages of the same name.",
        ],
      },
      {
        heading: "Reading the job table",
        paragraphs: [
          "The table shows the 50 most recent jobs and updates live, no reload needed. While a job runs, the **Progress** column shows a percentage bar plus the current step.",
          "The **Time** column is how long the job ran; hover it to see when the job was created.",
        ],
        bullets: [
          "**Queued** - waiting for its turn.",
          "**Running** - rendering now; watch the **Progress** column.",
          "**Done** - finished and the file has been written.",
          "**Failed** - stopped partway; click the row to read the log.",
          "**Canceled** - you canceled it yourself.",
        ],
      },
      {
        heading: "Filtering and searching",
        bullets: [
          "The **All**, **Queued**, **Running**, **Done** and **Failed** chips filter by status and show how many jobs are in each. You can pick several at once.",
          "**Canceled** jobs have no chip of their own - click **All** to see them.",
          "The search box matches project name, scene name or job id.",
        ],
      },
      {
        heading: "Reading a job's log",
        steps: [
          "Click any row in the table.",
          "A **Log - <job id>** panel opens below, with that job's status and progress bar.",
          "New lines scroll in at the bottom; scroll up to read older lines and the panel stays put.",
          "Click **Close log** in the panel corner when you are done.",
        ],
        tip: "When a job is **Failed**, the reason is usually in the last few lines - read the log from the bottom up.",
      },
      {
        heading: "Canceling and running again",
        paragraphs: [
          "**Queued** and **Running** jobs have a **Cancel** button at the end of the row. Cancel midway and the partial render is thrown away, so the next run starts from scratch.",
          "There is no retry button in the queue. To run something again, go to the project page: **Render scene draft** and **Assemble draft** are in the **More** menu, and **Render final** has its own button.",
          "Some renders are a chain of jobs (for example a scene final followed by an assemble final). If an earlier job fails, the later one is marked **Failed** too and names the job that broke, so you never get a video assembled from stale renders.",
        ],
      },
      {
        heading: "How many jobs run at once",
        paragraphs: [
          "**Concurrent render jobs (queue)** on the **Settings** page sets how many jobs run in parallel - 1 to 4, default 2. Changes apply immediately.",
          "Two jobs of the SAME project never run at the same time, so they cannot overwrite each other's files - the second one waits. Parallel runs only happen across different projects.",
        ],
        tip: "On a slow machine, or if renders keep dying halfway, set **Concurrent render jobs (queue)** to 1.",
      },
      {
        heading: "Draft first, final second",
        paragraphs: [
          "Any final job is refused until the project has at least one successful **Assemble draft**. Drafts are quick and cheap, so problems should be caught there - not in a final that takes tens of minutes.",
          "On top of that, while **Block the final render while QC has not passed** is on (the default), **Assemble final** is refused if the current draft has not been through QC, the QC result is out of date, or any check failed.",
        ],
        steps: [
          "Render the full draft and watch it on the project page.",
          "In the **Automatic QC** card, click **Run QC** (or **Re-run** after a new render).",
          "Fix anything that failed, render the draft and run QC again until it passes.",
          "Click **Render final** - the finished video is written to the outputs/ folder.",
        ],
      },
      {
        warning:
          "If you stop the system or the server restarts while jobs are in the queue, every running and queued job is marked **Failed** (the step reads that the server restarted). Wait until the queue is empty before shutting down, or run those jobs again afterwards.",
      },
    ],
  },

  config: {
    title: "Settings",
    summary: "Check the environment and adjust rendering.",
    blocks: [{heading: "Local environment", bullets: ["Check Node.js, FFmpeg and Chrome in Settings.", "Set up Python for local speech recognition or voices when needed."]}, {heading: "Rendering", bullets: ["Queue concurrency controls the number of projects rendered at once.", "Final exports can require a successful draft quality check."]}],
  },
  connections: {
    title: "Connections",
    summary: "Manage providers for online features.",
    blocks: [{heading: "AI providers", bullets: ["Set up Claude for script writing or editing.", "Select Codex for editing when the CLI is signed in and lists models.", "Use a Gemini API key for images, translation or narration as applicable.", "You can configure Soniox for transcription."]}, {heading: "Phone uploads", paragraphs: ["The app listens on the local machine by default. When you enable remote access, share only the scoped upload session code."]}],
  },
  "phone-upload": {
    title: "Upload from your phone",
    summary:
      "Scan a QR code to send videos and photos from your phone straight into a project - no cable or transfer app. It works right away on the same Wi-Fi, and through a Cloudflare Tunnel when you are elsewhere.",
    blocks: [
      {
        heading: "Sending files on the same Wi-Fi",
        steps: [
          "Open the project page, find the **Sources & Assets** card and click **Connect phone**.",
          "If the machine has several networks, pick the right address under **Network (server IP)** - usually the one starting with 192.168.",
          "Scan the QR code with your phone camera. The **Upload files to project** page opens on the phone.",
          "Tap **Choose videos / photos** for existing files, or **Record video / take photo** to shoot something new.",
          "Uploaded files go straight into the project's **Sources & Assets** card on the computer.",
        ],
      },
      {
        heading: "The first time on Windows",
        paragraphs: [
          "The phone must be on the same Wi-Fi as the machine running the system. The first time, Windows asks about the firewall - choose **Allow**.",
          "When the start script runs with administrator rights, it opens ports 6868 and 6869 in the firewall by itself.",
        ],
        tip: "If the phone cannot open the page: make sure both are on the same Wi-Fi, try another address under **Network (server IP)**, and check that the firewall allowed it.",
      },
      {
        warning:
          "Keep the phone's screen on while uploading large files - once the screen turns off, the browser stops sending. Wait until the page says the upload is finished before locking the phone.",
      },
      {
        heading: "The link only lives while the QR window is open",
        paragraphs: [
          "Every time you open **Connect phone** you get a new link with its own token. Close the window and the link is locked at once; the phone then says \"The link has expired - reopen the QR code on the computer.\"",
          "To send more, reopen the window on the computer and scan the new code.",
        ],
      },
      {
        heading: "Sending over 4G/5G (not on the same Wi-Fi)",
        steps: [
          "The machine running the system needs cloudflared - install it with the **Install** button on the cloudflared row in **Settings**.",
          "In the **Connect phone** window, click **Turn on Internet (Cloudflare Tunnel)** at the bottom. After a few seconds the QR code switches to the Internet link.",
          "If a tunnel is already running, click **Use the Internet link** to switch the QR code over.",
          "When you are done, click **Turn off Internet**, or just close the window - a tunnel started from this window stops with it.",
        ],
        tip: "A tunnel started from **Connections** or from the tunnel script keeps running after you close the QR window, until you stop it yourself.",
      },
      {
        heading: "Quick Tunnel or your own domain",
        bullets: [
          "No domain set: the system uses a Quick Tunnel with a random xxx.trycloudflare.com address that CHANGES every time it starts.",
          "For a fixed address: enter your domain in **Custom domain (TUNNEL_DOMAIN)** on **Connections**, or add TUNNEL_DOMAIN=<your-domain> to the .env file. The QR code then uses https://<domain>/m/<project>.",
          "A custom domain needs a one-time setup on the machine: cloudflared tunnel login, create and route dns.",
        ],
      },
      {
        heading: "Starting the tunnel with a script",
        bullets: [
          "Windows: double-click start\\tunnel.bat",
          "macOS: double-click start/tunnel.command",
          "Linux: run ./start/tunnel.sh",
        ],
        paragraphs: [
          "With TUNNEL_DOMAIN in .env the script runs a tunnel for that domain; without it, a Quick Tunnel.",
        ],
      },
      {
        warning:
          "The dashboard has no login: anyone with the tunnel link can open the whole dashboard. Never share the link publicly, only expose it behind Cloudflare Access, and stop the tunnel as soon as you are done.",
      },
    ],
  },

  troubleshooting: {
    title: "Troubleshooting",
    summary:
      "Common problems and how to fix them: starting, stopping and updating, missing tools, failed renders, missing Vietnamese diacritics and interrupted AI sessions.",
    blocks: [
      {
        heading: "Starting, stopping and updating",
        bullets: [
          "Start - Windows: start\\start.bat · macOS: start/start.command · Linux: ./start/start.sh",
          "Stop - Windows: start\\stop.bat (or close the \"Fabuloki - LOG\" window) · macOS: start/stop.command · Linux: ./start/stop.sh",
        ],
        paragraphs: [
          "The start script checks the machine, installs packages on the first run, builds, creates the .env file, starts everything and opens http://127.0.0.1:6868. If the system is already running it just reopens the browser; if it is half-running it cleans up and restarts.",
          "You normally never need the update script - the update chip at the bottom of the left sidebar does it. Use the script only when the dashboard will not open.",
        ],
      },
      {
        heading: "macOS blocks a file, or a file will not run",
        bullets: [
          "macOS says the file is from an unidentified developer: right-click the file → **Open** → **Open**.",
          "A .sh file cannot be double-clicked on macOS - use the .command file instead.",
          "On macOS and Linux the system log is start/server.log; on Windows it is the \"Fabuloki - LOG\" window.",
        ],
      },
      {
        heading: "The backend status dot in the top bar",
        bullets: [
          "Green, **Backend online** - all good.",
          "Red, **Cannot reach backend** - the processing side has stopped or hung. Run the start script again; it cleans up and restarts it.",
        ],
        paragraphs: [
          "The dot re-checks every 30 seconds. On narrow screens only the dot shows - hover it to read the status.",
        ],
      },
      {
        heading: "Missing tools or not signed in to Claude",
        steps: [
          "Open **Settings** and look at the **System check** card. Missing required items get a red badge and sit at the top of the list.",
          "Click **Install** for FFmpeg, Google Chrome or Claude Code; get Node.js from nodejs.org (version 22 or later).",
          "**Claude login** cannot be done for you: open a terminal, type claude, then /login - or paste ANTHROPIC_API_KEY on the **Connections** page.",
          "Click **Check again**. From a terminal you can run node start/doctor.mjs --fix in the root folder instead.",
        ],
        tip: "Missing tools never block startup - the dashboard still comes up so you can fix things from the UI.",
      },
      {
        heading: "Python too old or too new",
        paragraphs: [
        ],
        bullets: [
          "macOS: run brew install python@3.13. The built-in Python 3.9 is too old, and brew install python may give you one that is too new.",
          "Windows and Linux: download Python 3.13 from python.org/downloads.",
          "Then click **Install** on that row again - an environment built with an unsupported Python is deleted and rebuilt automatically.",
        ],
      },
      {
        heading: "A render failed",
        steps: [
          "Open **Render Queue**, click the **Failed** chip, then click the broken job to read its log - the reason is usually in the last lines.",
          "Fix the cause (a missing file, a broken scene...) or ask the AI to fix it in the project's chat.",
          "Run the draft again from the project page (**Render scene draft** or **Assemble draft** in the **More** menu), check it, and only then render the final.",
        ],
        bullets: [
          "A final job is refused straight away: the project has no successful **Assemble draft** yet, or QC has not run or not passed on the current draft.",
          "Renders stall or die halfway: in **Settings**, lower **Chrome workers (HyperFrames)** and **Remotion concurrency** to the ★ values, set **Concurrent render jobs (queue)** to 1, or turn off **GPU for capture (browser)**.",
          "The job says the server restarted while it was running: the system was shut down mid-job - just run it again.",
        ],
      },
      {
        heading: "Vietnamese text loses its diacritics",
        bullets: [
          "Use fonts from Style Design: type a Google Fonts name and the system downloads the full Vietnamese character set. A font the machine does not have gets silently swapped, and the diacritics are always the first thing to break.",
          "If a draft shows the problem: in the **Review draft** card, pin a note at the exact second (for example \"diacritics cut off at 00:12\") and click **Send to AI**. The AI's skills already include the fix for gradient text dropping diacritics.",
          "After the fix, render the draft again and check that spot closely before the final.",
        ],
      },
      {
        heading: "An AI session was interrupted",
        paragraphs: [
          "A session that gets cut off (server restart, network error...) shows as **Paused**. With the **Auto-resume** switch on in the chat panel, it picks up again about 15 seconds after the system comes back, or a few seconds after an error.",
          "It gives up after several runs in a row with no progress (video edit sessions follow **How many times the AI may redo a video** in **Settings**, ordinary chats stop after 3). Then just send a message and the AI carries on.",
        ],
      },
      {
        heading: "Where finished videos go",
        bullets: [
          "Every assembled video is saved in the outputs/ folder at the project root.",
          "Draft: outputs/<project-name>-draft.mp4 - each new draft overwrites the previous one.",
          "Final: outputs/<project-name>-v1.mp4, -v2.mp4... - each final render adds a new version and never overwrites.",
          "You can also watch and download them on the project page or the **Assets** page.",
        ],
      },
      {
        heading: "Sharing installed tools between several copies",
        paragraphs: [
        ],
        steps: [
          "Add FABULOKI_RUNTIME_DIR=<path> to the .env file of EACH copy (an absolute path, or relative to the root folder).",
          "Simplest: point straight at the .runtime of the copy you already run, for example FABULOKI_RUNTIME_DIR=D:\\AIEV\\.runtime - nothing moves, just don't delete the old copy.",
        ],
        warning:
          "Never run two copies at the same time on one .runtime. Cloned voices live in assets/voices/, not in .runtime - copy that folder across by hand.",
      },
      {
        heading: "An update did not finish",
        paragraphs: [
          "If the window says **The update did not finish**, the old version is still running normally - the script downloads the new code before stopping anything. The full log is in start/update.log.",
          "\"A render job is running - wait for it to finish, then update.\": wait until the Render Queue is empty (nothing **Running** or **Queued**) and try again.",
        ],
      },
    ],
  },
};
