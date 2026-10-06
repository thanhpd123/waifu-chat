# 🌸 Kei · Live2D Chat

Chatbox anime với nhân vật Live2D: trò chuyện, đổi biểu cảm theo cảm xúc và nhép miệng theo giọng nói.

- **Frontend**: React + Vite + PixiJS / pixi-live2d-display (`src/`)
  - `/` landing page · `/login` đăng nhập · `/chat` trò chuyện với Kei (nhiều cuộc trò chuyện)
- **Đăng nhập & lưu lịch sử**: Supabase (gói free) — `supabase/schema.sql`
- **Backend "bộ não"**: Flask + Server-Sent Events (`server/app.py`)
  - LLM: Gemini (có gói miễn phí) hoặc OpenAI; thiếu key → bộ não offline vẫn chat được
  - Giọng nói: OpenAI TTS, hoặc **edge-tts miễn phí** (giọng nữ HoaiMy / Nanami / Ava)

## Chạy local

```bash
npm ci
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                 # điền GEMINI_API_KEY

python server/app.py                 # backend: http://127.0.0.1:8000
npm run dev                          # frontend: http://localhost:5173 (proxy /api → backend)
```

## Deploy lên Vercel (miễn phí, gói Hobby)

Repo đã có sẵn cấu hình, chỉ cần import vào Vercel:

- `vercel.json` — build Vite ra `dist/`, rewrite mọi `/api/*` về Python function, cache asset tĩnh.
- `api/index.py` — Serverless Function chạy **đúng Flask app** trong `server/app.py`
  (Vercel tự cài `requirements.txt`).

Các bước:

1. Lấy API key Gemini **miễn phí** tại <https://aistudio.google.com/apikey>.
2. Vercel → Project → **Settings → Environment Variables**, thêm:
   | Tên | Giá trị |
   | --- | --- |
   | `LLM_PROVIDER` | `gemini` |
   | `GEMINI_API_KEY` | key vừa lấy |
   | `GEMINI_MODEL` (tuỳ chọn) | `gemini-flash-lite-latest` (mặc định — nhanh, gói free nhiều lượt) |
3. **Redeploy** (biến môi trường chỉ có hiệu lực ở lần deploy sau khi thêm).
4. Mở `https://<tên-app>.vercel.app/api/health` — thấy `"engine": {"kind": "gemini", ... "online": true}` là xong.

Không có key thì Kei vẫn chạy bằng bộ não offline phía server, và giọng đọc vẫn dùng edge-tts miễn phí.

> Lưu ý: không đặt `OPENAI_API_KEY` nếu không muốn phát sinh chi phí — OpenAI tính phí theo lượt dùng.

## Đăng nhập & quản lý cuộc trò chuyện (Supabase, miễn phí)

Khi chưa cấu hình, app vẫn chạy bình thường: không cần đăng nhập, lịch sử lưu trong trình duyệt.
Bật đăng nhập để mỗi người có tài khoản riêng, nhiều cuộc trò chuyện, đồng bộ giữa các thiết bị:

1. Tạo project miễn phí tại <https://supabase.com/dashboard> (chọn region Singapore cho nhanh).
2. **SQL Editor → New query** → dán toàn bộ `supabase/schema.sql` → **Run**.
   (Tạo bảng `profiles`, `conversations`, `messages` + Row Level Security: mỗi người chỉ thấy dữ liệu của mình.)
3. **Project Settings → API Keys**: copy **Project URL** và **anon public key** (hoặc *Publishable key*).
4. Vercel → **Settings → Environment Variables**, thêm rồi **Redeploy**:
   | Tên | Giá trị |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Project URL, vd. `https://abcd1234.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | anon public key / publishable key |

   Tên kiểu Next.js do tích hợp Supabase ↔ Vercel tự tạo (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) cũng dùng được, không cần đổi tên.
5. Supabase → **Authentication → URL Configuration**:
   - *Site URL*: `https://waifu-chat-azure.vercel.app`
   - *Redirect URLs*: thêm `https://waifu-chat-azure.vercel.app/**`
6. (Khuyên dùng) **Authentication → Sign In / Providers → Email**: tắt *Confirm email* để đăng ký xong
   vào chat được ngay — gói free của Supabase chỉ gửi được vài email xác nhận mỗi giờ.
7. (Tuỳ chọn) Đăng nhập Google: bật provider **Google** trong Supabase (cần OAuth Client ID từ
   Google Cloud Console) rồi thêm biến `VITE_ENABLE_GOOGLE_LOGIN=1` trên Vercel.

Khi đã cấu hình, backend chỉ trả lời người **đã đăng nhập** (kiểm tra token với Supabase) để người
ngoài không gọi thẳng `/api` làm hết quota Gemini. Tắt bằng `KEI_REQUIRE_LOGIN=0` nếu cần.
`/api/health` có trường `auth_required` để kiểm tra.
