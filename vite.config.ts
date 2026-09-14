import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cổng của backend "bộ não" Kei (server/app.py).
// Đổi bằng biến môi trường WAIFU_SERVER_PORT khi chạy `npm run dev`.
const WAIFU_API = `http://127.0.0.1:${process.env.WAIFU_SERVER_PORT ?? '8000'}`

/**
 * Cấu hình proxy dùng chung cho cả `vite dev` và `vite preview`.
 * Nhờ vậy frontend chỉ cần gọi `/api/...` là tới được Flask backend:
 * không vướng CORS và API key không bao giờ lộ ra trình duyệt.
 */
const proxy = {
  '/api': {
    target: WAIFU_API,
    changeOrigin: true,
  },
} as const

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  build: {
    // Model Live2D + texture khá nặng nên nâng ngưỡng cảnh báo cho gọn log.
    chunkSizeWarningLimit: 2000,
  },
})
