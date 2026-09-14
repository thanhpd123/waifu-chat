/**
 * Nạp Live2D Cubism 4 Core — thư viện runtime BẮT BUỘC phải có trước khi tạo model.
 *
 * Thứ tự ưu tiên (bền vững khi mạng yếu / bị chặn domain):
 *   1. Bản local `/live2dcubismcore.min.js` đi kèm dự án → chạy được cả khi offline.
 *   2. CDN chính thức của Live2D.
 *   3. CDN dự phòng (jsDelivr, unpkg) cho trường hợp mạng chặn `live2d.com`.
 *
 * Trước đây app chỉ nhúng thẳng script CDN trong `index.html`, nên nếu CDN không
 * truy cập được thì nhân vật Kei không bao giờ hiện ra.
 */

const CORE_SOURCES = [
    '/live2dcubismcore.min.js',
    'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
    'https://cdn.jsdelivr.net/npm/live2dcubismcore@1.0.1/live2dcubismcore.min.js',
    'https://unpkg.com/live2dcubismcore@1.0.1/live2dcubismcore.min.js',
];

declare global {
    interface Window {
        Live2DCubismCore?: unknown;
    }
}

/** Promise dùng chung để nhiều nơi gọi cùng lúc cũng chỉ tải core một lần. */
let pending: Promise<void> | null = null;

function injectScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => {
            script.remove();
            reject(new Error(`Không nạp được Cubism Core từ ${src}`));
        };
        document.head.appendChild(script);
    });
}

/** Trả về Promise hoàn tất khi `window.Live2DCubismCore` đã sẵn sàng. */
export function loadCubismCore(): Promise<void> {
    if (typeof window !== 'undefined' && window.Live2DCubismCore) {
        return Promise.resolve();
    }
    if (pending) return pending;

    pending = (async () => {
        for (const src of CORE_SOURCES) {
            try {
                await injectScript(src);
                if (window.Live2DCubismCore) return;
            } catch {
                /* Nguồn lỗi → thử nguồn kế tiếp. */
            }
        }
        throw new Error(
            'Không nạp được Live2D Cubism Core (đã thử bản local và các CDN). ' +
            'Hãy kiểm tra kết nối mạng rồi tải lại trang.',
        );
    })();

    // Cho phép thử lại ở lần mount sau nếu cả 4 nguồn đều thất bại.
    pending.catch(() => {
        pending = null;
    });

    return pending;
}
