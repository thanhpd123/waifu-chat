# 🌸 Kei · Live2D Chat

Chatbox anime với nhân vật Live2D: trò chuyện, đổi biểu cảm theo cảm xúc và nhép miệng theo giọng nói.

- **Frontend**: React + Vite + PixiJS / pixi-live2d-display (`src/`)
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
3. **Redeploy** (biến môi trường chỉ có hiệu lực ở lần deploy sau khi thêm).
4. Mở `https://<tên-app>.vercel.app/api/health` — thấy `"engine": {"kind": "gemini", ... "online": true}` là xong.

Không có key thì Kei vẫn chạy bằng bộ não offline phía server, và giọng đọc vẫn dùng edge-tts miễn phí.

> Lưu ý: không đặt `OPENAI_API_KEY` nếu không muốn phát sinh chi phí — OpenAI tính phí theo lượt dùng.
