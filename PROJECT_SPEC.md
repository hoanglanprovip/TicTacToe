# PROJECT SPEC — Tic Tac Toe Online (2 người)

> Tài liệu này là **nguồn sự thật duy nhất** cho dự án. Mọi thay đổi phải cập nhật vào đây trước khi sửa code.
> Phiên bản: 1.0 · Trạng thái: v1 đang triển khai · Ngôn ngữ UI: Tiếng Việt

---

## 0. Thay đổi so với yêu cầu ban đầu

Yêu cầu gốc mô tả bản **3–6 người** với bàn thay đổi theo số người. Phiên bản này **chỉ chơi 2 người**,
nên quy tắc "số người quyết định kích thước bàn" được chuyển thành **người chơi chọn chế độ (tier)**:

| Chế độ | Bàn cờ | Thắng khi | Cách đặt quân |
| --- | --- | --- | --- |
| `classic` | 3×3 | 3 quân liền kề | tự do trong bàn |
| `big` | 6×6 | 4 quân liền kề (cho phép đổi) | tự do trong bàn |
| `infinity` | vô hạn | 5 quân liền kề (cho phép đổi) | mọi ô trống, không giới hạn khoảng cách |

Mọi thứ còn lại giữ nguyên: **tài khoản → lobby → link mời (bắt buộc đăng nhập) → pre-move → camera tự di chuyển**.

---

## 1. Mục tiêu sản phẩm

1. Người dùng tạo tài khoản, đăng nhập.
2. Tạo phòng (lobby) → nhận link mời 6 ký tự → copy 1 chạm.
3. Người được mời bấm link → nếu chưa đăng nhập thì bị đẩy sang `/login?next=...` → đăng nhập xong tự quay lại phòng.
4. Hai người vào phòng, chủ phòng bắt đầu → đếm ngược 10 giây → vào ván.
5. Chơi tic tac toe với **pre-move** và **camera tự bay tới nước đi mới nhất**.
6. Thắng/thua rõ ràng, có rematch, có chat.

## 2. Ngoài phạm vi v1 (không làm, để sau)

ELO/replay/xem khán giả/undo bằng biểu quyết/email mời/ứng dụng mobile.

## 2b. Chế độ chơi với máy (Bot)

- Chơi một mình: từ trang chủ bấm **Chơi với máy**, chọn chế độ + độ khó → tạo phòng có sẵn bot làm người thứ hai.
- Trong phòng, chủ phòng có thể **thêm/gỡ bot** và **đổi độ khó** khi phòng còn ở trạng thái `waiting`.
- Bot có `userId` dạng `bot:<MÃ_PHÒNG>`, tên hiển thị là **Máy**. Không đăng nhập, không vào profile.
- **Ván đầu** của phòng chọn ngẫu nhiên người đi `X` (đi trước); **ván sau người thua ván trước được đi trước** (xem §7).
- Bot nghĩ chậm `BOT_DELAY_MS` (mặc định 700ms) để người chơi kịp nhìn thấy nước đi.
- Bot không có kết nối socket nên không bao giờ bị tính là mất kết nối.

**Thuật toán bot** (`packages/engine/src/ai.ts`, thuần & test được) — **negamax + alpha-beta**:

1. Sinh candidate nước đi (`legalMoves`) — bàn mở rộng chỉ xét vùng quanh quân/tâm để bot quyết định nhanh; đây chỉ là tập candidate của bot, người chơi vẫn được đánh ở mọi ô trống.
2. **Thắng ngay** nếu có (phát hiện ngay khi vừa đánh, không cần tìm hết cây).
3. **Chặn** nước thắng ngay của đối thủ.
4. **Tìm kiếm** theo độ sâu (`profile.depth`) với ngân sách thời gian, iterative deepening: nếu hết giờ thì giữ kết quả của độ sâu vừa tìm trọn vẹn.
5. **Sắp xếp nước đi** khi mở nhánh: thắng > chặn > đoạn quân dài > ô gần tâm (rẻ, chạy mỗi nút).
6. **Threat extension**: ở lá cây vẫn nối tiếp nếu bên đến lượt sắp thắng ngay → bot thấy được chuỗi đe doạ ngoài tầm sâu cố định.
7. **Đánh giá thế cờ** (`evaluateMap`) tính theo **đoạn tối đa** (không đếm trùng theo từng quân), phân biệt **đe doạ không chặn được** (đoạn chỉ còn 1 đầu trống — nặng) với đe doạ 2 đầu trống (đối thủ chặn được), cộng thêm quyền kiểm soát trung tâm.
8. Áp dụng **bài học đã học** (`advice`): tránh nước từng khiến thua, ưu tiên nước từng giúp thắng — nhưng không để ghi đè nước thắng ngay.

| Độ khó | Hành vi |
| --- | --- |
| `easy` | Tìm kiếm nông (~2 ply, 70ms) + chọn nước kém có chủ đích ~45% để người chơi dễ thắng |
| `normal` | Tìm kiếm vừa (~5 ply, 250ms), hiếm khi chơi sai |
| `hard` | Tìm sâu nhất (~8 ply, 700ms), không bỏ lỡ chiến thuật |

Mỗi cấp độ bot học được (`stats.level`, 0–15) cộng thêm độ sâu, thời gian và giảm tỉ lệ chơi sai; bot khó bị trần `MAX_THINK_MS = 1800` mỗi nước đi.

**Não bot & tự học** (`packages/engine/src/training.ts`):

- `positionKey` chuẩn hoá thế cờ theo góc toạ độ tối thiểu + luật chơi + quân đang đi → bài học dùng lại được ở vị trí khác.
- `analyzeMatch` rút bài học sau mỗi ván: bot thua → đánh dấu nước sai của bot (`bad`) và nước của người chơi thắng bot (`good`); bot thắng → củng cố nước của bot.
- `learn` trộn bài học (cùng loại thì tăng độ tin cậy, trái ý thì suy yếu rồi đảo kết luận), giới hạn 4000 bài, cập nhật XP/cấp độ.
- Não lưu ở `store.bots` trong `data/game.json`, dùng chung mọi phòng; `GET /api/bot` trả thống kê cho UI.
- `npm run train -- --games=500 --tier=classic` để train ngoại tuyến bằng `selfTrain` (bot tự đấu chính nó).

### Vai trò tài khoản & quản trị

- `UserRecord.role`: `user` (mặc định) | `admin`.
- Lần khởi động đầu tiên, `ensureAdminUser()` tạo tài khoản **`admin`** với mật khẩu `ADMIN_PASSWORD` (mặc định `123`); nếu tài khoản `admin` đã tồn tại thì ép role là `admin`.
- Tên `admin` **không cho đăng ký** (`USERNAME_RESERVED`).
- **Đổi mật khẩu**: `POST /api/auth/password { currentPassword, newPassword }` (mới ≥ 6 ký tự) — huỷ toàn bộ phiên của tài khoản đó. Admin có thêm `POST /api/admin/users/:id/password` để đặt lại cho người khác.
- Nhóm API `/api/admin/*` (overview, train, bot/reset, users, đặt mật khẩu) **chỉ admin**: gọi từ tài khoản thường trả `403 FORBIDDEN` và ghi log cảnh báo.
- `POST /api/admin/train` **không chặn server**: `startTrainingJob()` chạy `trainBrain` trong **worker thread** (`train-worker.ts`) và trả job ngay; `GET /api/admin/overview` trả `training` { running, done, total, result } để UI vẽ thanh tiến độ. Trần `MAX_TRAIN_GAMES = 2000`; gọi lại khi đang chạy trả về job hiện tại. Nếu không có file worker (chạy tsx/vitest) thì fallback `trainInChunks()` — chia lô, `setImmediate` giữa các lô.
- Nhật ký hệ thống `apps/server/src/log.ts`: ring buffer 500 dòng trong bộ nhớ, chỉ đọc được qua `GET /api/admin/overview`. Ghi các sự kiện auth/lobby/match/bot/admin.

### Phiên khách (chơi không cần tài khoản)

- `POST /api/auth/guest { name }` → tạo `GuestRecord` (`guest:<uuid>`) trong `store.guests`, cấp token đánh dấu `guest: true`, đặt cookie phiên (hạn 12 giờ).
- `authenticate()` nếu token có `guest` thì tra `store.guests` và trả `AuthUser.isGuest = true` — không cần bản ghi user, không có mật khẩu, không bao giờ có `role: 'admin'`.
- `requireAdmin()` chặn khách (403). `requireAccountUser()` chặn khách đổi mật khẩu (`GUEST_NO_PASSWORD`). `/api/profile` trả thống kê rỗng cho khách.
- Chống lạm dụng: `GUEST_PER_IP_PER_HOUR` (mặc định 12), `MAX_GUESTS` (300), `guests.prune()` dọn khách cũ, tên phải 2–16 ký tự và không trùng tài khoản/khách, không cho tên `admin`.
- Frontend: `/guest` (AuthPage mode `guest`), nhãn `KHÁCH` ở header, trang hồ sơ hiện hướng dẫn thay vì ô đổi mật khẩu.

---

## 2c. Lọc nội dung (`packages/engine/src/profanity.ts`)

- Áp dụng cho **chat** và **tên tài khoản**.
- Chuẩn hoá trước khi so khớp: bỏ dấu tiếng Việt, đổi leetspeak (`0→o`, `@→a`, `3→e`…), gộp chữ lặp (`fuuuuck→fuck`), bỏ ký tự lạ.
- Danh sách chia 2 nhóm:
  - **strict** (viết tắt 2–3 ký tự: `vl`, `cl`, `dkm`, `deo`…) — chặn cả khi viết không dấu.
  - **contextual** (từ tiếng Việt đầy đủ) — chỉ chặn khi đứng riêng một từ. Cố tình **loại** các từ dễ trùng ngữ cảnh thường: `cho`, `con`, `đầu`, `nam`, `rác`…
- Hành vi:
  - `hits/total < 0.34` → **che từ đó bằng `*`**, tin nhắn vẫn gửi, người gửi nhận `chat:moderated`.
  - `hits/total ≥ 0.34` → **chặn hẳn**, tin nhắn **không** vào phòng, người gửi nhận `chat:rejected`.
- Tên tài khoản chứa từ cấm → từ chối đăng ký với mã `USERNAME_INAPPROPRIATE`.

---

## 2d. Giao diện (Phong cách truyện tranh / Comic & Manga Edition)

- **Phong cách Neo-Pop Art / Manga Comic Book**: Viền mực dày (ink stroke 2.5–3.5px), đổ bóng khối cứng dạng 3D (`box-shadow: 4px 4px 0 #000`), nền họa tiết chấm halftone benday dots.
- **Không mang nét AI**: Tuyệt đối tránh kính mờ mịt (glassmorphism), viền mờ nhạt 1px, dải màu gradient tím/xanh nhạt vô hồn kiểu template AI. Mọi thành phần đều có cá tính đồ họa truyện tranh rõ nét.
- **Hiệu ứng hoạt hình & tactile bounce**:
  - Quân cờ tiếp đất có hoạt ảnh slam/bounce với gia tốc nảy lò xo (`cubic-bezier`).
  - Nước đi mới nhất xuất hiện sticker sound-effect hành động hoạt hình (`BAM!`, `POW!`, `CHÁT!`, `KENG!`).
  - Nút bấm có cơ chế nhấn 3D xúc giác (hover nhô lên 6px bóng, active ấn lún xuống 1px).
  - Đếm ngược chuyển trận với tia mặt trời xoay (rotating sunburst) và số nhảy nhịp tim hoạt hình.
  - Hộp thoại tin nhắn mang dáng dấp khung lời thoại (speech balloon) của truyện tranh.
- **4 theme truyện tranh**: `dark` (Manga Noir), `light` (Pop Art Comic), `midnight` (Cyber Mecha), `forest` (Slime Arcade). Áp dụng tức thì qua biến CSS.

---

## 3. Kiến trúc

```
tictactoe/
├─ PROJECT_SPEC.md          ← tài liệu này
├─ README.md                ← hướng dẫn chạy
├─ packages/engine/         ← LUẬT CHƠI THUẦN, không phụ thuộc framework, 100% test được
│   src/ types.ts rules.ts board.ts game.ts index.ts __tests__/*.test.ts
├─ apps/server/             ← Fastify + Socket.IO + SQLite (node:sqlite) + JWT tự ký
│   src/ index.ts config.ts db.ts auth.ts routes.ts lobby.ts socket.ts match.ts
└─ apps/web/                ← Vite + React + TypeScript + Zustand + Framer Motion
    src/ main.tsx App.tsx api.ts store.ts styles.css pages/ components/
```

**Quyết định cốt lõi:** chỉ có **một** mô hình bàn cờ — lưới toạ độ nguyên `(x, y)` với `Map` khoá `"x,y"`.
Bàn hữu hạn chỉ là trường hợp riêng của nó. Không viết 3 nhánh code cho 3 kích thước bàn.

**Luồng dữ liệu:** Server là nguồn sự thật. Client chỉ gửi ý định, nhận lại trạng thái.
Client áp dụng **optimistic update** để cảm giác tức thì, và rollback nếu server từ chối.

---

## 4. Quy tắc chơi (chi tiết)

### 4.1 Thắng
- "Liền kề" = cùng hàng, cùng cột, hoặc cùng đường chéo; đúng `winLength` ô **liền nhau, không có ô rỗng xen giữa**.
- Sau mỗi nước đi, server chỉ quét 4 hướng xuyên qua ô vừa đánh → O(winLength), không quét cả bàn.
- Nếu một nước đi tạo ra nhiều đường thắng → chỉ lấy đường dài nhất để highlight.

### 4.2 Bàn hữu hạn (`classic`, `big`)
- Toạ độ chuẩn hoá về `0..N-1`, ô (0,0) là góc trên-trái.
- Bàn đầy mà không ai thắng → **hòa** → cho rematch.

### 4.3 Bàn vô hạn (`infinity`)
- Toạ độ nguyên an toàn (`Number.isSafeInteger`) không giới hạn. Gốc (0,0) là tâm ban đầu của camera.
- **Mỗi lượt được đánh tại bất kỳ ô trống nào**, kể cả nước đầu tiên; không có yêu cầu ở tâm hay kề quân cũ.
- Camera tự bay tới nước vừa đánh; người chơi có thể kéo/zoom để đến vùng khác.
- Bàn vô hạn **không thể hòa**. Nếu hết giờ (nếu bật đồng hồ) → tính điểm, ai nhiều quân hơn thắng.

### 4.4 Lượt chơi
- 2 người, mỗi người một ký hiệu `X` hoặc `O`.
- **Ván đầu tiên của phòng**: server chọn ngẫu nhiên một người làm `X` (đi trước).
- **Từ ván thứ hai**: **người thua ván trước được làm `X` (đi trước)**; ván trước bị hoà thì giữ nguyên người đi trước.
- Sau đó luân phiên `X → O → X …`.

### 4.5 Bỏ cuộc / mất kết nối
- `resign` → bên kia thắng ngay.
- Mất kết nối: báo "đang mất kết nối", cho **30 giây** reconnect (đếm ngồi trên server).
  Hết giờ → coi như bỏ cuộc. Nếu bên thắng là người mất kết nối thì hoàn lượt cho bên kia.

---

## 5. Pre-move (đánh trước, giống cờ vua)

- Bật/tắt được trong lobby. Mặc định **BẬT**.
- Hàng đợi tối đa **3** nước, có thể sửa/xoá bất kỳ lúc nào trước khi đến lượt.
- Giao diện: kéo thả quân từ hàng đợi lên ô cước, **hoặc** bấm ô để đặt nhanh (click 1 = đánh luôn nếu hàng đợi rỗng).
- Ô trong hàng đợi được tô viền đặc trên bàn cờ. Nếu ô đó **bị đối thủ chiếm** → viền chuyển đỏ gạch chéo + chữ "bị chặn".
- Khi đến lượt:
  1. Server chạy hết đếm ngược `PRE_MOVE_LEAD_MS = 5000` (chỉ khi bật pre-move).
  2. Lấy nước đầu tiên trong hàng đợi → **tự động đánh**, người chơi được cửa đặt tiếp ngay.
  3. Nếu ô đó không còn hợp lệ (đối thủ vừa chiếm) → **hủy nước đó**, phát `premoveCancelled`, hiện toast, người chơi phải đặt nước mới.
  4. Không bao giờ tự động dời quân.
- Có tuỳ chọn `autoRelocate` (mặc định **TẮT**): nếu bật, khi nước đi bị chặn thì engine tìm ô hợp lệ gần nhất và đánh hộ.

---

## 6. Camera

- Bàn cờ là 1 `div` khổ lớn, camera = `transform: translate3d(x, y, 0) scale(z)`.
- **Camera tự động**: mỗi khi có nước đi mới (của bất kỳ ai), camera tween tới **tâm ô vừa đánh** trong 400ms, ease `cubic-bezier(.22,1,.36,1)`.
  Có công tắc bật/tắt, mặc định BẬT.
- Zoom: nút `+ / −`, chuột lăn (ctrl), pinch 2 ngón, khoảng `0.35 – 3.0`.
- Kéo để di chuyển (pointer events, hỗ trợ chuột và cảm ứng).
- Phím tắt: `0` về giữa, `F` về nước vừa rồi, `+ / −` zoom, `Space` khoá/khoá-xoá bàn cờ.
- **Minimap** 1/4 góc phải: toàn bộ vùng đã đánh + camera viewport + chấm màu người chơi, bấm được để nhảy tới.
- Nếu nước đi nằm ngoài khung nhìn → hiện **mũi tên ở cạnh màn hình** chỉ hướng + nhấp nháy ô 3 lần.
- **Chỉ render ô trong khung nhìn thật + biên đệm 4 ô** (virtualization) — bắt buộc với bàn vô hạn.
- Hiệu ứng: quân scale-in khi đặt, rung nhẹ màn hình khi có người thắng.

---

## 7. Tài khoản

- Đăng ký `username` + `password`.
  - `username`: 3–20 ký tự, regex `^[a-zA-Z0-9_]+$`, không trùng (case-insensitive).
  - `password`: ≥ 8 ký tự.
- Mật khẩu hash bằng **scrypt** (`node:crypto`), mỗi user 1 salt 16 byte ngẫu nhiên. Không bao giờ lưu plaintext.
- Session: **JWT HS256 tự ký** trong `httpOnly` cookie `tt_session`, hạn 30 ngày, kèm `jti` để thu hồi được.
- Rate limit đăng nhập: 10 lần / phút / IP.
- Mọi lỗi trả về bằng tiếng Việt, kèm mã lỗi ổn định (client dùng mã để hiển thị, không parse message).
- `/profile`: lịch sử trận, tỉ lệ thắng/hòa/thua, chuỗi thắng hiện tại.

---

## 8. Lobby & link mời

- Mã phòng: 6 ký tự từ bảng ký tự **không dễ nhầm** `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (loại `0O1IL`).
- Link mời: `https://<domain>/lobby/<CODE>`. Nút copy 1 chạm + Web Share API nếu có.
- Người được mời **bắt buộc đăng nhập**: chưa đăng nhập → `/login?next=/lobby/<CODE>` → sau khi đăng nhập server trả `next` để client điều hướng lại.
- Trạng thái phòng: `waiting → countdown(10s) → playing → finished`.
- Trong `waiting`, chủ phòng đổi được: chế độ thi đấu, pre-move bật/tắt, thêm/gỡ máy và độ khó. Camera tự động bay theo nước đi là mặc định vĩnh viễn, không phải tuỳ chọn.
- Chủ phòng: kick người, bắt đầu ván. Host rời lobby → chuyển host cho người còn lại; lobby rỗng tự xoá.
- Link hết hạn khi ván bắt đầu (`code` bị đánh dấu đã dùng) hoặc sau 24h.
- Lỗi phòng: `LOBBY_NOT_FOUND`, `LOBBY_FULL`, `LOBBY_IN_PROGRESS`, `LOBBY_EXPIRED`, `ALREADY_IN_MATCH`.
- Mỗi lần rematch, người gửi chọn lại chế độ ngay dưới kết quả ván.
- Rematch với bot: tự động bắt đầu countdown 3 giây theo chế độ vừa chọn, không cần xác nhận.
- Rematch với người: một người chọn chế độ và gửi lời mời; người kia phải **Chấp nhận** hoặc **Từ chối** chế độ đó. Lời mời hết hạn sau 30 giây.
- Chấp nhận → countdown và ván mới; từ chối/hết hạn → giữ nguyên kết quả hiện tại. Ván mới thì **người thua ván trước được đi trước**.

---

## 9. Giao thức realtime (Socket.IO)

**Client → Server**

| Event | Payload | Ghi chú |
| --- | --- | --- |
| `lobby:join` | `{ code }` | server tự check session qua cookie |
| `lobby:leave` | — | |
| `lobby:update` | `{ tier, winLength, premoveEnabled, botDifficulty }` | chỉ host (camera luôn bật, không còn tuỳ chọn) |
| `lobby:addBot` | `{ difficulty }` | chỉ host, thêm bot làm người thứ 2 |
| `lobby:removeBot` | — | chỉ host, gỡ bot |
| `lobby:start` | — | chỉ host, đủ người |
| `lobby:kick` | `{ userId }` | chỉ host |
| `lobby:rematch:request` | `{ tier }` | chọn chế độ rồi gửi lời mời chơi lại |
| `lobby:rematch:respond` | `{ accept }` | đối thủ chấp nhận hoặc từ chối |
| `game:place` | `{ x, y, seq }` | đánh thật |
| `game:premove` | `{ cells: Cell[] }` | ghi đè hàng đợi, ≤ 3 |
| `game:premove:clear` | — | |
| `game:resign` | — | |
| `chat:send` | `{ text }` | ≤ 300 ký tự, lọc từ cấm |

**Server → Client**

| Event | Payload |
| --- | --- |
| `hello` | `{ user }` — xác nhận đã xác thực |
| `lobby:state` | toàn bộ trạng thái phòng (nguồn sự thật, client ghi đè) |
| `lobby:error` | `{ code, message }` |
| `match:state` | snapshot đầy đủ: rule, bàn cờ, người chơi, lượt, hàng đợi pre-move, deadline |
| `match:move` | `{ move, board?, winner?, winningLine? }` |
| `match:premove` | `{ userId, cells, blocked: Cell[] }` |
| `match:turn` | `{ userId, deadline }` |
| `match:countdown` | `{ ms, endsAt }` |
| `match:rematch-request` | `{ requesterId, expiresAt }` |
| `match:rematch-response` | `{ accepted, requesterId?, responderId?, message? }` |
| `match:rematch-expired` | — |
| `match:end` | `{ winnerId | null, reason: 'win' \| 'draw' \| 'resign' \| 'timeout' \| 'disconnect' }` |
| `chat:message` | `{ userId, username, text, at }` |
| `chat:rejected` | `{ reason }` — chỉ gửi cho người gửi, tin nhắn không vào phòng |
| `chat:moderated` | `{ reason }` — chỉ gửi cho người gửi, tin nhắn đã che từ cấm |

**Bất biến:** mọi `move` có `seq` tăng dần, `game:place` mang `seq` của client → server bỏ qua message trùng (idempotent).
`match:state` là nguồn chuẩn để resync sau reconnect.

---

## 10. Mô hình dữ liệu (SQLite qua `node:sqlite`)

| Bảng | Cột chính |
| --- | --- |
| `users` | `id` PK, `username` UNIQUE(ci), `pass_hash`, `pass_salt`, `created_at` |
| `sessions` | `jti` PK, `user_id`, `revoked` 0/1, `created_at` |
| `lobbies` | `code` PK, `host_id`, `tier`, `win_length`, `max_players`, `premove_enabled`, `camera_follow`, `status`, `created_at`, `expires_at` |
| `lobby_members` | PK(`code`,`user_id`), `symbol`, `joined_at` |
| `matches` | `id` PK, `lobby_code`, `tier`, `win_length`, `status`, `winner_id`, `reason`, `created_at`, `finished_at` |
| `match_players` | PK(`match_id`,`user_id`), `symbol`, `stones`, `result` |
| `moves` | `match_id`+`seq` PK, `user_id`, `x`, `y`, `symbol`, `at` |

SQLite chỉ để chạy nhanh không cần Docker. Tầng truy cập nằm sau `db.ts` nên đổi sang Postgres chỉ sửa 1 file.

---

## 11. Tiêu chí nghiệm thu (Definition of Done)

- [ ] `npm test` — toàn bộ test engine xanh.
- [ ] `npm run typecheck` — không lỗi TypeScript ở cả 3 package.
- [ ] `npm run build` — web build xong, server biên dịch xong.
- [ ] `npm start` — mở `http://localhost:4000`, đăng ký 2 tài khoản ở 2 trình duyệt (hoặc 2 tab), tạo phòng, copy link, tab kia mở link → vào đúng phòng.
- [ ] Chưa đăng nhập mở link → bị đẩy sang login → đăng nhập xong quay lại đúng phòng.
- [ ] Thắng theo hàng / cột / chéo ở cả 3 chế độ; bàn đầy ở `classic` → hòa.
- [ ] Bàn vô hạn: nước đầu và các nước sau ở toạ độ xa tuỳ ý đều được chấp nhận.
- [ ] Pre-move: xếp 2 nước → được đánh tự động 2 lượt liên tiếp; nước bị đối thủ chiếm → hủy + toast.
- [ ] Camera tự bay tới nước đi của đối thủ; nước đi ngoài màn hình → mũi tên cạnh màn hình.
- [ ] Ngắt mạng rồi vào lại → nhận đúng `match:state`, không lệch trạng thái.
- [ ] Chat hoạt động, rematch hoạt động.

## 12. Rủi ro đã biết

| Rủi ro | Xử lý |
| --- | --- |
| Bàn vô hạn nhiều quân → DOM nặng | chỉ render ô trong viewport + biên đệm 4 |
| Client fake nước đi / đánh nhiều lần | server kiểm tra mọi thứ, `seq` chống trùng |
| Người chơi spam pre-move | giới hạn 3 ô + rate limit 10 msg/5s |
| Bàn vô hạn kéo dài vô tận | mỗi nước đòi hỏi chiến thuật tạo 5 quân liền; có thể thêm đồng hồ trận sau |
| Bảo mật cookie | httpOnly + SameSite=Lax + Secure khi HTTPS |
