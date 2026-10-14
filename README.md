# Tic Tac Toe Online (2 người)

Web game tic tac toe realtime 2 người: **tài khoản → lobby → link mời → pre-move → camera tự di chuyển**.
Toàn bộ UI tiếng Việt. Đặc tả luật chơi và giao thức nằm trong [`PROJECT_SPEC.md`](./PROJECT_SPEC.md).

## Yêu cầu

- Node.js ≥ 22.5 (khuyến nghị 24 — dùng `node:sqlite`-free store nên chạy được trên mọi bản)
- Không cần Docker hay database server

## Cài đặt & chạy

```bash
npm install          # cài dependencies cho cả monorepo
npm run build        # build engine + web + server
npm start            # chạy production tại http://localhost:4000
```

Chạy ở chế độ phát triển (server 4000 + Vite 5173, có hot reload):

```bash
npm run dev          # mở http://localhost:5173
```

Kiểm thử:

```bash
npm test             # 99 test engine + 10 test camera web + 33 test end-to-end server
npm run typecheck    # TypeScript cả 3 package
npm run smoke        # kiểm tra tổng thể hệ thống đang chạy (cần server đã bật ở :4000)
```

> `npm start` sẽ báo `EADDRINUSE` nếu còn server cũ đang chiếm cổng 4000. Đóng cửa sổ
> terminal chạy server trước, hoặc Windows: `netstat -ano | findstr :4000` → `taskkill /PID <pid> /F`.

## Cách chơi thử với 2 người

Cần **2 trình duyệt** (hoặc 1 cửa sổ ẩn danh + 1 cửa sổ thường) để có 2 cookie khác nhau.

1. Tab 1: đăng ký tài khoản → **Tạo phòng mới** → chọn chế độ → copy link mời.
2. Tab 2: mở link mời → nếu chưa đăng nhập sẽ bị đẩy sang `/login?next=...` → đăng ký/đăng nhập → tự quay lại đúng phòng.
3. Chủ phòng: **Bắt đầu ván** → đếm ngược 10 giây → ván đầu chọn ngẫu nhiên người đi trước, các ván sau người thua ván trước được đi trước.
4. Camera tự bay tới nước đi mới nhất của bất kỳ ai.

## Chế độ chơi

| Chế độ | Bàn cờ | Thắng khi | Cách đặt quân |
| --- | --- | --- | --- |
| Thắng 3 | 3×3 | 3 quân liền kề | tự do trong bàn |
| Thắng 4 | 6×6 | 4 quân liền kề | tự do trong bàn |
| Thắng 5 | không giới hạn ô | 5 quân liền kề | **bất kỳ ô trống nào**, không yêu cầu kề quân cũ |

Bàn hữu hạn đầy mà không ai thắng → hoà. Chế độ Thắng 5 không thể hoà.

## Chơi lại

Sau mỗi ván, chọn lại chế độ ở phần kết quả rồi bấm chơi lại. Chơi với bot sẽ tự bắt đầu countdown;
chơi với người sẽ gửi lời mời kèm chế độ đã chọn, đối thủ phải chấp nhận hoặc từ chối.

## Pre-move (đánh trước)

Bấm nút **Đánh trước** (hoặc phím `Cách`) rồi bấm các ô trên bàn để xếp tối đa 3 nước.
Khi đến lượt, server tự đánh nước đầu tiên sau 5 giây. Nếu ô đó đã bị đối thủ chiếm thì **nước đi bị huỷ**
(không tự dời quân) và có thông báo cho người chơi.

## Tài khoản quản trị (admin)

- Khi khởi động lần đầu, server **tự tạo tài khoản `admin`** (mật khẩu mặc định `123`, đổi được ngay).
  Muốn đặt mật khẩu khác lúc tạo: `ADMIN_PASSWORD=matkhaucuatoi npm start`.
- **Đổi mật khẩu**: trong **Hồ sơ** (mọi tài khoản) hoặc do chính admin đặt lại cho người khác trong khu vực quản trị.
  Đổi mật khẩu sẽ huỷ **toàn bộ phiên đang đăng nhập** của tài khoản đó.
- Tên `admin` được reserve — không ai tự đăng ký được tên này.

### Khu vực quản trị `/admin` (chỉ admin)

Tài khoản thường **không thấy** và **không gọi được** các API này (server trả `403`):

| API | Việc |
| --- | --- |
| `GET /api/admin/overview` | Não bot + thống kê hệ thống + nhật ký + **trạng thái job train** |
| `POST /api/admin/train` | Bật **train nền** (trả về ngay, không treo) |
| `POST /api/admin/train/cancel` | Huỷ job train đang chạy |
| `POST /api/admin/bot/reset` | Xoá toàn bộ bài học của bot |
| `GET /api/admin/users` | Danh sách tài khoản + vai trò + số ván |
| `POST /api/admin/users/:id/password` | Đặt lại mật khẩu cho tài khoản khác |

### Train bot chạy nền (không treo server)

Nút **BẮT ĐẦU TRAIN BOT** **trả về ngay** và chạy tiếp trong **worker thread** riêng, nên trong lúc train:

- Server vẫn phản hồi bình thường — ván đang chơi, lobby, timer, nhật ký không bị đứng.
- Thanh tiến độ `x/y ván` và nhật ký cập nhật **mỗi 2 giây** (log ghi lúc bắt đầu và lúc xong kèm thời gian thực tế).
- Có nút **HUỶ TRAIN** để dừng giữa chừng.
- Tối đa **2000 ván / job**; bấm lại khi đang chạy sẽ trả về job hiện tại, không chạy trùng.
- Khi không dùng được worker (chạy bằng `tsx`/vitest), hệ thống tự chuyển sang **chia lô có nhường event loop** — vẫn không treo server.

Nhật ký hệ thống (`apps/server/src/log.ts`) ghi: đăng nhập/đăng ký, đổi mật khẩu, tạo phòng, bắt đầu/kết thúc ván, nước đi của bot, kết quả bot học bài, và các lần truy cập bị từ chối.

## Ẩn thông tin nhạy cảm (chỉ admin thấy)

- **Chỉ tài khoản `admin`** được thấy: não bot, nhật ký hệ thống, danh sách tài khoản, thống kê server, nút train.
- Mọi API quản trị (`/api/admin/*`, `/api/bot`) kiểm tra **2 lớp**: phải đăng nhập (`401`) và phải có `role=admin` (`403`), đồng thời **ghi log** mỗi lần bị từ chối. Gọi lại quá nhiều sẽ bị chặn rate-limit riêng (120/phút).
- **`GET /api/health`** (công khai) chỉ trả `{ ok, time }` — **không** lộ đường dẫn file dữ liệu hay thông tin phiên bản.
- File `data/game.json` (chứa mật khẩu băm, não bot, log ván) **không nằm trong thư mục phục vụ web**; các đường dẫn kiểu `/data/game.json`, `/../data/game.json`, `/src/db.ts` chỉ trả về trang SPA, không lộ dữ liệu.
- **Bundle web không chứa bí mật** của server (không có `JWT_SECRET`, `ADMIN_PASSWORD`, hash mật khẩu) — đã có test quét tự động.
- Mật khẩu lưu bằng **scrypt + salt ngẫu nhiên**; đăng nhập so sánh bằng `timingSafeEqual`; cookie phiên `httpOnly` + `SameSite=Lax`; đổi mật khẩu **huỷ toàn bộ phiên** của tài khoản đó.
- Đăng nhập, đổi mật khẩu, truy cập bị từ chối và mọi thao tác của admin đều được ghi vào nhật ký (admin xem được).

> Lưu ý thẳng thắn: API đăng ký vẫn trả `USERNAME_TAKEN` khi tên đã tồn tại (để UX rõ ràng). Nếu muốn chống dò tên tài khoản hoàn toàn thì đổi thông báo thành chung chung — nói tôi biết là tôi làm.

## Chơi không cần tài khoản (phiên khách)

- Ở màn hình đăng nhập bấm **"Không muốn tạo tài khoản? Vào chơi ngay"** (hoặc vào thẳng `/guest`), nhập một **tên hiển thị 2–16 ký tự** → vào chơi ngay.
- Phiên khách **không có mật khẩu**, tự hết hạn sau **12 giờ** và **không lưu thành tích**; muốn giữ thì bấm **Đăng ký tài khoản**.
- Khách vẫn chơi đầy đủ: tạo phòng, mời bạn, đánh với bot/người, chat, rematch.
- **Không có quyền admin**: mọi API `/api/admin/*` và `/api/bot` trả `403`; không đổi được mật khẩu (`GUEST_NO_PASSWORD`).
- Chống lạm dụng: mỗi IP tạo tối đa **12 phiên/giờ**, tối đa **300 khách** đang hoạt động trên server; tên trùng hoặc tên `admin` bị từ chối; rate-limit riêng 20 lần/phút.
- Hồ sơ của khách luôn trả thống kê rỗng nên giao diện không bị vỡ.

## Chia sẻ cho bạn bè (tạm thời, an toàn) — dùng Tailscale

Máy đã cài sẵn Tailscale nên **không cần mở port, không lộ ra Internet, kết nối có mã hoá**:

1. Một lần duy nhất, mở **PowerShell quyền Administrator** và chạy:
   ```powershell
   New-NetFirewallRule -DisplayName "TicTacToe 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Any
   ```
2. Chạy game: `npm start`.
3. Bạn bè cài Tailscale → bạn **share máy này** (tên `hoanglan-1.tail830799.ts.net`) cho họ trong Tailscale.
4. Họ vào **`http://hoanglan-1.tail830799.ts.net:4000`** (hoặc `http://100.99.214.97:4000`) — người không được bạn cho quyền thì **vào không được**.

### Khi nào muốn public công khai lâu dài
Chuyển sang **Cloudflare Tunnel**: có HTTPS + tên miền riêng, **không cần IP công khai / không cần mở port** nên chạy được cả khi nhà mạng dùng CGNAT (IP `171.251.x.x` của bạn nhiều khả năng là CGNAT nên mở port sẽ không hoạt động). Code hiện tại đã sẵn sàng: chỉ cần chạy `cloudflared tunnel` trỏ về cổng 4000.

## Chế độ chơi với máy (bot)

Bấm **Chơi với máy** ở trang chủ, chọn chế độ + độ khó (Dễ / Vừa / Khó) là vào ván ngay, không cần rủ ai.

Trong phòng, chủ phòng có thể **thêm/gỡ bot** và **đổi độ khó** khi ván chưa bắt đầu.

### Trí tuệ của bot

Bot dùng **negamax + alpha-beta** với:

- **Iterative deepening + giới hạn thời gian**: nghĩ sâu dần, dừng khi hết ngân số (Khó ~700ms, Vừa ~250ms, Dễ ~70ms mỗi nước).
- **Phát hiện thắng chính xác**: nước vừa đánh tạo đủ quân → thắng ngay, không cần tìm hết cây.
- **Sắp xếp nước đi thông minh**: thắng > chặn > tạo đe doạ > fork > gần tâm.
- **Mở rộng theo đe doạ (threat extension)**: ở lá cây vẫn nối tiếp nếu sắp thắng, nên bot nhìn thấy chuỗi chặn ngoài tầm sâu.
- **Đánh giá thế cờ theo đoạn tối đa**, phân biệt **đe doạ không chặn được** (1 đầu trống — rất nặng) với đe doạ thường (2 đầu trống — đối thủ chặn được).
- Trên **bàn 3×3 bot chơi hoàn hảo** (đã đối chiếu với bộ giải minimax tham chiếu: với chơi hoàn hảo hai bên hoà).

Độ khó khác nhau ở độ sâu tìm kiếm, ngân sách thời gian, số nhánh mở ra và tỉ lệ chơi sai có chủ đích (bot *Dễ* cố tình chọn nước kém để người chơi có cơ hội thắng).

### Bot tự học (train bot)

Bot có **não** lưu bài học. Sau **mỗi ván có kết quả** (thắng / thua / hoà):

- **Bot thua** → ghi nhớ những nước *sai* của bot (bỏ lỡ thắng ngay, hoặc để đối thủ thắng ngay ở lượt sau) và ghi nhớ **nước người chơi thắng bot đã đánh** là nước tốt → bot học thói quen của người chơi thắng mình.
- **Bot thắng** → củng cố những nước bot đã đánh.
- Khi bot đến lượt ở một thế đã học, bài học được áp dụng: **tránh nước đã thua**, **ưu tiên nước đã thắng** (nhưng không bao giờ để bài học cũ làm bot bỏ lỡ chiến thuật thắng ngay).
- Thế cờ được **chuẩn hoá theo gốc toạ độ**, nên bài học vẫn dùng được dù ván sau đánh ở vị trí khác.
- **Cấp độ bot tăng dần** (0→15) theo số ván đã đấu, mỗi cấp tăng độ sâu tìm kiếm và giảm tỉ lệ chơi sai. Trang chủ hiển thị cấp độ + số bài học (chỉ admin).

Train ngoại tuyến (bot tự đấu chính nó rồi tự rút kinh nghiệm):

```bash
npm run train -- --games=1200 --tier=classic --level=hard --opponent=normal
npm run train -- --games=120  --tier=big     --level=normal --opponent=easy
npm run train -- --games=60   --tier=infinity --level=normal --opponent=easy
```

Hoặc bấm nút **BẮT ĐẦU TRAIN BOT** ngay trong khu vực quản trị `/admin` (chạy nền, có tiến độ).

Não bot lưu trong `apps/server/data/game.json`, dùng chung cho mọi phòng — train xong là các ván sau bot đọc ngay.
Trạng thái hiện tại: **cấp 15, ~2500 ván tự đấu, ~1900 bài học**.

## Luật đi trước

- Ván đầu tiên của phòng: chọn ngẫu nhiên.
- Từ ván thứ hai: **người thua ván trước được đi trước** (đi quân `X`). Ván trước bị hoà thì giữ nguyên người đi trước.

## Giao diện phong cách truyện tranh (Comic Edition)

- **Phong cách Pop-Art & Manga**: Nền chấm halftone benday dots, viền mực dày 3px, đổ bóng khối cứng 3D xúc giác, kiểu chữ comic Bangers/Impact.
- **Hoạt ảnh chuyển động mượt mà (Juicy Smooth Animations)**: Quân cờ slam-down nảy lò xo, sticker âm thanh hoạt hình (`BAM!`, `POW!`, `CHÁT!`, `KENG!`), đếm ngược anime sunburst bùng nổ, bong bóng thoại chat truyện tranh.
- **Không mang nét AI**: Không dùng hiệu ứng kính mờ (glassmorphism) hay gradient tím/indigo nhạt vô hồn.
- **4 theme truyện tranh**: **Manga Noir**, **Pop Art**, **Cyber Mecha**, **Slime Arcade**. Đổi ngay trên thanh header.
- **Camera tự bay**: luôn tự động bay tới nước vừa rồi (không còn tuỳ chọn bật/tắt), bàn luôn được căn giữa và lưới phủ kín màn hình.

## Lọc nội dung

Chat và tên tài khoản đều được lọc từ cấm:
- Lẫn ít từ cấm → che bằng `*`, tin nhắn vẫn gửi.
- Toàn bộ/là phần lớn từ cấm → **chặn hẳn**, tin nhắn không vào phòng.
- Nhận diện được cả tiếng Việt không dấu (`vl`, `cl`, `dkm`), leetspeak (`f0ck`) và chữ viết lặp (`fuuuuck`).

## Phím tắt

| Phím | Tác dụng |
| --- | --- |
| `0` | Camera về giữa bàn |
| `F` | Camera về nước vừa rồi |
| `+` / `-` | Phóng to / thu nhỏ |
| `Cách` | Bật/tắt chế độ đánh trước |
| Chuột lăn + `Ctrl`, kéo | Zoom, di chuyển camera |

## Cấu trúc

```
packages/engine/   luật chơi thuần (không phụ thuộc framework, test đầy đủ)
apps/server/       Fastify + Socket.IO, auth JWT tự ký, store JSON, lobby + trận đấu
apps/web/          React + Vite + Zustand, bàn cờ, camera, minimap, chat
data/game.json     dữ liệu người dùng/phòng/trận (tự sinh, xoá để reset)
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `4000` | cổng server |
| `DB_PATH` | `data/game.json` | nơi lưu dữ liệu |
| `JWT_SECRET` | *(dev-only)* | **bắt buộc** khi `NODE_ENV=production` |
| `ADMIN_PASSWORD` | `123` | mật khẩu cho tài khoản `admin` tạo lần đầu |
| `COUNTDOWN_MS` | `10000` | thời gian đếm ngồi trước ván |
| `PREMOVE_LEAD_MS` | `5000` | thời gian chờ trước khi ăn nước đi trước |
| `RECONNECT_GRACE_MS` | `30000` | thời gian chờ người chơi kết nối lại |
| `BOT_DELAY_MS` | `700` | độ trễ bot nghĩ trước khi đánh |

## Lưu ý vận hành

- Tài khoản `admin` mặc định dùng mật khẩu `123` chỉ để lấy quyền quản trị lần đầu — **hãy đổi ngay trong Hồ sơ**. Mọi lần đổi mật khẩu đều ghi vào nhật ký hệ thống.
- Cookie phiên là `httpOnly` + `SameSite=Lax`. Đặt sau reverse proxy HTTPS thì bật `NODE_ENV=production`.
- Store là file JSON ghi nguyên tử (rename) — đủ cho vài trăm người dùng. Muốn scale thì thay `apps/server/src/db.ts`
  bằng Postgres; phần còn lại không cần sửa vì toàn bộ truy cập dữ liệu đi qua đúng file đó.
