import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root'

/**
 * Khởi động app. Router (`Root`) quyết định trang nào được hiển thị:
 *  - `/`      → landing page (nhẹ, KHÔNG nạp Live2D)
 *  - `/login` → đăng nhập / đăng ký
 *  - `/chat`  → nạp Live2D Cubism Core rồi mới import khung chat với Kei
 */
createRoot(document.getElementById('root')!).render(<Root />)
