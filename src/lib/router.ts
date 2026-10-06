import { useEffect, useState } from 'react';

/**
 * Router tối giản (3 trang: `/`, `/login`, `/chat`) — không cần thêm thư viện.
 * Vercel rewrite mọi đường dẫn không phải file/`/api` về `index.html`.
 */

const EVENT = 'kei:navigate';

export function navigate(path: string, options: { replace?: boolean } = {}): void {
    if (path === window.location.pathname + window.location.search) return;
    if (options.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    window.dispatchEvent(new Event(EVENT));
    window.scrollTo(0, 0);
}

export function usePath(): string {
    const [path, setPath] = useState(() => window.location.pathname);
    useEffect(() => {
        const update = () => setPath(window.location.pathname);
        window.addEventListener('popstate', update);
        window.addEventListener(EVENT, update);
        return () => {
            window.removeEventListener('popstate', update);
            window.removeEventListener(EVENT, update);
        };
    }, []);
    return path;
}

/** Xử lý click vào thẻ <a> nội bộ mà không tải lại trang. */
export function linkHandler(path: string) {
    return (event: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
        if (event.metaKey || event.ctrlKey) return; // mở tab mới như bình thường
        event.preventDefault();
        navigate(path);
    };
}
