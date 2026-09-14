import { createRoot } from 'react-dom/client'
import './index.css'
import StartupError from './components/StartupError'
import { loadCubismCore } from './lib/live2dCore'

/**
 * Khởi động app theo 2 bước:
 *
 *  1. Nạp Live2D Cubism Core (bản local trước, fallback sang CDN).
 *  2. CHỈ SAU ĐÓ mới import App.
 *
 * Bắt buộc theo thứ tự này vì `pixi-live2d-display` kiểm tra
 * `window.Live2DCubismCore` ngay khi module được import — import App trước sẽ
 * làm cả ứng dụng "trắng trang" chỉ vì thiếu runtime Live2D.
 */
const container = document.getElementById('root')!

async function bootstrap() {
  const root = createRoot(container)

  try {
    await loadCubismCore()
  } catch (error) {
    console.error('[Kei] Không nạp được Live2D Cubism Core:', error)
    root.render(
      <StartupError message="Không nạp được Live2D Cubism Core (đã thử bản local và các CDN). Hãy kiểm tra kết nối mạng rồi tải lại trang." />,
    )
    return
  }

  const { default: App } = await import('./App.tsx')
  root.render(<App />)
}

void bootstrap()
